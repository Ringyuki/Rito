//! Block formatting context for the fragment contract.
//!
//! Composes an inline provider's line output into vertical block flow with
//! fragmentainer pagination. Lines are the atomic unit of pagination for
//! paragraphs: an inline flow lays out once in continuous space (through
//! the input-keyed fragment cache, so resumed fragmentainers replay it),
//! and this context decides which lines land in which fragmentainer,
//! resuming from a break token that records the consumed block size.
//!
//! Vertical margins resolve from the typed layout styles carried by the
//! tree: adjacent siblings collapse (max of positives plus min of
//! negatives), the container is a formatting-context root so no margin
//! collapses through it, and a margin that meets an unforced fragmentainer
//! break is truncated to zero, matching CSS fragmentation.
//!
//! Nested block containers lay out recursively; a break inside one comes
//! back as a break token whose resume path names the whole ancestor chain,
//! so resumption re-enters exactly the interrupted subtree. Each container
//! is treated as a formatting-context root for margins (no through-collapse
//! yet — the parent-child collapse of plain `display: block` wrappers is an
//! explicit remaining gap tracked for the oracle round).
//!
//! Content the block model cannot lay out yet — anything beyond block
//! containers, sized leaves, and inline flows — fails closed instead of
//! guessing.

use std::cell::RefCell;

use rito_fragment::{
    BoxFragment, BreakToken, BreakTokenStage, CancelFlag, ConstraintSpace, FloatBreak,
    FormattingContext, FormattingNodeContent, FormattingNodeId, FormattingTree, Fragment,
    FragmentCache, FragmentRect, FragmentTree, IntrinsicInlineSizes, LayoutError, LayoutOutcome,
};
use rito_style_contract::{
    BoxSizingV1, ClearV1, FloatV1, LayoutFormattingStyleV1, LengthPercentage,
    LengthPercentageOrAuto, MaximumSizeV1, PageBreakV1, PreferredSizeV1,
};

/// Byte budget for the internal inline-outcome cache. Sized for one
/// chapter's worth of paragraphs; least-recently-used outcomes re-lay out
/// transparently if a pathological document overflows it.
const INLINE_CACHE_BUDGET_BYTES: usize = 4 * 1024 * 1024;

/// Block formatting context that owns its inline provider.
///
/// Holds an internal fragment cache for inline outcomes behind a `RefCell`:
/// layout stays a pure function of its inputs (a cache replay is exactly
/// the recomputed outcome), but resumed fragmentainers skip re-shaping the
/// paragraphs they resume into.
pub struct BlockFormattingContext<I: FormattingContext> {
    inline: I,
    inline_cache: RefCell<FragmentCache>,
}

impl<I: FormattingContext> BlockFormattingContext<I> {
    /// Creates a block context that lays inline flows out with `inline`.
    pub fn new(inline: I) -> Self {
        Self {
            inline,
            inline_cache: RefCell::new(FragmentCache::new(INLINE_CACHE_BUDGET_BYTES)),
        }
    }

    /// The wrapped inline provider.
    pub fn inline(&self) -> &I {
        &self.inline
    }

    /// Drops every cached inline fragment. Layout inputs the cache cannot
    /// see — host-measured font metrics, for one — make its entries stale,
    /// and a stale entry would silently outlive the change that
    /// invalidated it.
    pub fn clear_inline_cache(&self) {
        self.inline_cache.borrow_mut().clear();
    }

