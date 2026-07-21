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
    BoxFragment, BreakToken, BreakTokenStage, CancelFlag, ConstraintSpace, FormattingContext,
    FormattingNodeContent, FormattingNodeId, FormattingTree, Fragment, FragmentCache, FragmentRect,
    FragmentTree, IntrinsicInlineSizes, LayoutError, LayoutOutcome,
};
use rito_style_contract::{
    BoxSizingV1, ClearV1, FloatV1, LayoutFormattingStyleV1, LengthPercentage,
    LengthPercentageOrAuto, MaximumSizeV1, PreferredSizeV1,
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
        // Active floats: horizontal occupancy of the current float band and
        // the deepest bottom on each side, in flow coordinates. Floats
        // never cross a fragmentainer edge in this profile.
        let mut floats = FloatBands::new();
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
                let hbox = resolve_horizontal_box(child_style, content_width)?;
                if matches!(child_style.width, PreferredSizeV1::Auto)
                    && child_style.max_width == MaximumSizeV1::None
                {
                    return Err(LayoutError::Invalid(
                        "a floated box without a width needs shrink-to-fit sizing, which is \
                         not representable yet"
                            .to_owned(),
                    ));
                }
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
                let occupy_height = top_margin.max(0.0) + content_height + bottom_margin.max(0.0);
                let (fx, fy) = floats.place(
                    child_style.float,
                    occupy_width,
                    occupy_height,
                    y,
                    content_width,
                );
                // Pagination: a float never splits; when it does not fit
                // the current fragmentainer it moves whole to the next one.
                let page_bottom = y + remaining.max(0.0);
                if space.fragmentainer_remaining.is_some()
                    && fy + occupy_height > page_bottom + 1e-6
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
                        },
                    ));
                }
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
            // In-flow content beside an active float needs line boxes that
            // shorten around it — not representable yet, so it fails
            // closed instead of overlapping the float.
            if floats.has_active(y) {
                return Err(LayoutError::Invalid(
                    "in-flow content beside a float needs float wrapping, which is not \
                     representable yet"
                        .to_owned(),
                ));
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
                    return Ok(LayoutOutcome {
                        fragments: sealed(container, space.inline_size, y, fragments),
                        continuation: children.get(index + 1).map(|next| BreakToken {
                            resume_path: vec![*next],
                            stage: BreakTokenStage::Before,
                        }),
                    });
                }
                FormattingNodeContent::InlineFlow { .. } => {
                    let child_style = container_layout_style(tree, *child_id)?;
                    let hbox = resolve_horizontal_box(child_style, content_width)?;
                    let lines = self.inline_lines(tree, *child_id, hbox.content_width, cancel)?;
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
                        },
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
                    }
                    match outcome.continuation {
                        None => {
                            pending_margin = bottom_margin;
                            continue;
                        }
                        Some(inner) => {
                            let mut resume_path = Vec::with_capacity(inner.resume_path.len() + 1);
                            resume_path.push(*child_id);
                            resume_path.extend(inner.resume_path);
                            return Ok(sealed_with_break(
                                container,
                                space.inline_size,
                                y,
                                fragments,
                                BreakToken {
                                    resume_path,
                                    stage: inner.stage,
                                },
                            ));
                        }
                    }
                }
            }
        }
        // The container is a flow root here: it contains its floats, so
        // its final height reaches the deepest float bottom.
        y = seal_height(y, &floats);
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
        // than the box leaves empty space (spacers); content taller than a
        // fixed height needs overflow layout the engine cannot represent
        // yet, so it fails closed instead of overlapping what follows.
        if let Some(fixed) = resolve_fixed_height(
            container_style,
            container_padding_top + container_padding_bottom,
        )? {
            if y > fixed + 0.01 {
                return Err(LayoutError::Invalid(format!(
                    "content ({y:.1}px) overflows the fixed height ({fixed:.1}px)"
                )));
            }
            y = fixed;
        }
        Ok(LayoutOutcome {
            fragments: sealed(container, space.inline_size, y, fragments),
            continuation: None,
        })
    }

    /// Lays an inline flow out in continuous space through the internal
    /// cache and returns its line fragments in paragraph coordinates.
    fn inline_lines(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        inline_size: f64,
        cancel: &CancelFlag,
    ) -> Result<Vec<Fragment>, LayoutError> {
        let outcome = self
            .inline_cache
            .borrow_mut()
            .layout(
                &self.inline,
                tree,
                node,
                &ConstraintSpace::continuous(inline_size),
                None,
                cancel,
            )?
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
                self.inline.intrinsic_inline_sizes(tree, node)
            }
            FormattingNodeContent::BlockContainer => {
                let mut sizes = IntrinsicInlineSizes {
                    min_content: 0.0,
                    max_content: 0.0,
                };
                for child in &tree.node(node).children {
                    let child_sizes = self.intrinsic_inline_sizes(tree, *child)?;
                    sizes.min_content = sizes.min_content.max(child_sizes.min_content);
                    sizes.max_content = sizes.max_content.max(child_sizes.max_content);
                }
                Ok(sizes)
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
    if token.resume_path.len() > 1 {
        return Ok(Some(BreakToken {
            resume_path: token.resume_path[1..].to_vec(),
            stage: token.stage,
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
        return Err(LayoutError::Invalid(
            "break token carries an empty resume path".to_owned(),
        ));
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

    fn bottom_for(&self, clear: ClearV1) -> f64 {
        match clear {
            ClearV1::None => f64::NEG_INFINITY,
            ClearV1::Left => self.left_bottom,
            ClearV1::Right => self.right_bottom,
            ClearV1::Both => self.left_bottom.max(self.right_bottom),
        }
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
    fn cleared_content_starts_below_floats_and_uncleaned_content_fails_closed() {
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

        let beside_tree = build(block_style(margin_px(0.0), margin_px(0.0)));
        assert!(matches!(
            context.layout(
                &beside_tree,
                beside_tree.root(),
                &ConstraintSpace::continuous(200.0),
                None,
                &CancelFlag::new()
            ),
            Err(LayoutError::Invalid(_))
        ));
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