    fn layout_container(
        &self,
        tree: &FormattingTree,
        container: FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&BreakToken>,
        cancel: &CancelFlag,
        collapse_root_edges: bool,
    ) -> Result<LayoutOutcome, LayoutError> {
        let children = tree.node(container).children.clone();
        let (start_child, mut resumed_consumed) = resume_point(&children, token)?;
        let resumed = token.is_some();
        let fragmentainer_is_fresh = space.fragmentainer_remaining == space.fragmentainer_size;
        let mut remaining = space.fragmentainer_remaining.unwrap_or(f64::INFINITY);
        // The container's own padding: children flow inside the content
        // area. `space.inline_size` is the container's border-box width;
        // the container's own width and margins are its parent's business.
        let container_style = container_layout_style(tree, container)?;
        let pad = |side: rito_style_contract::NonNegativeLengthPercentage| {
            resolve_length_percentage(side.value(), space.inline_size).max(0.0)
        };
        let content_left = pad(container_style.padding.left);
        let padding_right = pad(container_style.padding.right);
        let container_padding_top = pad(container_style.padding.top);
        let container_padding_bottom = pad(container_style.padding.bottom);
        let content_width = (space.inline_size - content_left - padding_right).max(0.0);
        // Resumed fragmentainers start flush: top padding belongs to the
        // container's first fragment only, like a truncated margin.
        let padding_top = if resumed { 0.0 } else { container_padding_top };
        let mut y = padding_top;
        remaining -= padding_top;
        // Padding blocks parent-child margin collapse per CSS, so a padded
        // root keeps its first child's top margin inside.
        let collapse_root_edges = collapse_root_edges && container_padding_top == 0.0;
        let mut fragments = Vec::new();
        // The margin below the previous in-flow child, awaiting collapse
        // with the next child's top margin.
        let mut pending_margin = 0.0_f64;
        // A `break-after: always` on the previous in-flow child forces a
        // fragmentainer break before the next one.
        let mut pending_forced_break = false;
        // Active floats: horizontal occupancy of the current float band and
        // the deepest bottom on each side, in flow coordinates. A float
        // that a fragmentainer edge splits records a pending break and
        // resumes in its own band at the top of the next fragmentainer.
        // An incoming band is an ancestor's float still excluding content
        // at this container's origin: its own floats stack beside it.
        let mut floats = FloatBands::from_incoming(space.float_band);
        // Floats this container placed, reported outward when it is not a
        // formatting-context root: CSS keeps them excluding content in the
        // ancestor root, not at this box's edge.
        let mut placed_floats: Vec<rito_fragment::EscapedFloat> = Vec::new();
        let mut pending_float_breaks: Vec<FloatBreak> = Vec::new();
        if let Some(token) = token {
            // Only depth-0 floats belong to this container; deeper ones
            // ride the resume path down to the container that split them.
            for float_break in token.pending_floats.iter().filter(|entry| entry.depth == 0) {
                if cancel.is_cancelled() {
                    return Err(LayoutError::Cancelled);
                }
                let child_id = float_break.child;
                let child_style = container_layout_style(tree, child_id)?;
                let hbox = self.resolve_float_box(tree, child_id, child_style, content_width)?;
                let margin_right = match child_style.margin.right {
                    LengthPercentageOrAuto::Auto => 0.0,
                    LengthPercentageOrAuto::Value(value) => {
                        resolve_length_percentage(value, content_width)
                    }
                };
                let (_, bottom_margin) = vertical_margins(tree, child_id, content_width)?;
                let occupy_width = hbox.x + hbox.border_width + margin_right;
                let page_bottom = y + remaining.max(0.0);
                let fy = floats.probe_y(occupy_width, y, content_width);
                let available = (page_bottom - fy).max(0.0);
                let sub_space = ConstraintSpace {
                    inline_size: hbox.border_width,
                    fragmentainer_remaining: Some(available),
                    fragmentainer_size: space.fragmentainer_size,
                    float_band: None,
                };
                let outcome =
                    self.layout(tree, child_id, &sub_space, Some(&float_break.token), cancel)?;
                let Fragment::Box(child_root) = outcome.fragments.root else {
                    return Err(LayoutError::Invalid(
                        "float resume must produce a box fragment root".to_owned(),
                    ));
                };
                let head_height = child_root.rect.height;
                // A still-splitting float owns its band to the page edge;
                // a finishing one closes with its bottom margin.
                let occupy_height = if outcome.continuation.is_some() {
                    available
                } else {
                    head_height + bottom_margin.max(0.0)
                };
                let (fx, fy) = floats.place(
                    child_style.float,
                    occupy_width,
                    occupy_height,
                    y,
                    content_width,
                );
                fragments.push(Fragment::Box(BoxFragment {
                    source: child_id,
                    rect: FragmentRect {
                        x: content_left + fx + hbox.x,
                        y: fy,
                        width: hbox.border_width,
                        height: head_height,
                    },
                    children: child_root.children,
                }));
                if let Some(sub_token) = outcome.continuation {
                    pending_float_breaks.push(FloatBreak {
                        child: child_id,
                        token: sub_token,
                        depth: 0,
                    });
                }
            }
        }
        for (index, child_id) in children.iter().enumerate().skip(start_child) {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            let consumed = resumed_consumed;
            resumed_consumed = 0.0;
            let child_resumed = resumed && index == start_child;
            let child_style = container_layout_style(tree, *child_id)?;
            let (top_margin, bottom_margin) = vertical_margins(tree, *child_id, content_width)?;

            // Floated children leave the flow: they are placed against the
            // content edges, never advance `y`, and never split. In-flow
            // margins collapse straight through them.
            if child_style.float != FloatV1::None {
                let hbox = self.resolve_float_box(tree, *child_id, child_style, content_width)?;
                let margin_side = |side: LengthPercentageOrAuto| match side {
                    LengthPercentageOrAuto::Auto => 0.0,
                    LengthPercentageOrAuto::Value(value) => {
                        resolve_length_percentage(value, content_width)
                    }
                };
                let margin_right = margin_side(child_style.margin.right);
                let child_space = ConstraintSpace::continuous(hbox.border_width);
                let outcome = self.layout(tree, *child_id, &child_space, None, cancel)?;
                let Fragment::Box(child_root) = outcome.fragments.root else {
                    return Err(LayoutError::Invalid(
                        "float layout must produce a box fragment root".to_owned(),
                    ));
                };
                let mut inner_children = child_root.children;
                let mut content_height = child_root.rect.height;
                if matches!(
                    tree.node(*child_id).content,
                    FormattingNodeContent::InlineFlow { .. }
                ) {
                    // A floated paragraph's own padding is applied here;
                    // nested containers already applied theirs.
                    for fragment in &mut inner_children {
                        let rect = fragment.rect();
                        set_fragment_position(
                            fragment,
                            rect.x + hbox.padding_left,
                            rect.y + hbox.padding_top,
                        );
                    }
                    content_height += hbox.padding_top + hbox.padding_bottom;
                }
                let occupy_width = hbox.x + hbox.border_width + margin_right;
                // A negative top margin pulls the float's border box above
                // its flow position (how title pages hoist a volume badge
                // back to the page top); the occupied band never extends
                // above the flow and collapses to nothing when the margin
                // swallows the whole box.
                let occupy_height = (top_margin + content_height + bottom_margin.max(0.0)).max(0.0);
                let page_bottom = y + remaining.max(0.0);
                let fy_probe = floats.probe_y(occupy_width, y, content_width);
                let fits = space.fragmentainer_remaining.is_none()
                    || fy_probe + occupy_height <= page_bottom + 1e-6;
                if fits {
                    let (fx, fy) = floats.place(
                        child_style.float,
                        occupy_width,
                        occupy_height,
                        y,
                        content_width,
                    );
                    placed_floats.push(rito_fragment::EscapedFloat {
                        right_side: matches!(child_style.float, FloatV1::Right),
                        width: occupy_width,
                        top: fy,
                        bottom: fy + occupy_height,
                    });
                    fragments.push(Fragment::Box(BoxFragment {
                        source: *child_id,
                        rect: FragmentRect {
                            x: content_left + fx + hbox.x,
                            y: fy + top_margin,
                            width: hbox.border_width,
                            height: content_height,
                        },
                        children: inner_children,
                    }));
                    continue;
                }
                // A block-container float splits at the fragmentainer edge:
                // its head fills this page's band and the remainder resumes
                // beside its peers at the top of the next fragmentainer —
                // how float columns continue across pages in a browser.
                let splittable = matches!(
                    tree.node(*child_id).content,
                    FormattingNodeContent::BlockContainer
                );
                let head_available = page_bottom - fy_probe - top_margin.max(0.0);
                if splittable && head_available > 1e-6 {
                    let sub_space = ConstraintSpace {
                        inline_size: hbox.border_width,
                        fragmentainer_remaining: Some(head_available),
                        fragmentainer_size: space.fragmentainer_size,
                        float_band: None,
                    };
                    let outcome = self.layout(tree, *child_id, &sub_space, None, cancel)?;
                    let Fragment::Box(head_root) = outcome.fragments.root else {
                        return Err(LayoutError::Invalid(
                            "float layout must produce a box fragment root".to_owned(),
                        ));
                    };
                    let occupy = if outcome.continuation.is_some() {
                        (page_bottom - fy_probe).max(0.0)
                    } else {
                        top_margin.max(0.0) + head_root.rect.height + bottom_margin.max(0.0)
                    };
                    let (fx, fy) =
                        floats.place(child_style.float, occupy_width, occupy, y, content_width);
                    fragments.push(Fragment::Box(BoxFragment {
                        source: *child_id,
                        rect: FragmentRect {
                            x: content_left + fx + hbox.x,
                            y: fy + top_margin.max(0.0),
                            width: hbox.border_width,
                            height: head_root.rect.height,
                        },
                        children: head_root.children,
                    }));
                    if let Some(sub_token) = outcome.continuation {
                        pending_float_breaks.push(FloatBreak {
                            child: *child_id,
                            token: sub_token,
                            depth: 0,
                        });
                    }
                    continue;
                }
                // Unsplittable (an inline-flow float) and over the edge: it
                // moves whole to the next fragmentainer, except that a
                // monolithic float taller than a fresh empty fragmentainer
                // still places to make progress rather than looping.
                if fragments.is_empty() && fragmentainer_is_fresh && pending_float_breaks.is_empty()
                {
                    let (fx, fy) = floats.place(
                        child_style.float,
                        occupy_width,
                        occupy_height,
                        y,
                        content_width,
                    );
                    fragments.push(Fragment::Box(BoxFragment {
                        source: *child_id,
                        rect: FragmentRect {
                            x: content_left + fx + hbox.x,
                            y: fy + top_margin.max(0.0),
                            width: hbox.border_width,
                            height: content_height,
                        },
                        children: inner_children,
                    }));
                    continue;
                }
                return Ok(sealed_with_break(
                    container,
                    space.inline_size,
                    seal_height(y, &floats),
                    fragments,
                    BreakToken {
                        resume_path: vec![*child_id],
                        stage: BreakTokenStage::Before,
                        pending_floats: std::mem::take(&mut pending_float_breaks),
                    },
                ));
            }

            // Forced breaks: `break-before: always` on this child (or a
            // pending `break-after: always` from the previous one) seals the
            // fragmentainer here. A break that lands at the top of a fresh
            // fragmentainer is already satisfied, per CSS fragmentation.
            let forces_break_before =
                pending_forced_break || child_style.break_before == PageBreakV1::Always;
            pending_forced_break = child_style.break_after == PageBreakV1::Always;
            if forces_break_before
                && space.fragmentainer_remaining.is_some()
                && !child_resumed
                && !(fragments.is_empty() && fragmentainer_is_fresh)
            {
                return Ok(sealed_with_break(
                    container,
                    space.inline_size,
                    seal_height(y, &floats),
                    fragments,
                    BreakToken {
                        resume_path: vec![*child_id],
                        stage: BreakTokenStage::Before,
                        pending_floats: std::mem::take(&mut pending_float_breaks),
                    },
                ));
            }

            // Clearance: an in-flow child clears past the floats its
            // `clear` names; clearance suppresses the margin collapse that
            // would otherwise apply.
            let clear_to = floats.bottom_for(child_style.clear);
            if clear_to > y {
                let page_bottom = y + remaining.max(0.0);
                y = clear_to;
                remaining = (page_bottom - y).max(0.0);
                pending_margin = 0.0;
            }

            // A margin that meets an unforced break is truncated to zero,
            // so a resumed child starts flush at the fragmentainer top.
            // At a collapsing root edge the first child's top margin
            // escapes the container (a plain block box in CSS), so content
            // starts flush at the top exactly like a browser chapter body.
            let gap = if child_resumed || (collapse_root_edges && index == start_child) {
                0.0
            } else {
                collapse_margins(pending_margin, top_margin)
            };
            let page_is_empty = fragments.is_empty() && fragmentainer_is_fresh;
            let gap = if page_is_empty {
                gap.min(remaining.max(0.0))
            } else {
                gap
            };
            let available = (remaining - gap).max(0.0);
            let child = tree.node(*child_id);
            match &child.content {
                FormattingNodeContent::SizedLeaf {
                    block_size,
                    breakable,
                } => {
                    let outstanding = block_size - consumed;
                    if outstanding <= available {
                        y += gap;
                        remaining -= gap;
                        fragments.push(leaf_fragment(
                            *child_id,
                            content_left,
                            y,
                            content_width,
                            outstanding,
                        ));
                        y += outstanding;
                        remaining -= outstanding;
                        pending_margin = bottom_margin;
                        continue;
                    }
                    if *breakable && available > 0.0 {
                        y += gap;
                        fragments.push(leaf_fragment(
                            *child_id,
                            content_left,
                            y,
                            content_width,
                            available,
                        ));
                        let already = block_size - (outstanding - available);
                        return Ok(sealed_with_break(
                            container,
                            space.inline_size,
                            y + available,
                            fragments,
                            BreakToken {
                                resume_path: vec![*child_id],
                                stage: BreakTokenStage::Inside {
                                    consumed_block_size: already,
                                },
                                pending_floats: std::mem::take(&mut pending_float_breaks),
                            },
                        ));
                    }
                    if !page_is_empty {
                        // Break before the child; the margin meeting this
                        // unforced break is truncated.
                        return Ok(sealed_with_break(
                            container,
                            space.inline_size,
                            y,
                            fragments,
                            BreakToken {
                                resume_path: vec![*child_id],
                                stage: BreakTokenStage::Before,
                                pending_floats: std::mem::take(&mut pending_float_breaks),
                            },
                        ));
                    }
                    // Monolithic child taller than a fresh fragmentainer:
                    // place it whole so pagination always progresses.
                    y += gap;
                    fragments.push(leaf_fragment(
                        *child_id,
                        content_left,
                        y,
                        content_width,
                        outstanding,
                    ));
                    y += outstanding;
                    let pending = std::mem::take(&mut pending_float_breaks);
                    let continuation = match children.get(index + 1) {
                        Some(next) => Some(BreakToken {
                            resume_path: vec![*next],
                            stage: BreakTokenStage::Before,
                            pending_floats: pending,
                        }),
                        None if !pending.is_empty() => Some(BreakToken {
                            resume_path: Vec::new(),
                            stage: BreakTokenStage::Before,
                            pending_floats: pending,
                        }),
                        None => None,
                    };
                    return Ok(LayoutOutcome {
                        fragments: sealed(container, space.inline_size, y, fragments),
                        continuation,
                escaped_floats: Vec::new(),
});
                }
                FormattingNodeContent::InlineFlow { .. } => {
                    let child_style = container_layout_style(tree, *child_id)?;
                    let hbox = resolve_horizontal_box(child_style, content_width)?;
                    // Floats beside this paragraph shorten its line boxes
                    // instead of pushing it down, which is what a browser
                    // does; the paragraph box itself keeps its position.
                    let band = floats.band_at(y, content_width);
                    let lines = self.inline_lines(
                        tree,
                        *child_id,
                        hbox.content_width,
                        space.fragmentainer_size,
                        band,
                        cancel,
                    )?;
                    // The paragraph's own top padding rides its first
                    // fragment; bottom padding rides the last.
                    let leading_padding = if consumed == 0.0 {
                        hbox.padding_top
                    } else {
                        0.0
                    };
                    let available_for_lines = (available - leading_padding).max(0.0);
                    let placement =
                        place_lines(&lines, consumed, available_for_lines, page_is_empty);
                    if placement.lines.is_empty() && !placement.exhausted {
                        // Nothing fits: break before (or inside, when
                        // resuming) with the meeting margin truncated.
                        return Ok(sealed_with_break(
                            container,
                            space.inline_size,
                            y,
                            fragments,
                            BreakToken {
                                resume_path: vec![*child_id],
                                stage: if child_resumed {
                                    BreakTokenStage::Inside {
                                        consumed_block_size: consumed,
                                    }
                                } else {
                                    BreakTokenStage::Before
                                },
                                pending_floats: std::mem::take(&mut pending_float_breaks),
                            },
                        ));
                    }
                    if !placement.lines.is_empty() {
                        y += gap;
                        remaining -= gap;
                        let trailing_padding = if placement.exhausted {
                            hbox.padding_bottom
                        } else {
                            0.0
                        };
                        let paragraph_height = leading_padding
                            + (placement.consumed_end - consumed)
                            + trailing_padding;
                        let children: Vec<Fragment> = placement
                            .lines
                            .into_iter()
                            .map(|mut line| {
                                let rect = line.rect();
                                set_fragment_position(
                                    &mut line,
                                    rect.x + hbox.padding_left,
                                    rect.y + leading_padding,
                                );
                                line
                            })
                            .collect();
                        fragments.push(Fragment::Box(BoxFragment {
                            source: *child_id,
                            rect: FragmentRect {
                                x: content_left + hbox.x,
                                y,
                                width: hbox.border_width,
                                height: paragraph_height,
                            },
                            children,
                        }));
                        y += paragraph_height;
                        remaining -= paragraph_height;
                    }
                    if placement.exhausted {
                        pending_margin = bottom_margin;
                        continue;
                    }
                    return Ok(sealed_with_break(
                        container,
                        space.inline_size,
                        y,
                        fragments,
                        BreakToken {
                            resume_path: vec![*child_id],
                            stage: BreakTokenStage::Inside {
                                consumed_block_size: placement.consumed_end,
                            },
                            pending_floats: std::mem::take(&mut pending_float_breaks),
                        },
                    ));
                }
                FormattingNodeContent::Table => {
                    let child_style = container_layout_style(tree, *child_id)?;
                    let hbox = resolve_horizontal_box(child_style, content_width)?;
                    let table = self.layout_table(tree, *child_id, hbox.border_width, cancel)?;
                    // A table shrinks to fit, so its auto margins resolve
                    // against the used width, not the available one: this
                    // is what centers `margin: 0 auto` tables.
                    let table_x = shrink_to_fit_offset(child_style, content_width, table.rect.width);
                    let table_height = table.rect.height;
                    if table_height > available && !page_is_empty {
                        return Ok(sealed_with_break(
                            container,
                            space.inline_size,
                            seal_height(y, &floats),
                            fragments,
                            BreakToken {
                                resume_path: vec![*child_id],
                                stage: BreakTokenStage::Before,
                                pending_floats: std::mem::take(&mut pending_float_breaks),
                            },
                        ));
                    }
                    y += gap;
                    remaining -= gap;
                    fragments.push(Fragment::Box(BoxFragment {
                        source: *child_id,
                        rect: FragmentRect {
                            x: content_left + table_x,
                            y,
                            width: table.rect.width,
                            height: table_height,
                        },
                        children: table.children,
                    }));
                    y += table_height;
                    remaining -= table_height;
                    pending_margin = bottom_margin;
                    continue;
                }
                FormattingNodeContent::TableRow | FormattingNodeContent::TableCell { .. } => {
                    return Err(LayoutError::Invalid(
                        "table rows and cells appear only inside a table".to_owned(),
                    ));
                }
                FormattingNodeContent::BlockContainer => {
                    let child_style = container_layout_style(tree, *child_id)?;
                    let hbox = resolve_horizontal_box(child_style, content_width)?;
                    let child_token = if child_resumed {
                        descend_token(token, consumed)?
                    } else {
                        None
                    };
                    let child_space = ConstraintSpace {
                        inline_size: hbox.border_width,
                        fragmentainer_remaining: space.fragmentainer_remaining.map(|_| available),
                        fragmentainer_size: space.fragmentainer_size,
                        // Floats active here keep excluding inside the
                        // child unless the child is its own formatting
                        // root, so its own floats stack beside them.
                        float_band: if is_flow_root(child_style) {
                            None
                        } else {
                            floats.band_at(y + gap, content_width)
                        },
                    };
                    let outcome = self.layout_container(
                        tree,
                        *child_id,
                        &child_space,
                        child_token.as_ref(),
                        cancel,
                        false,
                    )?;
                    let Fragment::Box(child_root) = outcome.fragments.root else {
                        return Err(LayoutError::Invalid(
                            "container layout must produce a box fragment root".to_owned(),
                        ));
                    };
                    if !child_root.children.is_empty() {
                        y += gap;
                        remaining -= gap;
                        let child_height = child_root.rect.height;
                        let child_top = y;
                        fragments.push(Fragment::Box(BoxFragment {
                            source: *child_id,
                            rect: FragmentRect {
                                x: content_left + hbox.x,
                                y,
                                width: hbox.border_width,
                                height: child_height,
                            },
                            children: child_root.children,
                        }));
                        y += child_height;
                        remaining -= child_height;
                        // Floats the child could not contain keep excluding
                        // content here, translated into this container's
                        // coordinates.
                        for escaped in outcome.escaped_floats {
                            let adopted = rito_fragment::EscapedFloat {
                                top: escaped.top + child_top,
                                bottom: escaped.bottom + child_top,
                                ..escaped
                            };
                            floats.adopt(adopted, content_width);
                            placed_floats.push(adopted);
                        }
                    }
                    match outcome.continuation {
                        None => {
                            pending_margin = bottom_margin;
                            continue;
                        }
                        Some(inner) => {
                            // The inner container's split floats ride along
                            // one level deeper; this container's own ride at
                            // depth 0. Each descent strips a level, so the
                            // splitting container gets its floats back.
                            let mut resume_path = Vec::with_capacity(inner.resume_path.len() + 1);
                            resume_path.push(*child_id);
                            resume_path.extend(inner.resume_path);
                            let mut pending_floats = std::mem::take(&mut pending_float_breaks);
                            pending_floats.extend(inner.pending_floats.into_iter().map(|entry| {
                                FloatBreak {
                                    depth: entry.depth + 1,
                                    ..entry
                                }
                            }));
                            return Ok(sealed_with_break(
                                container,
                                space.inline_size,
                                y,
                                fragments,
                                BreakToken {
                                    resume_path,
                                    stage: inner.stage,
                                    pending_floats,
                                },
                            ));
                        }
                    }
                }
            }
        }
        // Only a formatting-context root contains its floats: its height
        // reaches the deepest float bottom, and nothing escapes. Anywhere
        // else the floats overflow the box and travel outward, exactly as
        // CSS keeps them in the nearest ancestor root.
        let escaped_floats = if is_flow_root(container_style) || collapse_root_edges {
            y = seal_height(y, &floats);
            Vec::new()
        } else {
            placed_floats
                .into_iter()
                .filter(|float| float.bottom > y + 1e-6)
                .collect()
        };
        // At a collapsing root edge the last child's bottom margin escapes
        // the container, like a browser chapter body. Nested containers keep
        // it inside their height (formatting-context-root semantics until
        // the full through-collapse protocol lands); at a fragmentainer edge
        // it truncates rather than forcing another page.
        if !collapse_root_edges {
            y += pending_margin.min(remaining.max(0.0));
            remaining -= pending_margin;
        }
        // The container's bottom padding closes its final fragment,
        // truncated at a fragmentainer edge like a meeting margin.
        y += container_padding_bottom.min(remaining.max(0.0));
        // A specified height fixes the border-box height. Content shorter
        // than the box leaves empty space (spacers); taller content
        // overflows the fixed box visibly — the box keeps its height and
        // following flow continues below it, like CSS overflow: visible.
        if let Some(fixed) = resolve_fixed_height(
            container_style,
            container_padding_top + container_padding_bottom,
        )? {
            y = fixed;
        }
        // Split floats still running past this fragmentainer resume on the
        // next one even though every in-flow child is done.
        let continuation = if pending_float_breaks.is_empty() {
            None
        } else {
            Some(BreakToken {
                resume_path: Vec::new(),
                stage: BreakTokenStage::Before,
                pending_floats: std::mem::take(&mut pending_float_breaks),
            })
        };
        Ok(LayoutOutcome {
            fragments: sealed(container, space.inline_size, y, fragments),
            continuation,
            escaped_floats,
        })
    }

    /// A floated child's horizontal box: a resolvable width is used
    /// directly, an auto width shrinks to fit its content (CSS 10.3.5 —
    /// as wide as its widest unbroken content wants, capped by the space
    /// left after margins and padding, never narrower than its longest
    /// unbreakable piece). Floats never resolve auto margins to centering.
    fn resolve_float_box(
        &self,
        tree: &FormattingTree,
        child_id: FormattingNodeId,
        child_style: &LayoutFormattingStyleV1,
        content_width: f64,
    ) -> Result<HorizontalBox, LayoutError> {
        let hbox = resolve_horizontal_box(child_style, content_width)?;
        if !(matches!(child_style.width, PreferredSizeV1::Auto)
            && child_style.max_width == MaximumSizeV1::None)
        {
            return Ok(hbox);
        }
        let sizes = self.intrinsic_inline_sizes(tree, child_id)?;
        let resolve = |value| resolve_length_percentage(value, content_width);
        let margin_used = [child_style.margin.left, child_style.margin.right]
            .iter()
            .map(|side| match side {
                LengthPercentageOrAuto::Auto => 0.0,
                LengthPercentageOrAuto::Value(value) => resolve(*value),
            })
            .sum::<f64>();
        let padding_left = resolve(child_style.padding.left.value()).max(0.0);
        let padding_right = resolve(child_style.padding.right.value()).max(0.0);
        let available = (content_width - margin_used - padding_left - padding_right).max(0.0);
        let fit = sizes
            .max_content
            .min(available)
            .max(sizes.min_content.min(available));
        Ok(HorizontalBox {
            x: match child_style.margin.left {
                LengthPercentageOrAuto::Auto => 0.0,
                LengthPercentageOrAuto::Value(value) => resolve(value),
            },
            border_width: fit + padding_left + padding_right,
            padding_left,
            content_width: fit,
            padding_top: hbox.padding_top,
            padding_bottom: hbox.padding_bottom,
        })
    }

    /// Lays an inline flow out in continuous space through the internal
    /// cache and returns its line fragments in paragraph coordinates.
    fn inline_lines(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        inline_size: f64,
        page_block_size: Option<f64>,
        float_band: Option<rito_fragment::FloatBand>,
        cancel: &CancelFlag,
    ) -> Result<Vec<Fragment>, LayoutError> {
        // Paragraphs lay out continuously — line-level slicing into pages
        // happens here in the block container — but the provider still
        // needs the page block size so replaced content can honor the
        // reader's one-page bound.
        let space = ConstraintSpace {
            inline_size,
            fragmentainer_remaining: None,
            fragmentainer_size: page_block_size,
            float_band,
        };
        let outcome = self
            .inline_cache
            .borrow_mut()
            .layout(&self.inline, tree, node, &space, None, cancel)?
            .outcome;
        let Fragment::Box(root) = outcome.fragments.root else {
            return Err(LayoutError::Invalid(
                "inline provider must produce a box fragment root".to_owned(),
            ));
        };
        Ok(root.children)
    }
}

/// Lines chosen for the current fragmentainer, shifted into fragment-local
/// coordinates (relative to the paragraph fragment's top).
struct LinePlacement {
    lines: Vec<Fragment>,
    /// Paragraph-coordinate bottom edge of the last placed line.
    consumed_end: f64,
    /// Whether every remaining line of the paragraph was placed.
    exhausted: bool,
}

fn place_lines(
    lines: &[Fragment],
    consumed: f64,
    remaining: f64,
    fragmentainer_is_empty: bool,
) -> LinePlacement {
    let mut placed = Vec::new();
    let mut consumed_end = consumed;
    let mut used = 0.0_f64;
    for line in lines {
        let rect = line.rect();
        let bottom = rect.y + rect.height;
        // Resumed lines: skip everything a previous fragmentainer consumed.
        if bottom <= consumed + f64::EPSILON {
            continue;
        }
        let fits = used + rect.height <= remaining + f64::EPSILON;
        let force_first = placed.is_empty() && fragmentainer_is_empty;
        if !fits && !force_first {
            return LinePlacement {
                lines: placed,
                consumed_end,
                exhausted: false,
            };
        }
        // The line's fragment-local top is the block distance consumed so
        // far inside this fragmentainer's paragraph chunk.
        let mut shifted = line.clone();
        set_fragment_y(&mut shifted, used);
        placed.push(shifted);
        used += rect.height;
        consumed_end = bottom;
    }
    LinePlacement {
        lines: placed,
        consumed_end,
        exhausted: true,
    }
}

fn set_fragment_y(fragment: &mut Fragment, y: f64) {
    match fragment {
        Fragment::Box(inner) => inner.rect.y = y,
        Fragment::Line(inner) => inner.rect.y = y,
        Fragment::Text(inner) => inner.rect.y = y,
        Fragment::Image(inner) => inner.rect.y = y,
    }
}

impl<I: FormattingContext> BlockFormattingContext<I> {
    /// Lays a table out whole: CSS automatic column sizing over the
    /// cells' intrinsic widths (a spanning cell spreads its demand evenly),
    /// shrink-to-fit table width, each row as tall as its tallest cell.
    /// Fragmentation is at the table's granularity in this version — the
    /// caller breaks before the table when it does not fit.
    fn layout_table(
        &self,
        tree: &FormattingTree,
        table: FormattingNodeId,
        available_width: f64,
        cancel: &CancelFlag,
    ) -> Result<BoxFragment, LayoutError> {
        struct GridCell {
            node: FormattingNodeId,
            column: usize,
            span: usize,
        }
        let mut grid: Vec<Vec<GridCell>> = Vec::new();
        let mut column_count = 0usize;
        for row_id in &tree.node(table).children {
            let FormattingNodeContent::TableRow = tree.node(*row_id).content else {
                return Err(LayoutError::Invalid(
                    "table children must be rows".to_owned(),
                ));
            };
            let mut cells = Vec::new();
            let mut column = 0usize;
            for cell_id in &tree.node(*row_id).children {
                let FormattingNodeContent::TableCell { col_span } = tree.node(*cell_id).content
                else {
                    return Err(LayoutError::Invalid(
                        "table-row children must be cells".to_owned(),
                    ));
                };
                let span = (col_span as usize).max(1);
                cells.push(GridCell {
                    node: *cell_id,
                    column,
                    span,
                });
                column += span;
            }
            column_count = column_count.max(column);
            grid.push(cells);
        }
        if column_count == 0 {
            return Ok(BoxFragment {
                source: table,
                rect: FragmentRect {
                    x: 0.0,
                    y: 0.0,
                    width: 0.0,
                    height: 0.0,
                },
                children: Vec::new(),
            });
        }
        let mut min_widths = vec![0.0_f64; column_count];
        let mut max_widths = vec![0.0_f64; column_count];
        // A column whose cells specify a width takes that width as its
        // preferred size; the other cells in the column wrap to it rather
        // than widening the column with their own content maximum.
        let mut specified_widths = vec![None::<f64>; column_count];
        let mut column_percentages = vec![None::<f64>; column_count];
        for row in &grid {
            for cell in row {
                let sizes = self.cell_intrinsic_sizes(tree, cell.node)?;
                let share = cell.span as f64;
                for offset in 0..cell.span {
                    let column = cell.column + offset;
                    min_widths[column] = min_widths[column].max(sizes.min_content / share);
                    max_widths[column] = max_widths[column].max(sizes.max_content / share);
                    if let Some(specified) = sizes.specified {
                        let share = specified / share;
                        specified_widths[column] = Some(
                            specified_widths[column].map_or(share, |best: f64| best.max(share)),
                        );
                    }
                    if let Some(percentage) = sizes.percentage {
                        column_percentages[column] = Some(
                            column_percentages[column]
                                .map_or(percentage, |best: f64| best.max(percentage)),
                        );
                    }
                }
            }
        }
        for column in 0..column_count {
            if let Some(specified) = specified_widths[column] {
                max_widths[column] = specified.max(min_widths[column]);
            }
        }
        let table_style = container_layout_style(tree, table)?;
        let (spacing_x, spacing_y) = (
            f64::from(table_style.border_spacing.0.get()),
            f64::from(table_style.border_spacing.1.get()),
        );
        let spacing_total = spacing_x * (column_count as f64 + 1.0);
        let content_available = (available_width - spacing_total).max(0.0);
        let sum_min: f64 = min_widths.iter().sum();
        let sum_max: f64 = max_widths.iter().sum();
        let mut columns: Vec<f64> = if sum_max <= content_available {
            max_widths.clone()
        } else if sum_min >= content_available {
            // Overflow: columns keep their minimums, like a browser table
            // wider than its containing block.
            min_widths.clone()
        } else {
            let scale = (content_available - sum_min) / (sum_max - sum_min).max(f64::EPSILON);
            min_widths
                .iter()
                .zip(&max_widths)
                .map(|(min, max)| min + (max - min) * scale)
                .collect()
        };
        // A percentage column asks for a share of the table itself, so it
        // sizes the table rather than being sized by it: the table grows
        // until the column's content fits inside its share, bounded by the
        // space available. The remaining columns then split what is left.
        if column_percentages.iter().any(Option::is_some) {
            let mut demanded: f64 = columns.iter().sum();
            for (column, percentage) in column_percentages.iter().enumerate() {
                if let Some(percentage) = percentage {
                    demanded = demanded.max(max_widths[column] / percentage);
                }
            }
            let content_width = demanded.min(content_available).max(sum_min);
            let mut leftover = content_width;
            for (column, percentage) in column_percentages.iter().enumerate() {
                if let Some(percentage) = percentage {
                    columns[column] = (percentage * content_width).max(min_widths[column]);
                    leftover -= columns[column];
                }
            }
            let plain: Vec<usize> = (0..column_count)
                .filter(|column| column_percentages[*column].is_none())
                .collect();
            if plain.is_empty() {
                // Nothing else to absorb the table's width: the percentage
                // columns share it in proportion to their own demand.
                let total: f64 = columns.iter().sum();
                if total > 0.0 {
                    for width in columns.iter_mut() {
                        *width += leftover * (*width / total);
                    }
                }
            } else if leftover > 0.0 {
                let total: f64 = plain.iter().map(|column| max_widths[*column]).sum();
                for column in plain {
                    let share = if total > 0.0 {
                        max_widths[column] / total
                    } else {
                        1.0 / column_count as f64
                    };
                    columns[column] = leftover * share;
                }
            }
        }
        // Separate-borders spacing sits between every pair of cells and
        // around the grid, so a column's offset carries one gap per
        // preceding column plus the leading edge.
        let mut offsets = vec![0.0_f64; column_count + 1];
        offsets[0] = spacing_x;
        for index in 0..column_count {
            offsets[index + 1] = offsets[index] + columns[index] + spacing_x;
        }
        let table_width = offsets[column_count];

        let mut rows = Vec::with_capacity(grid.len());
        let mut y = spacing_y;
        for (row_index, row) in grid.iter().enumerate() {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            let row_id = tree.node(table).children[row_index];
            let mut cell_fragments = Vec::with_capacity(row.len());
            let mut cell_heights = Vec::with_capacity(row.len());
            let mut row_height = 0.0_f64;
            for cell in row {
                    let cell_width = offsets[cell.column + cell.span]
                    - offsets[cell.column]
                    - spacing_x;
                let outcome = self.layout_container(
                    tree,
                    cell.node,
                    &ConstraintSpace::continuous(cell_width),
                    None,
                    cancel,
                    false,
                )?;
                let Fragment::Box(mut cell_root) = outcome.fragments.root else {
                    return Err(LayoutError::Invalid(
                        "cell layout must produce a box fragment".to_owned(),
                    ));
                };
                cell_root.source = cell.node;
                cell_root.rect.x = offsets[cell.column] - spacing_x;
                cell_root.rect.width = cell_width;
                row_height = row_height.max(cell_root.rect.height);
                cell_heights.push(cell_root.rect.height);
                cell_fragments.push(cell_root);
            }
            // Cells stretch to the row height, matching the separate-border
            // table model's uniform row boxes, and align their content
            // inside that box per `vertical-align`. Baseline alignment
            // falls back to the top edge until cell baselines are tracked.
            for (cell_root, content_height) in cell_fragments.iter_mut().zip(&cell_heights) {
                let free = (row_height - content_height).max(0.0);
                let shift = match container_layout_style(tree, cell_root.source)?.vertical_align {
                    rito_style_contract::CellVerticalAlignV1::Middle => free / 2.0,
                    rito_style_contract::CellVerticalAlignV1::Bottom => free,
                    rito_style_contract::CellVerticalAlignV1::Top
                    | rito_style_contract::CellVerticalAlignV1::Baseline => 0.0,
                };
                if shift > 0.0 {
                    for child in &mut cell_root.children {
                        translate_fragment(child, 0.0, shift);
                    }
                }
                cell_root.rect.height = row_height;
                cell_root.rect.y = 0.0;
            }
            rows.push(Fragment::Box(BoxFragment {
                source: row_id,
                rect: FragmentRect {
                    x: spacing_x,
                    y,
                    width: (table_width - 2.0 * spacing_x).max(0.0),
                    height: row_height,
                },
                children: cell_fragments.into_iter().map(Fragment::Box).collect(),
            }));
            y += row_height + spacing_y;
        }
        Ok(BoxFragment {
            source: table,
            rect: FragmentRect {
                x: 0.0,
                y: 0.0,
                width: table_width,
                height: y,
            },
            children: rows,
        })
    }

    /// A cell's intrinsic inline bounds including its own horizontal
    /// padding (borders are absorbed as padding upstream).
    ///
    /// A cell with a definite `width` contributes that width rather than
    /// its content's maximum: CSS's automatic table layout treats a
    /// specified cell width as the column's preferred width, floored by
    /// the content minimum.
    fn cell_intrinsic_sizes(
        &self,
        tree: &FormattingTree,
        cell: FormattingNodeId,
    ) -> Result<CellIntrinsicSizes, LayoutError> {
        let mut sizes = self.intrinsic_inline_sizes(tree, cell)?;
        let style = container_layout_style(tree, cell)?;
        let pad = |side: rito_style_contract::NonNegativeLengthPercentage| match side.value() {
            LengthPercentage::Length(px) => f64::from(px.get()),
            _ => 0.0,
        };
        let padding = pad(style.padding.left) + pad(style.padding.right);
        // Percentages resolve against the table width, which the column
        // algorithm has not established yet; only definite lengths take
        // part here, and content sizing covers the rest.
        let mut specified = None;
        let mut percentage = None;
        if let rito_style_contract::PreferredSizeV1::Value(width) = style.width {
            match width.value() {
                LengthPercentage::Length(px) => specified = Some(f64::from(px.get()) + padding),
                LengthPercentage::Percentage(ratio) => {
                    let ratio = f64::from(ratio.ratio());
                    if ratio > 0.0 {
                        percentage = Some(ratio);
                    }
                }
                LengthPercentage::Linear { .. } => {}
            }
        }
        sizes.min_content += padding;
        sizes.max_content += padding;
        Ok(CellIntrinsicSizes {
            min_content: sizes.min_content,
            max_content: sizes.max_content,
            specified,
            percentage,
        })
    }
}

impl<I: FormattingContext> FormattingContext for BlockFormattingContext<I> {
    fn layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&BreakToken>,
        cancel: &CancelFlag,
    ) -> Result<LayoutOutcome, LayoutError> {
        match &tree.node(node).content {
            FormattingNodeContent::BlockContainer => {
                self.layout_container(tree, node, space, token, cancel, true)
            }
            FormattingNodeContent::InlineFlow { .. } => {
                self.inline.layout(tree, node, space, token, cancel)
            }
            FormattingNodeContent::SizedLeaf { .. } => Err(LayoutError::Invalid(
                "a sized leaf has no formatting context of its own; lay out its container"
                    .to_owned(),
            )),
            FormattingNodeContent::Table => {
                let fragment = self.layout_table(tree, node, space.inline_size, cancel)?;
                Ok(LayoutOutcome {
                    fragments: FragmentTree {
                        root: Fragment::Box(fragment),
                    },
                    continuation: None,
                    escaped_floats: Vec::new(),
                })
            }
            FormattingNodeContent::TableRow | FormattingNodeContent::TableCell { .. } => Err(
                LayoutError::Invalid("table rows and cells lay out through their table".to_owned()),
            ),
        }
    }

    fn intrinsic_inline_sizes(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
    ) -> Result<IntrinsicInlineSizes, LayoutError> {
        if node.0 as usize >= tree.len() {
            return Err(LayoutError::Invalid(format!(
                "intrinsic-size query for out-of-bounds node {}",
                node.0
            )));
        }
        match &tree.node(node).content {
            FormattingNodeContent::SizedLeaf { .. } => Ok(IntrinsicInlineSizes {
                min_content: 0.0,
                max_content: 0.0,
            }),
            FormattingNodeContent::InlineFlow { .. } => {
                let sizes = self.inline.intrinsic_inline_sizes(tree, node)?;
                Ok(own_width_contribution(tree, node, sizes)?)
            }
            FormattingNodeContent::Table | FormattingNodeContent::TableRow => {
                // A table is as wide as its widest row; a row sums its cells.
                let mut sizes = IntrinsicInlineSizes {
                    min_content: 0.0,
                    max_content: 0.0,
                };
                for child in &tree.node(node).children {
                    let child_sizes = self.intrinsic_inline_sizes(tree, *child)?;
                    if matches!(tree.node(node).content, FormattingNodeContent::TableRow) {
                        sizes.min_content += child_sizes.min_content;
                        sizes.max_content += child_sizes.max_content;
                    } else {
                        sizes.min_content = sizes.min_content.max(child_sizes.min_content);
                        sizes.max_content = sizes.max_content.max(child_sizes.max_content);
                    }
                }
                Ok(sizes)
            }
            FormattingNodeContent::TableCell { .. } | FormattingNodeContent::BlockContainer => {
                let mut sizes = IntrinsicInlineSizes {
                    min_content: 0.0,
                    max_content: 0.0,
                };
                for child in &tree.node(node).children {
                    let child_sizes = self.intrinsic_inline_sizes(tree, *child)?;
                    sizes.min_content = sizes.min_content.max(child_sizes.min_content);
                    sizes.max_content = sizes.max_content.max(child_sizes.max_content);
                }
                own_width_contribution(tree, node, sizes)
            }
        }
    }
}

/// Strips the leading path segment from a break token so a child container
/// resumes at exactly the interrupted descendant. A token whose path ends
/// at the container itself is only meaningful as `Before` (handled by the
/// caller as a fresh start); `Inside` cannot address a container directly.
fn descend_token(
    token: Option<&BreakToken>,
    consumed: f64,
) -> Result<Option<BreakToken>, LayoutError> {
    let Some(token) = token else {
        return Ok(None);
    };
    // Floats deeper than this level descend with the path, one level
    // stripped, so the container that split them consumes them at its own
    // depth 0.
    let descended_floats: Vec<FloatBreak> = token
        .pending_floats
        .iter()
        .filter(|entry| entry.depth > 0)
        .map(|entry| FloatBreak {
            child: entry.child,
            token: entry.token.clone(),
            depth: entry.depth - 1,
        })
        .collect();
    if token.resume_path.len() > 1 {
        return Ok(Some(BreakToken {
            resume_path: token.resume_path[1..].to_vec(),
            stage: token.stage,
            pending_floats: descended_floats,
        }));
    }
    if !descended_floats.is_empty() {
        // The named child finished its in-flow content on the previous
        // fragmentainer; only its split floats resume.
        return Ok(Some(BreakToken {
            resume_path: Vec::new(),
            stage: BreakTokenStage::Before,
            pending_floats: descended_floats,
        }));
    }
    if consumed != 0.0 {
        return Err(LayoutError::Invalid(
            "a break token cannot resume inside a block container without naming the \
             interrupted descendant"
                .to_owned(),
        ));
    }
    Ok(None)
}

fn resume_point(
    children: &[FormattingNodeId],
    token: Option<&BreakToken>,
) -> Result<(usize, f64), LayoutError> {
    let Some(token) = token else {
        return Ok((0, 0.0));
    };
    let Some(target) = token.resume_path.first() else {
        if token.pending_floats.is_empty() {
            return Err(LayoutError::Invalid(
                "break token carries an empty resume path".to_owned(),
            ));
        }
        // Only split floats resume: every in-flow child already finished.
        return Ok((children.len(), 0.0));
    };
    let index = children
        .iter()
        .position(|child| child == target)
        .ok_or_else(|| {
            LayoutError::Invalid(format!("break token resumes at unknown child {}", target.0))
        })?;
    match token.stage {
        BreakTokenStage::Before => Ok((index, 0.0)),
        BreakTokenStage::Inside {
            consumed_block_size,
        } => Ok((index, consumed_block_size)),
    }
}

/// Raises a box's intrinsic contribution to its own definite width: a
/// fixed-width box is that wide whatever its content asks for, so that is
/// what an ancestor must size itself around. A table cell is the
/// exception — its width belongs to the column algorithm, which reads it
/// separately and would otherwise count it twice.
fn own_width_contribution(
    tree: &FormattingTree,
    node: FormattingNodeId,
    mut sizes: IntrinsicInlineSizes,
) -> Result<IntrinsicInlineSizes, LayoutError> {
    if matches!(
        tree.node(node).content,
        FormattingNodeContent::TableCell { .. }
    ) {
        return Ok(sizes);
    }
    let style = container_layout_style(tree, node)?;
    let rito_style_contract::PreferredSizeV1::Value(width) = style.width else {
        return Ok(sizes);
    };
    let LengthPercentage::Length(px) = width.value() else {
        return Ok(sizes);
    };
    let pad = |side: rito_style_contract::NonNegativeLengthPercentage| match side.value() {
        LengthPercentage::Length(px) => f64::from(px.get()),
        _ => 0.0,
    };
    let outer = match style.box_sizing {
        BoxSizingV1::ContentBox => {
            f64::from(px.get()) + pad(style.padding.left) + pad(style.padding.right)
        }
        BoxSizingV1::BorderBox => f64::from(px.get()),
    };
    sizes.min_content = sizes.min_content.max(outer);
    sizes.max_content = sizes.max_content.max(outer);
    Ok(sizes)
}

/// Whether a container establishes a formatting context, which is what
/// makes it contain its own floats. Floats and non-visible overflow do it
/// in CSS, as does `display: flow-root`.
fn is_flow_root(style: &LayoutFormattingStyleV1) -> bool {
    style.float != FloatV1::None
        || style.overflow != rito_style_contract::OverflowV1::Visible
        || matches!(
            style.display.inside,
            rito_style_contract::LayoutDisplayInsideV1::FlowRoot
        )
}

/// A container's sealed height: the flow position or the deepest float
/// bottom, whichever is lower (the container is a flow root and contains
/// its floats).
fn seal_height(y: f64, floats: &FloatBands) -> f64 {
    y.max(floats.left_bottom).max(floats.right_bottom)
}

/// Active float occupancy inside one container, in flow coordinates.
///
/// The supported profile is placed float boxes (paired columns, decorative
/// side boxes): floats stack horizontally in a band while they fit, start
/// a new band below both sides when they do not, and in-flow content after
/// them must clear — line boxes never shorten around a float here, they
/// fail closed instead.
struct FloatBands {
    /// Occupied width on the left side of the current band.
    left_occupied: f64,
    /// Occupied width on the right side of the current band.
    right_occupied: f64,
    /// Top of the current band, flow coordinates.
    band_top: f64,
    /// Deepest bottom edge of any left float.
    left_bottom: f64,
    /// Deepest bottom edge of any right float.
    right_bottom: f64,
}

impl FloatBands {
    fn new() -> Self {
        Self {
            left_occupied: 0.0,
            right_occupied: 0.0,
            band_top: 0.0,
            left_bottom: f64::NEG_INFINITY,
            right_bottom: f64::NEG_INFINITY,
        }
    }

    fn has_active(&self, flow_y: f64) -> bool {
        self.left_bottom > flow_y || self.right_bottom > flow_y
    }

    /// Seeds the bands with an ancestor's exclusion at this container's
    /// origin, so floats placed here stack beside it instead of on top.
    fn from_incoming(band: Option<rito_fragment::FloatBand>) -> Self {
        let mut bands = Self::new();
        if let Some(band) = band {
            bands.left_occupied = band.left_inset;
            bands.right_occupied = band.right_inset;
            if band.left_inset > 0.0 {
                bands.left_bottom = band.bottom;
            }
            if band.right_inset > 0.0 {
                bands.right_bottom = band.bottom;
            }
        }
        bands
    }

    /// Registers a float that escaped a descendant container so it keeps
    /// excluding content in this one.
    fn adopt(&mut self, float: rito_fragment::EscapedFloat, content_width: f64) {
        let _ = content_width;
        if float.right_side {
            self.right_occupied = self.right_occupied.max(float.width);
            self.right_bottom = self.right_bottom.max(float.bottom);
        } else {
            self.left_occupied = self.left_occupied.max(float.width);
            self.left_bottom = self.left_bottom.max(float.bottom);
        }
        self.band_top = self.band_top.max(float.top);
    }

    /// The exclusion an in-flow paragraph starting at `flow_y` sees: how
    /// much inline space each side withholds, and how far down the band
    /// reaches. `None` once no float overlaps that position.
    fn band_at(&self, flow_y: f64, content_width: f64) -> Option<rito_fragment::FloatBand> {
        let bottom = self.left_bottom.max(self.right_bottom);
        if bottom <= flow_y + 1e-6 {
            return None;
        }
        let left_inset = if self.left_bottom > flow_y + 1e-6 {
            self.left_occupied
        } else {
            0.0
        };
        let right_inset = if self.right_bottom > flow_y + 1e-6 {
            self.right_occupied
        } else {
            0.0
        };
        if left_inset + right_inset <= 0.0 || left_inset + right_inset >= content_width {
            return None;
        }
        Some(rito_fragment::FloatBand {
            left_inset,
            right_inset,
            bottom: bottom - flow_y,
        })
    }

    fn bottom_for(&self, clear: ClearV1) -> f64 {
        match clear {
            ClearV1::None => f64::NEG_INFINITY,
            ClearV1::Left => self.left_bottom,
            ClearV1::Right => self.right_bottom,
            ClearV1::Both => self.left_bottom.max(self.right_bottom),
        }
    }

    /// The band top a float of `width` would land on, starting no higher
    /// than `flow_y`, without committing anything.
    fn probe_y(&self, width: f64, flow_y: f64, content_width: f64) -> f64 {
        let mut left_occupied = self.left_occupied;
        let mut right_occupied = self.right_occupied;
        let mut band_top = self.band_top;
        if flow_y > band_top {
            if self.left_bottom <= flow_y && self.right_bottom <= flow_y {
                left_occupied = 0.0;
                right_occupied = 0.0;
            }
            band_top = band_top.max(flow_y);
        }
        if left_occupied + right_occupied + width > content_width + 1e-6 {
            band_top = self.left_bottom.max(self.right_bottom).max(band_top);
        }
        band_top
    }

    /// Places one float of `width`, starting no higher than `flow_y`.
    /// Returns the border-box x (content-area relative) and y.
    fn place(
        &mut self,
        side: FloatV1,
        width: f64,
        height: f64,
        flow_y: f64,
        content_width: f64,
    ) -> (f64, f64) {
        if flow_y > self.band_top {
            // Flow advanced past this band: floats placed from here start
            // a fresh band at the flow position.
            if self.left_bottom <= flow_y && self.right_bottom <= flow_y {
                self.left_occupied = 0.0;
                self.right_occupied = 0.0;
            }
            self.band_top = self.band_top.max(flow_y);
        }
        let fits = self.left_occupied + self.right_occupied + width <= content_width + 1e-6;
        if !fits {
            // New band below everything currently floated.
            self.band_top = self.left_bottom.max(self.right_bottom).max(self.band_top);
            self.left_occupied = 0.0;
            self.right_occupied = 0.0;
        }
        let y = self.band_top;
        debug_assert!((y - self.band_top).abs() < 1e-9);
        let x = match side {
            FloatV1::Left => {
                let x = self.left_occupied;
                self.left_occupied += width;
                self.left_bottom = self.left_bottom.max(y + height);
                x
            }
            FloatV1::Right | FloatV1::None => {
                let x = content_width - self.right_occupied - width;
                self.right_occupied += width;
                self.right_bottom = self.right_bottom.max(y + height);
                x
            }
        };
        (x, y)
    }
}

/// The container's resolved layout style from the tree's typed table.
fn container_layout_style(
    tree: &FormattingTree,
    node: FormattingNodeId,
) -> Result<&LayoutFormattingStyleV1, LayoutError> {
    let styles = tree.styles().ok_or_else(|| {
        LayoutError::Invalid("block layout requires the tree to carry style tables".to_owned())
    })?;
    styles
        .layout
        .style(tree.node(node).style)
        .map_err(|error| LayoutError::Invalid(error.to_string()))
}

/// One in-flow child's resolved horizontal geometry within its containing
/// block: border-box offset and width, plus the padding that separates the
/// border box from the content area.
struct HorizontalBox {
    /// Border-box x relative to the containing block's content area.
    x: f64,
    /// Border-box width (no borders yet, so padding plus content).
    border_width: f64,
    /// Left padding: content-area offset inside the border box.
    padding_left: f64,
    /// Content-area width available to the child's own layout.
    content_width: f64,
    /// Vertical padding, part of the child's own block size.
    padding_top: f64,
    padding_bottom: f64,
}

/// CSS block-level horizontal resolution: `margin + padding + width =
/// containing width`. An `auto` width fills what the margins leave; a
/// specified width distributes leftover space to `auto` margins (centering
/// with both auto), clamped at zero so over-wide content overflows to the
/// end side like a browser.
fn resolve_horizontal_box(
    style: &LayoutFormattingStyleV1,
    containing_width: f64,
) -> Result<HorizontalBox, LayoutError> {
    let resolve = |value: LengthPercentage| resolve_length_percentage(value, containing_width);
    let padding_left = resolve(style.padding.left.value()).max(0.0);
    let padding_right = resolve(style.padding.right.value()).max(0.0);
    let padding_top = resolve(style.padding.top.value()).max(0.0);
    let padding_bottom = resolve(style.padding.bottom.value()).max(0.0);
    let margin = |side: LengthPercentageOrAuto| -> Option<f64> {
        match side {
            LengthPercentageOrAuto::Auto => None,
            LengthPercentageOrAuto::Value(value) => Some(resolve(value)),
        }
    };
    let margin_left = margin(style.margin.left);
    let margin_right = margin(style.margin.right);
    let width = match style.width {
        PreferredSizeV1::Auto => None,
        PreferredSizeV1::Value(value) => Some(resolve(value.value()).max(0.0)),
        other => {
            return Err(LayoutError::Invalid(format!(
                "block width {other:?} is not representable yet"
            )));
        }
    };
    // max-width caps the used width; an auto width capped below the
    // available space behaves like a specified width (so auto margins can
    // center the capped box, the common `max-width + margin:auto` pattern).
    let max_width = match style.max_width {
        MaximumSizeV1::None => None,
        MaximumSizeV1::Value(value) => Some(resolve(value.value()).max(0.0)),
    };
    let width = match (width, max_width) {
        (Some(width), Some(cap)) => Some(width.min(cap)),
        (Some(width), None) => Some(width),
        (None, Some(cap)) => {
            let margin_used = margin_left.unwrap_or(0.0) + margin_right.unwrap_or(0.0);
            let auto_border = (containing_width - margin_used).max(0.0);
            let cap_border = match style.box_sizing {
                BoxSizingV1::ContentBox => cap + padding_left + padding_right,
                BoxSizingV1::BorderBox => cap,
            };
            if auto_border > cap_border {
                Some(cap)
            } else {
                None
            }
        }
        (None, None) => None,
    };
    match width {
        None => {
            let margin_left = margin_left.unwrap_or(0.0);
            let margin_right = margin_right.unwrap_or(0.0);
            let border_width =
                (containing_width - margin_left - margin_right).max(padding_left + padding_right);
            Ok(HorizontalBox {
                x: margin_left,
                border_width,
                padding_left,
                content_width: (border_width - padding_left - padding_right).max(0.0),
                padding_top,
                padding_bottom,
            })
        }
        Some(width) => {
            let content_width = match style.box_sizing {
                BoxSizingV1::ContentBox => width,
                BoxSizingV1::BorderBox => (width - padding_left - padding_right).max(0.0),
            };
            let border_width = padding_left + content_width + padding_right;
            let free = containing_width - border_width;
            let x = match (margin_left, margin_right) {
                (None, None) => (free / 2.0).max(0.0),
                (None, Some(right)) => (free - right).max(0.0),
                (Some(left), _) => left,
            };
            Ok(HorizontalBox {
                x,
                border_width,
                padding_left,
                content_width,
                padding_top,
                padding_bottom,
            })
        }
    }
}

/// Moves a fragment and its descendants by a physical offset.
fn translate_fragment(fragment: &mut Fragment, dx: f64, dy: f64) {
    match fragment {
        Fragment::Box(box_fragment) => {
            box_fragment.rect.x += dx;
            box_fragment.rect.y += dy;
        }
        Fragment::Line(line) => {
            line.rect.x += dx;
            line.rect.y += dy;
        }
        Fragment::Text(text) => {
            text.rect.x += dx;
            text.rect.y += dy;
        }
        Fragment::Image(image) => {
            image.rect.x += dx;
            image.rect.y += dy;
        }
    }
}

/// A table cell's inline sizing inputs: its content bounds plus the width
/// it specified, which drives its column independently of content.
struct CellIntrinsicSizes {
    min_content: f64,
    max_content: f64,
    specified: Option<f64>,
    /// A percentage `width`, as a ratio. It constrains the table itself:
    /// the column must end up at least this share of the table's width.
    percentage: Option<f64>,
}

/// Inline offset for a shrink-to-fit box (a table) inside its containing
/// block: auto margins share the free space the used width leaves, the
/// same distribution `resolve_horizontal_box` applies to a definite width.
fn shrink_to_fit_offset(
    style: &LayoutFormattingStyleV1,
    containing_width: f64,
    used_width: f64,
) -> f64 {
    let margin = |side: LengthPercentageOrAuto| -> Option<f64> {
        match side {
            LengthPercentageOrAuto::Auto => None,
            LengthPercentageOrAuto::Value(value) => {
                Some(resolve_length_percentage(value, containing_width))
            }
        }
    };
    let free = containing_width - used_width;
    match (margin(style.margin.left), margin(style.margin.right)) {
        (None, None) => (free / 2.0).max(0.0),
        (None, Some(right)) => (free - right).max(0.0),
        (Some(left), _) => left,
    }
}

/// The container's fixed border-box height, when `height` is specified.
/// Percentages need a definite containing-block height that block flow
/// does not provide, so they resolve to `None` (auto), per CSS.
fn resolve_fixed_height(
    style: &LayoutFormattingStyleV1,
    vertical_padding: f64,
) -> Result<Option<f64>, LayoutError> {
    let height = match style.height {
        PreferredSizeV1::Auto => return Ok(None),
        PreferredSizeV1::Value(value) => match value.value() {
            LengthPercentage::Length(px) => f64::from(px.get()),
            // No definite height basis in block flow: behaves as auto.
            LengthPercentage::Percentage(_) | LengthPercentage::Linear { .. } => return Ok(None),
        },
        other => {
            return Err(LayoutError::Invalid(format!(
                "block height {other:?} is not representable yet"
            )));
        }
    };
    Ok(Some(match style.box_sizing {
        BoxSizingV1::ContentBox => height.max(0.0) + vertical_padding,
        BoxSizingV1::BorderBox => height.max(0.0),
    }))
}

/// Resolved vertical margins of one in-flow child, in CSS px.
///
/// Percentages resolve against the containing block's inline size (CSS
/// resolves the vertical sides against the *inline* axis) and `auto`
/// resolves to zero in block flow.
fn vertical_margins(
    tree: &FormattingTree,
    node: FormattingNodeId,
    inline_size: f64,
) -> Result<(f64, f64), LayoutError> {
    let styles = tree.styles().ok_or_else(|| {
        LayoutError::Invalid("block layout requires the tree to carry style tables".to_owned())
    })?;
    let style = styles
        .layout
        .style(tree.node(node).style)
        .map_err(|error| LayoutError::Invalid(error.to_string()))?;
    Ok((
        resolve_margin(style.margin.top, inline_size),
        resolve_margin(style.margin.bottom, inline_size),
    ))
}

fn resolve_margin(value: LengthPercentageOrAuto, inline_size: f64) -> f64 {
    match value {
        LengthPercentageOrAuto::Auto => 0.0,
        LengthPercentageOrAuto::Value(value) => resolve_length_percentage(value, inline_size),
    }
}

fn resolve_length_percentage(value: LengthPercentage, basis: f64) -> f64 {
    match value {
        LengthPercentage::Length(px) => f64::from(px.get()),
        LengthPercentage::Percentage(ratio) => f64::from(ratio.ratio()) * basis,
        LengthPercentage::Linear { length, percentage } => {
            f64::from(length.get()) + f64::from(percentage.ratio()) * basis
        }
    }
}

/// CSS margin collapsing for two adjoining margins: the maximum of the
/// positive margins plus the minimum of the negative ones.
fn collapse_margins(first: f64, second: f64) -> f64 {
    first.max(second).max(0.0) + first.min(second).min(0.0)
}

fn leaf_fragment(source: FormattingNodeId, x: f64, y: f64, width: f64, height: f64) -> Fragment {
    Fragment::Box(BoxFragment {
        source,
        rect: FragmentRect {
            x,
            y,
            width,
            height,
        },
        children: Vec::new(),
    })
}

fn set_fragment_position(fragment: &mut Fragment, x: f64, y: f64) {
    match fragment {
        Fragment::Box(inner) => {
            inner.rect.x = x;
            inner.rect.y = y;
        }
        Fragment::Line(inner) => {
            inner.rect.x = x;
            inner.rect.y = y;
        }
        Fragment::Text(inner) => {
            inner.rect.x = x;
            inner.rect.y = y;
        }
        Fragment::Image(inner) => {
            inner.rect.x = x;
            inner.rect.y = y;
        }
    }
}

fn sealed_with_break(
    container: FormattingNodeId,
    inline_size: f64,
    used_block_size: f64,
    fragments: Vec<Fragment>,
    token: BreakToken,
) -> LayoutOutcome {
    LayoutOutcome {
        fragments: sealed(container, inline_size, used_block_size, fragments),
        continuation: Some(token),
        escaped_floats: Vec::new(),
    }
}

fn sealed(
    container: FormattingNodeId,
    inline_size: f64,
    used_block_size: f64,
    children: Vec<Fragment>,
) -> FragmentTree {
    FragmentTree {
        root: Fragment::Box(BoxFragment {
            source: container,
            rect: FragmentRect {
                x: 0.0,
                y: 0.0,
                width: inline_size,
                height: used_block_size,
            },
            children,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rito_fragment::{FormattingNode, FormattingTreeStyles, InlineItem, LineFragment};
    use rito_inline::{plain_paragraph_style, ParleyInlineContext};
    use rito_style_contract::{
        AlignItemsV1, ClearV1, CssPx, FloatV1, FontFamilies, FontFamily, FontFamilyName,
        InlineStyleTableV1, JustifyContentV1, LayoutDisplayInsideV1, LayoutDisplayOutsideV1,
        LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleId, LayoutStyleTableV1,
        ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1, MinimumHeightV1,
        NonNegativeLengthPercentage, OverflowV1, PageBreakV1, Percentage, PhysicalSides,
        PositionV1, PreferredSizeV1,
    };

    fn margin_px(value: f64) -> LengthPercentageOrAuto {
        LengthPercentageOrAuto::Value(LengthPercentage::Length(
            CssPx::new(value as f32).expect("finite margin"),
        ))
    }

    fn zero_padding() -> NonNegativeLengthPercentage {
        NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero length"),
        ))
    }

    fn block_style(
        margin_top: LengthPercentageOrAuto,
        margin_bottom: LengthPercentageOrAuto,
    ) -> LayoutFormattingStyleV1 {
        LayoutFormattingStyleV1 {
            display: LayoutDisplayV1 {
                outside: LayoutDisplayOutsideV1::Block,
                inside: LayoutDisplayInsideV1::Flow,
                is_list_item: false,
            },
            margin: PhysicalSides {
                top: margin_top,
                right: margin_px(0.0),
                bottom: margin_bottom,
                left: margin_px(0.0),
            },
            padding: PhysicalSides {
                top: zero_padding(),
                right: zero_padding(),
                bottom: zero_padding(),
                left: zero_padding(),
            },
            box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
            justify_content: JustifyContentV1::Normal,
            align_items: AlignItemsV1::Normal,
            break_before: PageBreakV1::Auto,
            break_after: PageBreakV1::Auto,
            width: PreferredSizeV1::Auto,
            height: PreferredSizeV1::Auto,
            max_width: MaximumSizeV1::None,
            min_height: MinimumHeightV1::Auto,
            max_height: MaximumHeightV1::None,
            clear: ClearV1::None,
            float: FloatV1::None,
            overflow: OverflowV1::Visible,
            list_style_type: ListMarkerStyleV1::None,
            position: PositionV1::Static,
            inset: PhysicalSides {
            vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
            border_spacing: (
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
            ),
                top: LengthPercentageOrAuto::Auto,
                right: LengthPercentageOrAuto::Auto,
                bottom: LengthPercentageOrAuto::Auto,
                left: LengthPercentageOrAuto::Auto,
            },
        }
    }

    /// One interned zero-margin style for every node slot.
    fn uniform_layout_table(node_count: usize) -> LayoutStyleTableV1 {
        layout_table_with(node_count, |_| block_style(margin_px(0.0), margin_px(0.0)))
    }

    fn layout_table_with(
        node_count: usize,
        style_for: impl Fn(usize) -> LayoutFormattingStyleV1,
    ) -> LayoutStyleTableV1 {
        let mut table = LayoutStyleTableV1::new(node_count);
        for index in 0..node_count {
            table
                .intern_for_node(index, style_for(index))
                .expect("style interns");
        }
        table
    }

    fn node_style_id(table: &LayoutStyleTableV1, index: usize) -> LayoutStyleId {
        table.node_style_id(index).expect("node style assigned")
    }

    /// Deterministic fake inline provider: every paragraph lays out as one
    /// 10px-tall line per item, so block pagination is exactly predictable.
    struct FixedLineInline;

    impl FormattingContext for FixedLineInline {
        fn layout(
            &self,
            tree: &FormattingTree,
            node: FormattingNodeId,
            space: &ConstraintSpace,
            _token: Option<&BreakToken>,
            _cancel: &CancelFlag,
        ) -> Result<LayoutOutcome, LayoutError> {
            let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
                return Err(LayoutError::Invalid("not an inline flow".to_owned()));
            };
            let lines = (0..items.len())
                .map(|index| {
                    Fragment::Line(LineFragment {
                        source: node,
                        rect: FragmentRect {
                            x: 0.0,
                            y: 10.0 * index as f64,
                            width: space.inline_size,
                            height: 10.0,
                        },
                        baseline: 8.0,
                        trailing_whitespace: 0.0,
                        children: Vec::new(),
                    })
                })
                .collect();
            Ok(LayoutOutcome {
                fragments: FragmentTree {
                    root: Fragment::Box(BoxFragment {
                        source: node,
                        rect: FragmentRect {
                            x: 0.0,
                            y: 0.0,
                            width: space.inline_size,
                            height: 10.0 * items.len() as f64,
                        },
                        children: lines,
                    }),
                },
                continuation: None,
                escaped_floats: Vec::new(),
            })
        }

        fn intrinsic_inline_sizes(
            &self,
            _tree: &FormattingTree,
            _node: FormattingNodeId,
        ) -> Result<IntrinsicInlineSizes, LayoutError> {
            Ok(IntrinsicInlineSizes {
                min_content: 10.0,
                max_content: 100.0,
            })
        }
    }

    /// Builds a tree whose container children are paragraphs with the given
    /// line counts (each line 10 px through `FixedLineInline`).
    fn paragraph_counts_tree(line_counts: &[usize]) -> FormattingTree {
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let layout = uniform_layout_table(line_counts.len() + 1);
        let mut nodes: Vec<FormattingNode> = line_counts
            .iter()
            .enumerate()
            .map(|(index, count)| FormattingNode {
                style: node_style_id(&layout, index),
                content: FormattingNodeContent::InlineFlow {
                    items: (0..*count)
                        .map(|line| InlineItem::Text {
                            text: format!("line {line}"),
                            style,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        })
                        .collect(),
                },
                children: Vec::new(),
            })
            .collect();
        let count = nodes.len() as u32;
        nodes.push(FormattingNode {
            style: node_style_id(&layout, count as usize),
            content: FormattingNodeContent::BlockContainer,
            children: (0..count).map(FormattingNodeId).collect(),
        });
        FormattingTree::with_styles(
            nodes,
            FormattingNodeId(count),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds")
    }

    fn paginate(
        context: &impl FormattingContext,
        tree: &FormattingTree,
        space: ConstraintSpace,
    ) -> Vec<LayoutOutcome> {
        let cancel = CancelFlag::new();
        let mut pages = Vec::new();
        let mut token: Option<BreakToken> = None;
        loop {
            let outcome = context
                .layout(tree, tree.root(), &space, token.as_ref(), &cancel)
                .expect("page lays out");
            token = outcome.continuation.clone();
            pages.push(outcome);
            if token.is_none() {
                return pages;
            }
            assert!(pages.len() < 64, "pagination must terminate");
        }
    }

    fn box_children(outcome: &LayoutOutcome) -> &[Fragment] {
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("container roots are box fragments");
        };
        &root.children
    }

    #[test]
    fn paragraph_lines_paginate_without_gaps_or_repeats() {
        let context = BlockFormattingContext::new(FixedLineInline);
        // 7 lines of 10px through 25px fragmentainers: 2 + 2 + 2 + 1.
        let tree = paragraph_counts_tree(&[7]);
        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
        assert_eq!(pages.len(), 4);
        let line_counts: Vec<usize> = pages
            .iter()
            .map(|page| {
                let children = box_children(page);
                assert_eq!(children.len(), 1, "one paragraph fragment per page");
                let Fragment::Box(paragraph) = &children[0] else {
                    panic!("paragraph fragments are boxes");
                };
                paragraph.children.len()
            })
            .collect();
        assert_eq!(line_counts, vec![2, 2, 2, 1]);
        for page in &pages {
            let children = box_children(page);
            let Fragment::Box(paragraph) = &children[0] else {
                panic!("paragraph fragments are boxes");
            };
            for (index, line) in paragraph.children.iter().enumerate() {
                assert!((line.rect().y - 10.0 * index as f64).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn forced_breaks_seal_the_fragmentainer_between_children() {
        let context = BlockFormattingContext::new(FixedLineInline);
        // Two 2-line paragraphs that would share one 100px fragmentainer;
        // a forced break between them puts each on its own page. A break
        // already satisfied at the top of a fresh fragmentainer never
        // produces an empty page.
        let mut inline = InlineStyleTableV1::new(1);
        let text_style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let mut layout = LayoutStyleTableV1::new(0);
        let plain = layout
            .intern(block_style(margin_px(0.0), margin_px(0.0)))
            .expect("style interns");
        let mut breaking = block_style(margin_px(0.0), margin_px(0.0));
        breaking.break_before = PageBreakV1::Always;
        let breaking = layout.intern(breaking).expect("style interns");
        let paragraph = |style: LayoutStyleId| FormattingNode {
            style,
            content: FormattingNodeContent::InlineFlow {
                items: (0..2)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style: text_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        };
        let nodes = vec![
            // First child itself asks for a break-before: satisfied at the
            // top, no empty page.
            paragraph(breaking),
            paragraph(breaking),
            FormattingNode {
                style: plain,
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(1)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(2),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 100.0));
        assert_eq!(pages.len(), 2, "forced break splits the two paragraphs");
        for page in &pages {
            assert_eq!(box_children(page).len(), 1, "one paragraph per page");
        }
    }

    #[test]
    fn resumption_is_deterministic() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let tree = paragraph_counts_tree(&[5, 3]);
        let space = ConstraintSpace::fragmented(100.0, 30.0);
        let cancel = CancelFlag::new();
        let first = context
            .layout(&tree, tree.root(), &space, None, &cancel)
            .expect("first page");
        let token = first.continuation.clone().expect("break token");
        let resumed_a = context
            .layout(&tree, tree.root(), &space, Some(&token), &cancel)
            .expect("resume a");
        let resumed_b = context
            .layout(&tree, tree.root(), &space, Some(&token), &cancel)
            .expect("resume b");
        assert_eq!(resumed_a, resumed_b);
    }

    #[test]
    fn mixed_leaves_and_paragraphs_share_fragmentainers() {
        let context = BlockFormattingContext::new(FixedLineInline);
        // leaf 12px + paragraph 3 lines (30px) through 30px fragmentainers:
        // page 1 = leaf + 1 line (12 + 10 <= 30, second line would overflow),
        // page 2 = remaining 2 lines.
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let layout = uniform_layout_table(3);
        let nodes = vec![
            FormattingNode {
                style: node_style_id(&layout, 0),
                content: FormattingNodeContent::SizedLeaf {
                    block_size: 12.0,
                    breakable: false,
                },
                children: Vec::new(),
            },
            FormattingNode {
                style: node_style_id(&layout, 1),
                content: FormattingNodeContent::InlineFlow {
                    items: (0..3)
                        .map(|index| InlineItem::Text {
                            text: format!("line {index}"),
                            style,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        })
                        .collect(),
                },
                children: Vec::new(),
            },
            FormattingNode {
                style: node_style_id(&layout, 2),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(1)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(2),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 30.0));
        assert_eq!(pages.len(), 2);
        let first_children = box_children(&pages[0]);
        assert_eq!(first_children.len(), 2, "leaf and paragraph share page 1");
        let Fragment::Box(paragraph) = &first_children[1] else {
            panic!("paragraph fragment is a box");
        };
        assert_eq!(paragraph.children.len(), 1);
        assert!((paragraph.rect.y - 12.0).abs() < 1e-9);
        let second_children = box_children(&pages[1]);
        assert_eq!(second_children.len(), 1);
        let Fragment::Box(rest) = &second_children[0] else {
            panic!("paragraph fragment is a box");
        };
        assert_eq!(rest.children.len(), 2);
    }

    #[test]
    fn line_taller_than_a_fresh_fragmentainer_still_progresses() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let tree = paragraph_counts_tree(&[2]);
        // 10px lines through 6px fragmentainers: each page takes one forced
        // line rather than looping forever.
        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 6.0));
        assert_eq!(pages.len(), 2);
    }

    #[test]
    fn continuous_space_never_breaks() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let tree = paragraph_counts_tree(&[5, 3]);
        let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
        assert_eq!(pages.len(), 1);
        let children = box_children(&pages[0]);
        assert_eq!(children.len(), 2);
        assert!((pages[0].fragments.root.rect().height - 80.0).abs() < 1e-9);
    }

    #[test]
    fn leaf_roots_fail_closed_and_empty_nested_containers_are_zero_height() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let layout = uniform_layout_table(2);
        let nodes = vec![
            FormattingNode {
                style: node_style_id(&layout, 0),
                content: FormattingNodeContent::BlockContainer,
                children: Vec::new(),
            },
            FormattingNode {
                style: node_style_id(&layout, 1),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(1),
            FormattingTreeStyles {
                layout,
                inline: InlineStyleTableV1::new(0),
            },
        )
        .expect("tree builds");
        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 50.0));
        assert_eq!(pages.len(), 1);
        assert!((pages[0].fragments.root.rect().height - 0.0).abs() < 1e-9);

        let leaf_layout = uniform_layout_table(1);
        let leaf_tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: node_style_id(&leaf_layout, 0),
                content: FormattingNodeContent::SizedLeaf {
                    block_size: 10.0,
                    breakable: true,
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            FormattingTreeStyles {
                layout: leaf_layout,
                inline: InlineStyleTableV1::new(0),
            },
        )
        .expect("leaf tree builds");
        assert!(matches!(
            context.layout(
                &leaf_tree,
                leaf_tree.root(),
                &ConstraintSpace::continuous(100.0),
                None,
                &CancelFlag::new()
            ),
            Err(LayoutError::Invalid(_))
        ));
    }

    /// Outer container: [paragraph A, inner [paragraph B, paragraph C],
    /// paragraph D], every paragraph two 10px fixed lines.
    fn nested_tree() -> FormattingTree {
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let layout = uniform_layout_table(6);
        let paragraph = |node_index: usize| FormattingNode {
            style: node_style_id(&layout, node_index),
            content: FormattingNodeContent::InlineFlow {
                items: (0..2)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        };
        let nodes = vec![
            paragraph(0), // A
            paragraph(1), // B
            paragraph(2), // C
            FormattingNode {
                style: node_style_id(&layout, 3), // inner
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(1), FormattingNodeId(2)],
            },
            paragraph(4), // D
            FormattingNode {
                style: node_style_id(&layout, 5), // outer
                content: FormattingNodeContent::BlockContainer,
                children: vec![
                    FormattingNodeId(0),
                    FormattingNodeId(3),
                    FormattingNodeId(4),
                ],
            },
        ];
        FormattingTree::with_styles(
            nodes,
            FormattingNodeId(5),
            FormattingTreeStyles { layout, inline },
        )
        .expect("nested tree builds")
    }

    #[test]
    fn nested_containers_stack_in_continuous_space() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let tree = nested_tree();
        let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
        assert_eq!(pages.len(), 1);
        let children = box_children(&pages[0]);
        assert_eq!(children.len(), 3, "A, inner, D");
        // A 0..20, inner 20..60 (B + C), D 60..80.
        assert!((children[1].rect().y - 20.0).abs() < 1e-9);
        assert!((children[1].rect().height - 40.0).abs() < 1e-9);
        assert!((children[2].rect().y - 60.0).abs() < 1e-9);
        assert!((pages[0].fragments.root.rect().height - 80.0).abs() < 1e-9);
    }

    #[test]
    fn breaks_inside_nested_containers_resume_through_the_ancestor_path() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let tree = nested_tree();
        // 30px pages over 80px of lines: the first break lands inside the
        // inner container (paragraph B's second line would overflow page 1).
        let space = ConstraintSpace::fragmented(100.0, 30.0);
        let cancel = CancelFlag::new();
        let first = context
            .layout(&tree, tree.root(), &space, None, &cancel)
            .expect("first page");
        let token = first.continuation.clone().expect("break token");
        assert_eq!(
            token.resume_path,
            vec![FormattingNodeId(3), FormattingNodeId(1)],
            "the resume path names the inner container, then paragraph B"
        );

        let resumed_a = context
            .layout(&tree, tree.root(), &space, Some(&token), &cancel)
            .expect("resume a");
        let resumed_b = context
            .layout(&tree, tree.root(), &space, Some(&token), &cancel)
            .expect("resume b");
        assert_eq!(resumed_a, resumed_b, "deep resumption is deterministic");

        // Full pagination loses no lines anywhere in the tree.
        let pages = paginate(&context, &tree, space);
        let mut total_lines = 0usize;
        fn count_lines(fragment: &Fragment, total: &mut usize) {
            match fragment {
                Fragment::Line(_) => *total += 1,
                Fragment::Box(inner) => {
                    for child in &inner.children {
                        count_lines(child, total);
                    }
                }
                Fragment::Text(_) | Fragment::Image(_) => {}
            }
        }
        for page in &pages {
            count_lines(&page.fragments.root, &mut total_lines);
        }
        assert_eq!(total_lines, 8, "A, B, C, D contribute two lines each");
    }

    #[test]
    fn three_levels_of_nesting_paginate_losslessly() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let layout = uniform_layout_table(4);
        let nodes = vec![
            FormattingNode {
                style: node_style_id(&layout, 0),
                content: FormattingNodeContent::InlineFlow {
                    items: (0..5)
                        .map(|line| InlineItem::Text {
                            text: format!("line {line}"),
                            style,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        })
                        .collect(),
                },
                children: Vec::new(),
            },
            FormattingNode {
                style: node_style_id(&layout, 1),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0)],
            },
            FormattingNode {
                style: node_style_id(&layout, 2),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(1)],
            },
            FormattingNode {
                style: node_style_id(&layout, 3),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(2)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(3),
            FormattingTreeStyles { layout, inline },
        )
        .expect("deep tree builds");
        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 20.0));
        assert_eq!(pages.len(), 3, "five 10px lines through 20px pages");
        let deep_token_page = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::fragmented(100.0, 20.0),
                None,
                &CancelFlag::new(),
            )
            .expect("first page");
        let token = deep_token_page.continuation.expect("token");
        assert_eq!(
            token.resume_path,
            vec![
                FormattingNodeId(2),
                FormattingNodeId(1),
                FormattingNodeId(0)
            ],
            "the path walks every nesting level down to the paragraph"
        );
    }

    #[test]
    fn cancellation_propagates() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let tree = paragraph_counts_tree(&[3]);
        let cancel = CancelFlag::new();
        cancel.cancel();
        assert_eq!(
            context.layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(100.0),
                None,
                &cancel
            ),
            Err(LayoutError::Cancelled)
        );
    }

    /// Tree of paragraphs (2 fixed lines each = 20px) whose vertical
    /// margins come from `margins[i] = (top, bottom)`.
    fn margined_paragraphs_tree(
        margins: &[(LengthPercentageOrAuto, LengthPercentageOrAuto)],
    ) -> FormattingTree {
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let layout = layout_table_with(margins.len() + 1, |index| {
            if index < margins.len() {
                let (top, bottom) = margins[index];
                block_style(top, bottom)
            } else {
                block_style(margin_px(0.0), margin_px(0.0))
            }
        });
        let mut nodes: Vec<FormattingNode> = margins
            .iter()
            .enumerate()
            .map(|(index, _)| FormattingNode {
                style: node_style_id(&layout, index),
                content: FormattingNodeContent::InlineFlow {
                    items: (0..2)
                        .map(|line| InlineItem::Text {
                            text: format!("line {line}"),
                            style,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        })
                        .collect(),
                },
                children: Vec::new(),
            })
            .collect();
        let count = nodes.len() as u32;
        nodes.push(FormattingNode {
            style: node_style_id(&layout, count as usize),
            content: FormattingNodeContent::BlockContainer,
            children: (0..count).map(FormattingNodeId).collect(),
        });
        FormattingTree::with_styles(
            nodes,
            FormattingNodeId(count),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds")
    }

    #[test]
    fn adjacent_margins_collapse_to_the_larger_one() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let tree = margined_paragraphs_tree(&[
            (margin_px(0.0), margin_px(12.0)),
            (margin_px(8.0), margin_px(6.0)),
        ]);
        let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
        assert_eq!(pages.len(), 1);
        let children = box_children(&pages[0]);
        assert_eq!(children.len(), 2);
        // Paragraph 1 at 0..20; collapsed gap max(12, 8) = 12; paragraph 2
        // at 32..52. The trailing bottom margin escapes the collapsing root
        // edge, so the container height ends at the content edge.
        assert!((children[0].rect().y - 0.0).abs() < 1e-9);
        assert!((children[1].rect().y - 32.0).abs() < 1e-9);
        assert!((pages[0].fragments.root.rect().height - 52.0).abs() < 1e-9);
    }

    #[test]
    fn negative_margins_collapse_by_positive_max_plus_negative_min() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let tree = margined_paragraphs_tree(&[
            (margin_px(0.0), margin_px(10.0)),
            (margin_px(-4.0), margin_px(0.0)),
        ]);
        let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
        let children = box_children(&pages[0]);
        // Gap = max(10, -4).max(0) + min(10, -4).min(0) = 10 - 4 = 6.
        assert!((children[1].rect().y - 26.0).abs() < 1e-9);
    }

    #[test]
    fn percentage_margins_resolve_against_the_inline_size() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let ten_percent = LengthPercentageOrAuto::Value(LengthPercentage::Percentage(
            Percentage::from_percent(10.0).expect("finite percentage"),
        ));
        let tree = margined_paragraphs_tree(&[
            (margin_px(0.0), ten_percent),
            (margin_px(0.0), margin_px(0.0)),
        ]);
        let pages = paginate(&context, &tree, ConstraintSpace::continuous(200.0));
        let children = box_children(&pages[0]);
        // 10% of the 200px inline size = 20px gap (f32 ratio widened to f64,
        // so compare at single precision).
        assert!((children[1].rect().y - 40.0).abs() < 1e-4);
    }

    #[test]
    fn auto_vertical_margins_resolve_to_zero() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let tree = margined_paragraphs_tree(&[
            (LengthPercentageOrAuto::Auto, LengthPercentageOrAuto::Auto),
            (LengthPercentageOrAuto::Auto, LengthPercentageOrAuto::Auto),
        ]);
        let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
        let children = box_children(&pages[0]);
        assert!((children[1].rect().y - 20.0).abs() < 1e-9);
        assert!((pages[0].fragments.root.rect().height - 40.0).abs() < 1e-9);
    }

    #[test]
    fn a_margin_meeting_an_unforced_break_is_truncated() {
        let context = BlockFormattingContext::new(FixedLineInline);
        // Page height 25: paragraph 1 (20px) fits; the 12px gap leaves no
        // room for any line of paragraph 2, so the break truncates the
        // margin and page 2 starts flush at the top.
        let tree = margined_paragraphs_tree(&[
            (margin_px(0.0), margin_px(12.0)),
            (margin_px(0.0), margin_px(0.0)),
        ]);
        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
        assert_eq!(pages.len(), 2);
        let first_children = box_children(&pages[0]);
        assert_eq!(first_children.len(), 1);
        // Page 1 seals at the content edge, without the truncated margin.
        assert!((pages[0].fragments.root.rect().height - 20.0).abs() < 1e-9);
        let second_children = box_children(&pages[1]);
        assert_eq!(second_children.len(), 1);
        assert!((second_children[0].rect().y - 0.0).abs() < 1e-9);
    }

    #[test]
    fn missing_layout_styles_fail_closed() {
        let context = BlockFormattingContext::new(FixedLineInline);
        let nodes = vec![
            FormattingNode {
                style: LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::SizedLeaf {
                    block_size: 10.0,
                    breakable: true,
                },
                children: Vec::new(),
            },
            FormattingNode {
                style: LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0)],
            },
        ];
        let tree = FormattingTree::new(nodes, FormattingNodeId(1)).expect("tree builds");
        assert!(matches!(
            context.layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(100.0),
                None,
                &CancelFlag::new()
            ),
            Err(LayoutError::Invalid(_))
        ));
    }

    /// Paired float columns like a character-introduction page: 49% left
    /// and 49% right, different heights, followed by nothing.
    #[test]
    fn paired_float_columns_split_and_resume_side_by_side_across_pages() {
        use rito_style_contract::{FloatV1, NonNegativeLengthPercentage, Percentage};
        let context = BlockFormattingContext::new(FixedLineInline);
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let half_width = PreferredSizeV1::Value(NonNegativeLengthPercentage::new(
            LengthPercentage::Percentage(Percentage::from_percent(49.0).expect("finite")),
        ));
        let mut column = block_style(margin_px(0.0), margin_px(0.0));
        column.width = half_width;
        let mut left_column = column;
        left_column.float = FloatV1::Left;
        let mut right_column = column;
        right_column.float = FloatV1::Right;
        let layout = layout_table_with(5, |index| match index {
            0 => left_column,
            1 => right_column,
            _ => block_style(margin_px(0.0), margin_px(0.0)),
        });
        let paragraph = |node_index: usize, line_count: usize| FormattingNode {
            style: node_style_id(&layout, node_index),
            content: FormattingNodeContent::InlineFlow {
                items: (0..line_count)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        };
        // Each column is a block container of two paragraphs (30px each,
        // 60px total) in a 40px fragmentainer: both columns must split at
        // the page edge and resume side by side on page two.
        let nodes = vec![
            paragraph(2, 3),
            paragraph(3, 3),
            FormattingNode {
                style: node_style_id(&layout, 0),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(1)],
            },
            paragraph(2, 3),
            paragraph(3, 3),
            FormattingNode {
                style: node_style_id(&layout, 1),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(3), FormattingNodeId(4)],
            },
            FormattingNode {
                style: node_style_id(&layout, 4),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(2), FormattingNodeId(5)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(6),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(200.0, 40.0));
        assert_eq!(pages.len(), 2, "both columns span exactly two pages");

        let first = box_children(&pages[0]);
        assert_eq!(first.len(), 2, "page one holds both column heads");
        let left = first[0].rect();
        let right = first[1].rect();
        assert!((left.x - 0.0).abs() < 1e-6, "left head at the left edge");
        assert!(
            (right.x - (200.0 - 98.0)).abs() < 1e-3,
            "right head against the right edge, got {}",
            right.x
        );
        assert!((left.y - 0.0).abs() < 1e-6);
        assert!((right.y - 0.0).abs() < 1e-6, "heads share the page top");
        assert!(left.height <= 40.0 + 1e-6, "left head fits the page");
        assert!(right.height <= 40.0 + 1e-6, "right head fits the page");

        let second = box_children(&pages[1]);
        assert_eq!(second.len(), 2, "page two holds both column tails");
        let left_tail = second[0].rect();
        let right_tail = second[1].rect();
        assert!((left_tail.y - 0.0).abs() < 1e-6, "tails resume at the top");
        assert!(
            (right_tail.y - 0.0).abs() < 1e-6,
            "tails resume side by side, got y {}",
            right_tail.y
        );
        assert!((left_tail.x - 0.0).abs() < 1e-6);
        assert!(
            (right_tail.x - (200.0 - 98.0)).abs() < 1e-3,
            "right tail keeps its band, got {}",
            right_tail.x
        );
        // No fragment anywhere may carry negative coordinates.
        for (index, page) in pages.iter().enumerate() {
            for fragment in box_children(page) {
                assert!(
                    fragment.rect().y >= -1e-6,
                    "page {index} fragment starts above the page top",
                );
            }
        }
    }

    /// The same paired columns, but inside a wrapper container — how real
    /// books structure character pages (body > div.intro > two columns).
    /// The wrapper's split floats must ride the resume path down and come
    /// back side by side on the next page.
    #[test]
    fn nested_float_columns_resume_side_by_side_across_pages() {
        use rito_style_contract::{FloatV1, NonNegativeLengthPercentage, Percentage};
        let context = BlockFormattingContext::new(FixedLineInline);
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let half_width = PreferredSizeV1::Value(NonNegativeLengthPercentage::new(
            LengthPercentage::Percentage(Percentage::from_percent(49.0).expect("finite")),
        ));
        let mut column = block_style(margin_px(0.0), margin_px(0.0));
        column.width = half_width;
        let mut left_column = column;
        left_column.float = FloatV1::Left;
        let mut right_column = column;
        right_column.float = FloatV1::Right;
        let layout = layout_table_with(5, |index| match index {
            0 => left_column,
            1 => right_column,
            _ => block_style(margin_px(0.0), margin_px(0.0)),
        });
        let paragraph = |node_index: usize, line_count: usize| FormattingNode {
            style: node_style_id(&layout, node_index),
            content: FormattingNodeContent::InlineFlow {
                items: (0..line_count)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        };
        // body(8) > wrapper(7) > [left column(2), right column(5)]; each
        // column holds two 30px paragraphs in a 40px fragmentainer, so
        // both columns split inside the wrapper and resume on page two.
        let nodes = vec![
            paragraph(2, 3),
            paragraph(3, 3),
            FormattingNode {
                style: node_style_id(&layout, 0),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(1)],
            },
            paragraph(2, 3),
            paragraph(3, 3),
            FormattingNode {
                style: node_style_id(&layout, 1),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(3), FormattingNodeId(4)],
            },
            FormattingNode {
                style: node_style_id(&layout, 4),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(2), FormattingNodeId(5)],
            },
            FormattingNode {
                style: node_style_id(&layout, 4),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(6)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(7),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(200.0, 40.0));
        assert_eq!(pages.len(), 2, "the nested columns span exactly two pages");

        let columns_of = |page: &LayoutOutcome| -> Vec<FragmentRect> {
            let wrappers = box_children(page);
            assert_eq!(wrappers.len(), 1, "each page holds the wrapper box");
            let Fragment::Box(wrapper) = &wrappers[0] else {
                panic!("wrapper is a box");
            };
            wrapper.children.iter().map(|child| child.rect()).collect()
        };
        let first = columns_of(&pages[0]);
        assert_eq!(first.len(), 2, "page one holds both column heads");
        assert!((first[0].x - 0.0).abs() < 1e-6);
        assert!(
            (first[1].x - (200.0 - 98.0)).abs() < 1e-3,
            "right head against the right edge, got {}",
            first[1].x
        );
        assert!((first[0].y - 0.0).abs() < 1e-6);
        assert!((first[1].y - 0.0).abs() < 1e-6, "heads share the page top");

        let second = columns_of(&pages[1]);
        assert_eq!(second.len(), 2, "page two holds both column tails");
        assert!((second[0].y - 0.0).abs() < 1e-6, "tails resume at the top");
        assert!(
            (second[1].y - 0.0).abs() < 1e-6,
            "tails resume side by side, got y {}",
            second[1].y
        );
        assert!((second[0].x - 0.0).abs() < 1e-6);
        assert!(
            (second[1].x - (200.0 - 98.0)).abs() < 1e-3,
            "right tail keeps its band, got {}",
            second[1].x
        );
        for (index, page) in pages.iter().enumerate() {
            for fragment in box_children(page) {
                assert!(
                    fragment.rect().y >= -1e-6,
                    "page {index} fragment starts above the page top",
                );
            }
        }
    }

    /// A floated badge with a large negative top margin hoists above its
    /// flow position — how title pages pull a volume number back to the
    /// page top — and occupies no float band doing it.
    #[test]
    fn negative_top_margins_hoist_floats_above_their_flow_position() {
        use rito_style_contract::FloatV1;
        let context = BlockFormattingContext::new(FixedLineInline);
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let mut badge = block_style(margin_px(-100.0), margin_px(0.0));
        badge.float = FloatV1::Right;
        let layout = layout_table_with(3, |index| match index {
            0 => badge,
            _ => block_style(margin_px(0.0), margin_px(0.0)),
        });
        let paragraph = |node_index: usize, line_count: usize| FormattingNode {
            style: node_style_id(&layout, node_index),
            content: FormattingNodeContent::InlineFlow {
                items: (0..line_count)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        };
        // Flow: a 120px paragraph, then the floated one-line badge with
        // margin-top -100 — its box must land 100px above the flow tail.
        let nodes = vec![
            paragraph(1, 12),
            paragraph(0, 1),
            FormattingNode {
                style: node_style_id(&layout, 2),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(1)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(2),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let pages = paginate(&context, &tree, ConstraintSpace::continuous(300.0));
        let children = box_children(&pages[0]);
        assert_eq!(children.len(), 2);
        let badge_rect = children[1].rect();
        // Flow tail is y=120; the badge box hoists to 120 - 100 = 20.
        assert!(
            (badge_rect.y - 20.0).abs() < 1e-6,
            "the badge hoists above the flow, got y {}",
            badge_rect.y
        );
        // The container's height is the flow's, not stretched by the badge.
        assert!(
            (pages[0].fragments.root.rect().height - 120.0).abs() < 1e-6,
            "the hoisted badge occupies no band, got {}",
            pages[0].fragments.root.rect().height
        );
    }

    #[test]
    fn auto_width_floats_shrink_to_their_content() {
        use rito_style_contract::FloatV1;
        let context = BlockFormattingContext::new(FixedLineInline);
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let mut side_note = block_style(margin_px(0.0), margin_px(0.0));
        side_note.float = FloatV1::Right;
        let layout = layout_table_with(2, |index| match index {
            0 => side_note,
            _ => block_style(margin_px(0.0), margin_px(0.0)),
        });
        let nodes = vec![
            FormattingNode {
                style: node_style_id(&layout, 0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: "note".to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            },
            FormattingNode {
                style: node_style_id(&layout, 1),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(1),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        // The fixture provider reports max-content 100; in a 300px
        // containing block the float takes its preferred 100, not the
        // full width, and floats right against the edge.
        let pages = paginate(&context, &tree, ConstraintSpace::continuous(300.0));
        let children = box_children(&pages[0]);
        assert_eq!(children.len(), 1);
        let rect = children[0].rect();
        assert!(
            (rect.width - 100.0).abs() < 1e-6,
            "fit width, got {}",
            rect.width
        );
        assert!((rect.x - 200.0).abs() < 1e-6, "flush right, got {}", rect.x);

        // In a 60px containing block the preferred width no longer fits;
        // the float shrinks to the available space, floored by
        // min-content (10).
        let narrow = paginate(&context, &tree, ConstraintSpace::continuous(60.0));
        let children = box_children(&narrow[0]);
        let rect = children[0].rect();
        assert!(
            (rect.width - 60.0).abs() < 1e-6,
            "clamped to available, got {}",
            rect.width
        );
    }

    #[test]
    fn paired_float_columns_sit_side_by_side() {
        use rito_style_contract::{FloatV1, NonNegativeLengthPercentage, Percentage};
        let context = BlockFormattingContext::new(FixedLineInline);
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let half_width = PreferredSizeV1::Value(NonNegativeLengthPercentage::new(
            LengthPercentage::Percentage(Percentage::from_percent(49.0).expect("finite")),
        ));
        let mut column = block_style(margin_px(0.0), margin_px(0.0));
        column.width = half_width;
        let mut left_column = column;
        left_column.float = FloatV1::Left;
        let mut right_column = column;
        right_column.float = FloatV1::Right;
        let layout = layout_table_with(3, |index| match index {
            0 => left_column,
            1 => right_column,
            _ => block_style(margin_px(0.0), margin_px(0.0)),
        });
        let paragraph = |node_index: usize, line_count: usize| FormattingNode {
            style: node_style_id(&layout, node_index),
            content: FormattingNodeContent::InlineFlow {
                items: (0..line_count)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        };
        let nodes = vec![
            paragraph(0, 3), // left column: 30px
            paragraph(1, 5), // right column: 50px
            FormattingNode {
                style: node_style_id(&layout, 2),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(1)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(2),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let pages = paginate(&context, &tree, ConstraintSpace::continuous(200.0));
        assert_eq!(pages.len(), 1);
        let children = box_children(&pages[0]);
        assert_eq!(children.len(), 2);
        let left = children[0].rect();
        let right = children[1].rect();
        assert!((left.x - 0.0).abs() < 1e-6, "left column at the left edge");
        assert!((left.width - 98.0).abs() < 1e-3);
        assert!(
            (right.x - (200.0 - 98.0)).abs() < 1e-3,
            "right column against the right edge, got {}",
            right.x
        );
        assert!((left.y - 0.0).abs() < 1e-6);
        assert!((right.y - 0.0).abs() < 1e-6, "columns share the band top");
        // The container contains its floats: height = the taller column.
        assert!((pages[0].fragments.root.rect().height - 50.0).abs() < 1e-6);
    }

    #[test]
    fn content_beside_floats_clears_below_them() {
        use rito_style_contract::{ClearV1, FloatV1, NonNegativeLengthPercentage, Percentage};
        let context = BlockFormattingContext::new(FixedLineInline);
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                        .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let half_width = PreferredSizeV1::Value(NonNegativeLengthPercentage::new(
            LengthPercentage::Percentage(Percentage::from_percent(40.0).expect("finite")),
        ));
        let mut float_style = block_style(margin_px(0.0), margin_px(0.0));
        float_style.width = half_width;
        float_style.float = FloatV1::Left;
        let mut cleared = block_style(margin_px(0.0), margin_px(0.0));
        cleared.clear = ClearV1::Both;
        let build = |following: LayoutFormattingStyleV1| {
            let layout = layout_table_with(3, move |index| match index {
                0 => float_style,
                1 => following,
                _ => block_style(margin_px(0.0), margin_px(0.0)),
            });
            let mut inline_table = InlineStyleTableV1::new(1);
            let style_id = inline_table
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                            .expect("family list"),
                        16.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let paragraph = |node_index: usize, line_count: usize| FormattingNode {
                style: node_style_id(&layout, node_index),
                content: FormattingNodeContent::InlineFlow {
                    items: (0..line_count)
                        .map(|line| InlineItem::Text {
                            text: format!("line {line}"),
                            style: style_id,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        })
                        .collect(),
                },
                children: Vec::new(),
            };
            let nodes = vec![
                paragraph(0, 4),
                paragraph(1, 2),
                FormattingNode {
                    style: node_style_id(&layout, 2),
                    content: FormattingNodeContent::BlockContainer,
                    children: vec![FormattingNodeId(0), FormattingNodeId(1)],
                },
            ];
            FormattingTree::with_styles(
                nodes,
                FormattingNodeId(2),
                FormattingTreeStyles {
                    layout,
                    inline: inline_table,
                },
            )
            .expect("tree builds")
        };
        let _ = style;

        let cleared_tree = build(cleared);
        let pages = paginate(&context, &cleared_tree, ConstraintSpace::continuous(200.0));
        let children = box_children(&pages[0]);
        assert_eq!(children.len(), 2);
        assert!(
            (children[1].rect().y - 40.0).abs() < 1e-6,
            "cleared content starts below the 40px float, got {}",
            children[1].rect().y
        );

        // Un-cleared content beside the float degrades to clearing below
        // it (float wrapping is unimplemented): readable, never
        // overlapping, at the cost of the wrap.
        let beside_tree = build(block_style(margin_px(0.0), margin_px(0.0)));
        let pages = paginate(&context, &beside_tree, ConstraintSpace::continuous(200.0));
        let children = box_children(&pages[0]);
        assert_eq!(children.len(), 2);
        assert!(
            (children[1].rect().y - 40.0).abs() < 1e-6,
            "un-cleared content pushes below the float, got {}",
            children[1].rect().y
        );
    }

    fn tinos_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
        );
        std::fs::read(path).expect("pinned Tinos test font reads")
    }

    #[test]
    fn real_paragraphs_paginate_losslessly_through_parley() {
        let inline = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let context = BlockFormattingContext::new(inline);

        let first_text = "The quick brown fox jumps over the lazy dog and keeps running \
through the quiet forest until the morning light returns.";
        let second_text = "A second paragraph follows the first one and must keep every \
single line across page boundaries.";
        let mut inline_table = InlineStyleTableV1::new(2);
        let families = FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
            .expect("family list");
        let first_style = inline_table
            .intern_for_node(0, plain_paragraph_style(families.clone(), 16.0, 32.0))
            .expect("first style interns");
        let second_style = inline_table
            .intern_for_node(1, plain_paragraph_style(families, 16.0, 32.0))
            .expect("second style interns");
        let layout = uniform_layout_table(3);
        let nodes = vec![
            FormattingNode {
                style: node_style_id(&layout, 0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: first_text.to_owned(),
                        style: first_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            },
            FormattingNode {
                style: node_style_id(&layout, 1),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: second_text.to_owned(),
                        style: second_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            },
            FormattingNode {
                style: node_style_id(&layout, 2),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(1)],
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(2),
            FormattingTreeStyles {
                layout,
                inline: inline_table,
            },
        )
        .expect("tree builds");

        let pages = paginate(&context, &tree, ConstraintSpace::fragmented(160.0, 60.0));
        assert!(pages.len() > 2, "narrow pages force pagination");

        // Reassemble every page's text fragments; nothing may be lost or
        // duplicated across fragmentainer boundaries.
        let mut reassembled: Vec<String> = vec![String::new(), String::new()];
        for page in &pages {
            for paragraph in box_children(page) {
                let Fragment::Box(paragraph) = paragraph else {
                    panic!("paragraph fragments are boxes");
                };
                let text = match paragraph.source {
                    FormattingNodeId(0) => first_text,
                    FormattingNodeId(1) => second_text,
                    other => panic!("unexpected source {other:?}"),
                };
                let slot = &mut reassembled[paragraph.source.0 as usize];
                for line in &paragraph.children {
                    let Fragment::Line(line) = line else {
                        panic!("paragraph children are lines");
                    };
                    let mut start = u32::MAX;
                    let mut end = 0_u32;
                    for run in &line.children {
                        let Fragment::Text(run) = run else {
                            panic!("line children are text runs");
                        };
                        start = start.min(run.text_start);
                        end = end.max(run.text_end);
                    }
                    slot.push_str(&text[start as usize..end as usize]);
                }
            }
        }
        assert_eq!(reassembled[0], first_text);
        assert_eq!(reassembled[1], second_text);

        // The cache makes the second pagination replay-fast and identical.
        let repeat = paginate(&context, &tree, ConstraintSpace::fragmented(160.0, 60.0));
        assert_eq!(pages, repeat);
    }
}
