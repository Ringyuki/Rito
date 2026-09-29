//! The block driver. Lays one container's in-flow children out top to
//! bottom in the space it was given: vertical margins collapse between
//! siblings, floats are placed and cleared, nested containers recurse,
//! and at a fragmentainer edge the container seals what fits and hands
//! back the break token that resumes the rest. Also places a single
//! float box and pulls one paragraph's lines out of the inline
//! provider.

use crate::*;

impl<I: FormattingContext> BlockFormattingContext<I> {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn layout_container(
        &self,
        tree: &FormattingTree,
        container: FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&BreakToken>,
        cancel: &CancelFlag,
        collapse_root_edges: bool,
        // The parent already joined this container's first-in-flow-child
        // top-margin chain into its own collapse set (§8.3.1 through-
        // collapse); the chain is spent and must not re-apply inside.
        leading_margin_consumed: bool,
    ) -> Result<LayoutOutcome, LayoutError> {
        let children = tree.node(container).children.clone();
        let (start_child, mut resumed_consumed, resumed_inside) = resume_point(&children, token)?;
        let resumed = token.is_some();
        let fragmentainer_is_fresh = space.fragmentainer_remaining == space.fragmentainer_size;
        let mut remaining = space.fragmentainer_remaining.unwrap_or(f64::INFINITY);
        // The container's own padding: children flow inside the content
        // area. `space.inline_size` is the container's border-box width;
        // the container's own width and margins are its parent's business.
        let container_style = container_layout_style(tree, container)?;
        let pad = |side: rito_style_contract::NonNegativeLengthPercentage| {
            // LayoutUnit's float constructor truncates toward zero; a raw
            // resolved padding would get ROUNDED into the first advance
            // snap and sit one 1/64 low or high of the browser's box.
            (resolve_length_percentage(side.value(), space.inline_size) * 64.0)
                .trunc()
                .max(0.0)
                / 64.0
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
        // The collapsed root margin — the chapter body's own margin plus
        // every first-child margin the bridge folded up the chain —
        // positions content below the flow start, exactly as a browser
        // pushes a chapter's first heading down by its escaped margin
        // (a 1em heading margin starts the whole book 22px lower). It
        // belongs to the first fragment only; a resumed fragmentainer
        // starts flush like any margin meeting an unforced break.
        if collapse_root_edges && !resumed {
            let (root_margin_top, _) = vertical_margins(tree, container, space.inline_size)?;
            if root_margin_top > 0.0 {
                y += root_margin_top;
                remaining -= root_margin_top;
            }
        }
        // Padding blocks parent-child margin collapse per CSS, so a padded
        // root keeps its first child's top margin inside.
        let collapse_root_edges = collapse_root_edges && container_padding_top == 0.0;
        let mut fragments = Vec::new();
        // The margin below the previous in-flow child, awaiting collapse
        // with the next child's top margin.
        let mut pending_margin = PendingMargin::ZERO;
        // The margin set a clearing self-collapsing spacer swallowed:
        // the margins collapsing after it resolve against the cleared
        // line MINUS this amount, floored at zero (follower top = float
        // margin-box bottom + max(0, join(spacer bottom, follower top)
        // - spacer top); 32-case browser matrix).
        let mut clear_credit = 0.0_f64;
        // Arms until the first in-flow child; a resumed container starts
        // flush anyway (margins truncate at unforced breaks).
        let mut leading_margin_armed = leading_margin_consumed && !resumed;
        // A `break-after: always` on the previous in-flow child forces a
        // fragmentainer break before the next one.
        let mut pending_forced_break = false;
        // Active floats: horizontal occupancy of the current float band and
        // the deepest bottom on each side, in flow coordinates. A float
        // that a fragmentainer edge splits records a pending break and
        // resumes in its own band at the top of the next fragmentainer.
        // An incoming band is an ancestor's float still excluding content
        // at this container's origin: its own floats stack beside it.
        let mut floats = FloatBands::from_incoming(space.float_band, content_width);
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
                    containing_block_size: None,
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
            // An Inside resume continues a box whose first fragment
            // already carried the leading padding — even when it held
            // ONLY that padding (consumed 0 lines).
            let child_resumed_inside = child_resumed && resumed_inside;
            let child_style = container_layout_style(tree, *child_id)?;
            let (top_margin, bottom_margin) = vertical_margins(tree, *child_id, content_width)?;
            // §8.3.1 through-collapse, layout half: an in-flow child's top
            // margin joins its first-in-flow-descendant chain (whatever
            // the bridge could not fold — percentages resolve only now).
            // When the parent consumed THIS container's leading chain,
            // the first in-flow child's whole set is spent.
            let top_set = through_collapsed_top(tree, *child_id, content_width)?;
            // The pre-consumption set: a cleared spacer's credit is what
            // its chain would have collapsed to, whether or not the
            // parent already spent the leading chain.
            let original_top_set = top_set;
            let leading_spent = leading_margin_armed && child_style.float == Float::None;
            let (top_margin, top_set) = if leading_spent && !child_resumed {
                (0.0, PendingMargin::ZERO)
            } else {
                (top_margin, top_set)
            };
            if leading_spent {
                leading_margin_armed = false;
            }

            // Floated children leave the flow: they are placed against the
            // content edges, never advance `y`, and never split. In-flow
            // margins collapse straight through them.
            if child_style.float != Float::None {
                let hbox = self.resolve_float_box(tree, *child_id, child_style, content_width)?;
                let margin_side = |side: LengthPercentageOrAuto| match side {
                    LengthPercentageOrAuto::Auto => 0.0,
                    LengthPercentageOrAuto::Value(value) => {
                        resolve_length_percentage(value, content_width)
                    }
                };
                let margin_right = margin_side(child_style.margin.right);
                let child_space = ConstraintSpace::continuous(hbox.border_width);
                // The float's own margins are THIS placement's business
                // (fragment y = fy + top_margin): the inner layout must
                // not re-apply the root margin the collapse_root_edges
                // path adds for chapter bodies — it re-resolved the
                // float's %-margin against the float's own width and
                // stacked it onto the first heading (b60 title: h2 landed
                // 28% x 48 = 13.4px low inside its float).
                let outcome = match &tree.node(*child_id).content {
                    FormattingNodeContent::BlockContainer => self.layout_container(
                        tree,
                        *child_id,
                        &child_space,
                        None,
                        cancel,
                        false,
                        false,
                    )?,
                    _ => self.layout(tree, *child_id, &child_space, None, cancel)?,
                };
                let Fragment::Box(child_root) = outcome.fragments.root else {
                    return Err(LayoutError::Invalid(
                        "float layout must produce a box fragment root".to_owned(),
                    ));
                };
                // An inline-flow float's own padding is applied by the
                // dispatch in `layout` (content width, offsets, height);
                // nested containers apply theirs in `layout_container`.
                let inner_children = child_root.children;
                let content_height = child_root.rect.height;
                let occupy_width = hbox.x + hbox.border_width + margin_right;
                // A negative top margin pulls the float's border box above
                // its flow position (how title pages hoist a volume badge
                // back to the page top); the occupied band never extends
                // above the flow and collapses to nothing when the margin
                // swallows the whole box.
                let occupy_height = (top_margin + content_height + bottom_margin.max(0.0)).max(0.0);
                let page_bottom = y + remaining.max(0.0);
                // The float's top sits at its hypothetical in-flow
                // position (CSS 2.1 §9.5.1 rule 4), which lies below the
                // preceding sibling's still-pending bottom margin — float
                // margins never collapse with siblings (§8.3.1). The
                // pending margin is NOT consumed: in-flow margins keep
                // collapsing straight through the float.
                let flow_y = y + pending_margin.resolve().max(0.0);
                let fy_probe = floats.probe_y(occupy_width, flow_y, content_width);
                let fits = space.fragmentainer_remaining.is_none()
                    || fy_probe + occupy_height <= page_bottom + 1e-6;
                if fits {
                    let (fx, fy) = floats.place(
                        child_style.float,
                        occupy_width,
                        occupy_height,
                        flow_y,
                        content_width,
                    );
                    placed_floats.push(rito_fragment::EscapedFloat {
                        right_side: matches!(child_style.float, Float::Right),
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
                        containing_block_size: None,
                    };
                    let outcome = self.layout(tree, *child_id, &sub_space, None, cancel)?;
                    let Fragment::Box(head_root) = outcome.fragments.root else {
                        return Err(LayoutError::Invalid(
                            "float layout must produce a box fragment root".to_owned(),
                        ));
                    };
                    // A head that consumed NOTHING is not a split: the
                    // browser moves the whole float to the next
                    // fragmentainer, margins and leading padding intact
                    // (b12's chat rows: the avatar float kept its 8px
                    // padding and the bubble its 0.7em margin on the new
                    // page, where the empty-head split resumed both
                    // stripped to the content). Fall through to the
                    // move-whole break below.
                    let head_consumed =
                        !head_root.children.is_empty() || outcome.continuation.is_none();
                    if head_consumed {
                        let occupy = if outcome.continuation.is_some() {
                            (page_bottom - fy_probe).max(0.0)
                        } else {
                            top_margin.max(0.0) + head_root.rect.height + bottom_margin.max(0.0)
                        };
                        let (fx, fy) = floats.place(
                            child_style.float,
                            occupy_width,
                            occupy,
                            flow_y,
                            content_width,
                        );
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
                pending_forced_break || child_style.break_before == PageBreak::Always;
            pending_forced_break = child_style.break_after == PageBreak::Always;
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
            // `clear` names. CSS 2.1 §9.5.2 compares the box's
            // HYPOTHETICAL border-top — its position after the normal
            // margin collapse — and when the floats reach below it, the
            // border top lands exactly at the clear position: clearance
            // swallows the collapsed margin whole (measured: a clearing
            // spacer's border top == the float's bottom, no margin gap).
            let clear_to = floats.bottom_for(child_style.clear);
            let swallowed_set = pending_margin.merge(original_top_set).resolve().max(0.0);
            let cleared = !child_resumed && clear_to > y + pending_margin.merge(top_set).resolve();
            if cleared {
                let page_bottom = y + remaining.max(0.0);
                y = clear_to;
                remaining = (page_bottom - y).max(0.0);
                pending_margin = PendingMargin::ZERO;
            }

            // A margin that meets an unforced break is truncated to zero,
            // so a resumed child starts flush at the fragmentainer top.
            // A first child's escaping top margin is folded onto its
            // container by the bridge, which is where the CSS cascade of
            // adjoining margins belongs; whatever the fold could not
            // resolve there (a percentage has no basis until layout) is
            // still a real margin and is applied here, as a browser does.
            let gap = if child_resumed || cleared {
                0.0
            } else {
                let collapsed = pending_margin.merge(top_set).resolve();
                if clear_credit > 0.0 {
                    (collapsed - clear_credit).max(0.0)
                } else {
                    collapsed
                }
            };
            clear_credit = 0.0;
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
                    // The leaf's own width and horizontal margins resolve
                    // like any block box (an `<hr>` at `width: 50%;
                    // margin-left: 1em` occupies half the line, offset —
                    // it does not span the container).
                    let leaf_style = container_layout_style(tree, *child_id)?;
                    let leaf_box = resolve_horizontal_box(leaf_style, content_width)?;
                    let outstanding = block_size - consumed;
                    if outstanding <= available {
                        y += gap;
                        remaining -= gap;
                        fragments.push(leaf_fragment(
                            *child_id,
                            content_left + leaf_box.x,
                            y,
                            leaf_box.border_width,
                            outstanding,
                        ));
                        y += outstanding;
                        remaining -= outstanding;
                        pending_margin = PendingMargin::from_margin(bottom_margin);
                        continue;
                    }
                    if *breakable && available > 0.0 {
                        y += gap;
                        fragments.push(leaf_fragment(
                            *child_id,
                            content_left + leaf_box.x,
                            y,
                            leaf_box.border_width,
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
                    // A monolith that WOULD fit a fresh fragmentainer breaks
                    // to one even though this page holds nothing but leading
                    // padding: Blink pushes a full-page plate past the
                    // chapter opener's collapsed margin and leaves the first
                    // page blank (b117 gallery — force-placing here ran the
                    // whole chapter one page early). Strictly-more room on
                    // the fresh page guarantees termination.
                    let fresh_capacity = space.fragmentainer_size.unwrap_or(f64::INFINITY);
                    if outstanding <= fresh_capacity && available < fresh_capacity {
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
                FormattingNodeContent::InlineFlow { items } => {
                    let child_style = container_layout_style(tree, *child_id)?;
                    let hbox = resolve_horizontal_box(child_style, content_width)?;
                    if items.is_empty()
                        && hbox.padding_top == 0.0
                        && hbox.padding_bottom == 0.0
                        && !child_resumed
                    {
                        // A block container with no inline content
                        // generates no line boxes (CSS 2.1 §9.4.2) — an
                        // empty `<h4></h4>` is a self-collapsing box whose
                        // margins collapse through (§8.3.1), not a strut
                        // line. The zero-height box still exists at the
                        // collapsed position, like the empty-container
                        // branch below.
                        fragments.push(Fragment::Box(BoxFragment {
                            source: *child_id,
                            rect: FragmentRect {
                                x: content_left + hbox.x,
                                y: y + gap,
                                width: hbox.border_width,
                                height: 0.0,
                            },
                            children: Vec::new(),
                        }));
                        pending_margin = if cleared {
                            // The spacer's swallowed top set must not
                            // resurrect through the pass-through; it
                            // credits against the next collapse instead.
                            clear_credit = swallowed_set;
                            PendingMargin::from_margin(bottom_margin)
                        } else {
                            pending_margin.merge(top_set).join(bottom_margin)
                        };
                        continue;
                    }
                    // The paragraph's own top padding rides its first
                    // fragment; bottom padding rides the last. An Inside
                    // resume is never the first fragment, even at zero
                    // consumed lines (the padding-only fragment case).
                    let leading_padding = if consumed == 0.0 && !child_resumed_inside {
                        hbox.padding_top
                    } else {
                        0.0
                    };
                    // Floats beside this paragraph shorten its line boxes
                    // instead of pushing it down, which is what a browser
                    // does; the paragraph box itself keeps its position.
                    // The band is container geometry; the inline provider
                    // works in the paragraph's own content coordinates, so
                    // the insets shrink to the overlap with the paragraph's
                    // content span (CSS 2.1 §9.5 — a float left of an
                    // auto-centered box never shortens its lines) and the
                    // extent re-bases to the paragraph's first line.
                    let paragraph_top = y + gap + leading_padding;
                    let band = floats
                        .band_at(paragraph_top, content_width)
                        .and_then(|band| {
                            let child_left = hbox.x + hbox.padding_left;
                            let child_right = child_left + hbox.content_width;
                            let left =
                                (band.left_inset - child_left).clamp(0.0, hbox.content_width);
                            let right = (child_right - (content_width - band.right_inset))
                                .clamp(0.0, hbox.content_width);
                            // `band_at` already re-bases the bottom to
                            // the queried flow position; subtracting the
                            // paragraph top AGAIN turned the extent
                            // negative for any paragraph deep in the flow
                            // (a negative-margin-raised line back inside
                            // a float's band lost its avoidance and hit
                            // the container edge).
                            let bottom = band.bottom;
                            (bottom > 1e-6 && (left > 0.0 || right > 0.0)).then_some(
                                rito_fragment::FloatBand {
                                    left_inset: left,
                                    right_inset: right,
                                    bottom,
                                },
                            )
                        });
                    // A fixed-height paragraph is a DEFINITE containing
                    // block for its replaced children: percentage block
                    // sizes resolve against its content height.
                    let definite_content_height =
                        resolve_fixed_height(child_style, hbox.padding_top + hbox.padding_bottom)?
                            .map(|fixed| (fixed - hbox.padding_top - hbox.padding_bottom).max(0.0));
                    let lines = self.inline_lines(
                        tree,
                        *child_id,
                        hbox.content_width,
                        space.fragmentainer_size,
                        definite_content_height,
                        band,
                        cancel,
                    )?;
                    let available_for_lines = (available - leading_padding).max(0.0);
                    // A fresh page narrowed by the box's own leading
                    // padding is NOT force-fit territory: the padding
                    // edge is a break opportunity, so the break lands
                    // after the padding — a padding-only fragment — and
                    // the line opens the next page at full height. This
                    // holds even when the line will not fit a whole
                    // fragmentainer either: a monolithic line only
                    // overflows in place at the very top of an
                    // unconsumed fragmentainer, which the Inside resume
                    // provides (measured: Blink leaves a 2px-only blank
                    // column before a full-height illustration whose
                    // 854px line box — 850px image plus strut descent —
                    // overflows the following column invisibly).
                    let padding_squeezed = page_is_empty
                        && leading_padding > 0.0
                        && lines.first().is_some_and(|line| {
                            line.rect().height > available_for_lines + f64::EPSILON
                        });
                    let placement = place_lines(
                        &lines,
                        consumed,
                        available_for_lines,
                        page_is_empty && !padding_squeezed,
                        space.fragmentainer_size,
                    );
                    if placement.lines.is_empty() && !placement.exhausted {
                        if padding_squeezed {
                            // The break lands AFTER the leading padding:
                            // this page keeps a padding-only fragment
                            // and the first line opens the next
                            // fragmentainer at full height, where the
                            // Inside resume carries no leading padding
                            // (measured: Blink's 2px-only blank column
                            // before a full-height illustration).
                            y = layout_unit(y + gap);
                            fragments.push(Fragment::Box(BoxFragment {
                                source: *child_id,
                                rect: FragmentRect {
                                    x: content_left + hbox.x,
                                    y,
                                    width: hbox.border_width,
                                    height: leading_padding,
                                },
                                children: Vec::new(),
                            }));
                            y = layout_unit(y + leading_padding);
                            return Ok(sealed_with_break(
                                container,
                                space.inline_size,
                                y,
                                fragments,
                                BreakToken {
                                    resume_path: vec![*child_id],
                                    stage: BreakTokenStage::Inside {
                                        consumed_block_size: consumed,
                                    },
                                    pending_floats: std::mem::take(&mut pending_float_breaks),
                                },
                            ));
                        }
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
                    let mut trailing_deferred = false;
                    let had_lines = !placement.lines.is_empty();
                    if had_lines {
                        let content_height = leading_padding + (placement.consumed_end - consumed);
                        let trailing_fits =
                            content_height + hbox.padding_bottom <= remaining - gap + f64::EPSILON;
                        // A box whose every line fits but whose trailing
                        // padding does not moves WHOLE to the next page
                        // when it can: Blink prefers the class-A break
                        // before the box over the padding-only closing
                        // fragment (measured: a one-line TOC entry whose
                        // line ends at 849.08/850 with 1.59 of trailing
                        // padding opens the next column whole). The
                        // padding-only fragment remains for boxes with no
                        // whole-box alternative — resumed, taller than a
                        // fresh page, or opening an empty one.
                        if placement.exhausted
                            && !trailing_fits
                            && hbox.padding_bottom > 0.0
                            && !child_resumed
                            && !page_is_empty
                            && space.fragmentainer_size.is_some_and(|size| {
                                content_height + hbox.padding_bottom <= size + f64::EPSILON
                            })
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
                        y = layout_unit(y + gap);
                        remaining -= gap;
                        // Trailing padding that no longer fits after the
                        // last line (an overflowing monolithic line, or
                        // lines ending flush with the page bottom)
                        // continues on the next page as a padding-only
                        // closing fragment, the way Blink pushes a
                        // container's bottom padding past an overflowing
                        // illustration (measured: 2px of `.kuan` padding
                        // opens the next column, and the following
                        // sibling's margin stacks after it un-truncated).
                        trailing_deferred =
                            placement.exhausted && !trailing_fits && hbox.padding_bottom > 0.0;
                        let trailing_padding = if placement.exhausted && trailing_fits {
                            hbox.padding_bottom
                        } else {
                            0.0
                        };
                        // A specified height fixes the paragraph's
                        // border-box height exactly like a block
                        // container's: short content leaves empty space,
                        // tall lines overflow visibly (b74's title pill,
                        // `height: 30px; padding-top: 1em` around a 20.8px
                        // line, flows 54px tall in Blink). It applies when
                        // the whole box lands in this fragment; split
                        // boxes keep per-fragment content heights.
                        let whole_box_here =
                            consumed == 0.0 && placement.exhausted && !trailing_deferred;
                        let fixed_height = if whole_box_here {
                            resolve_fixed_height(
                                child_style,
                                hbox.padding_top + hbox.padding_bottom,
                            )?
                        } else {
                            None
                        };
                        let paragraph_height =
                            fixed_height.unwrap_or(content_height + trailing_padding);
                        // A degraded flex container with `align-items:
                        // center` and a fixed height centers its (single
                        // flex line of) content on the cross axis: lines
                        // shorter than the content box shift down by half
                        // the slack (measured on b2's landscape plates —
                        // a 449px img in the 765px `.illus` box inks at
                        // top+158 in the browser, exactly (765-449)/2).
                        let cross_center = if whole_box_here
                            && child_style.display.inside
                                == rito_style_contract::LayoutDisplayInside::Flex
                            && child_style.align_items == rito_style_contract::AlignItems::Center
                        {
                            // The flex ITEM is what centers, not the line
                            // box: a replaced item's box excludes the
                            // strut descent the line adds below it, so a
                            // single-image flex centers by the IMAGE
                            // height (measured on b2's .kuchie plates:
                            // 447.8px image in the 765px box inks at
                            // top+158 = (765-447.8)/2 rounded; centering
                            // the line's 455px sat the plate 2.6px high).
                            let single_image_height = {
                                let mut image_height: Option<f64> = None;
                                let mut other_content = false;
                                for line in &placement.lines {
                                    let Fragment::Line(line) = line else {
                                        other_content = true;
                                        continue;
                                    };
                                    for child in &line.children {
                                        match child {
                                            Fragment::Image(image) => {
                                                image_height = match image_height {
                                                    None => Some(image.rect.height),
                                                    Some(_) => {
                                                        other_content = true;
                                                        None
                                                    }
                                                };
                                            }
                                            _ => other_content = true,
                                        }
                                    }
                                }
                                if other_content {
                                    None
                                } else {
                                    image_height
                                }
                            };
                            fixed_height
                                .map(|fixed| {
                                    let content_box =
                                        fixed - hbox.padding_top - hbox.padding_bottom;
                                    let item = single_image_height.unwrap_or(content_height);
                                    // An item TALLER than the box still
                                    // centers: the offset goes negative
                                    // and the ink overflows above (b11's
                                    // 850px cover in a 93vh flex box
                                    // paints from -29.75, its top 30px
                                    // above the column).
                                    (content_box - item) / 2.0
                                })
                                .unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        let children: Vec<Fragment> = placement
                            .lines
                            .into_iter()
                            .map(|mut line| {
                                let rect = line.rect();
                                set_fragment_position(
                                    &mut line,
                                    rect.x + hbox.padding_left,
                                    rect.y + leading_padding + cross_center,
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
                        y = layout_unit(y + paragraph_height);
                        remaining -= paragraph_height;
                    }
                    if placement.exhausted {
                        if trailing_deferred {
                            // The deferred bottom padding resumes as an
                            // Inside continuation with every line consumed.
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
                        if !had_lines && child_resumed_inside && hbox.padding_bottom > 0.0 {
                            // The padding-only closing fragment: the box's
                            // content finished on the previous page past
                            // its bottom, and only the trailing padding
                            // lands here. It consumes real space, so the
                            // next sibling's margin stacks after it
                            // instead of truncating at the page top.
                            y = layout_unit(y + gap);
                            remaining -= gap;
                            fragments.push(Fragment::Box(BoxFragment {
                                source: *child_id,
                                rect: FragmentRect {
                                    x: content_left + hbox.x,
                                    y,
                                    width: hbox.border_width,
                                    height: hbox.padding_bottom,
                                },
                                children: Vec::new(),
                            }));
                            y = layout_unit(y + hbox.padding_bottom);
                            remaining -= hbox.padding_bottom;
                        }
                        pending_margin = PendingMargin::from_margin(bottom_margin);
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
                    // The table's own padding (its absorbed border included)
                    // wraps the grid: the grid sizes columns inside the
                    // content box and the fragment grows back to the border
                    // box, exactly like any container. Leading padding rides
                    // the first fragment only; trailing rides the last.
                    let pad_top = if child_resumed { 0.0 } else { hbox.padding_top };
                    let grid_width = hbox.content_width;
                    let placement = if space.fragmentainer_remaining.is_none() {
                        // Continuous flow: the table lays out whole.
                        TableFragmentainerPlacement::Placed {
                            fragment: self.layout_table(
                                tree,
                                *child_id,
                                grid_width,
                                matches!(child_style.width, PreferredSize::Value(_)),
                                cancel,
                            )?,
                            continuation: None,
                        }
                    } else {
                        let child_token = if child_resumed {
                            descend_token(token, consumed)?
                        } else {
                            None
                        };
                        self.layout_table_in_fragmentainer(
                            tree,
                            *child_id,
                            grid_width,
                            matches!(child_style.width, PreferredSize::Value(_)),
                            (available - pad_top).max(0.0),
                            space.fragmentainer_size,
                            child_token.as_ref(),
                            page_is_empty,
                            cancel,
                        )?
                    };
                    let (table, continuation) = match placement {
                        TableFragmentainerPlacement::BreakBefore => {
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
                        TableFragmentainerPlacement::Placed {
                            fragment,
                            continuation,
                        } => (fragment, continuation),
                    };
                    // The border box wraps the grid: rows shift inside by
                    // the leading padding, the trailing padding rides the
                    // LAST fragment only.
                    let pad_bottom = if continuation.is_none() {
                        hbox.padding_bottom
                    } else {
                        0.0
                    };
                    let mut table = table;
                    if hbox.padding_left > 0.0 || pad_top > 0.0 {
                        for child in &mut table.children {
                            let rect = child.rect();
                            let (cx, cy) = (rect.x + hbox.padding_left, rect.y + pad_top);
                            set_fragment_position(child, cx, cy);
                        }
                    }
                    let padding_right =
                        (hbox.border_width - hbox.padding_left - hbox.content_width).max(0.0);
                    let border_width = table.rect.width + hbox.padding_left + padding_right;
                    // A table shrinks to fit, so its auto margins resolve
                    // against the used width, not the available one: this
                    // is what centers `margin: 0 auto` tables.
                    let table_x = shrink_to_fit_offset(child_style, content_width, border_width);
                    let table_height = table.rect.height + pad_top + pad_bottom;
                    y += gap;
                    remaining -= gap;
                    fragments.push(Fragment::Box(BoxFragment {
                        source: *child_id,
                        rect: FragmentRect {
                            x: content_left + table_x,
                            y,
                            width: border_width,
                            height: table_height,
                        },
                        children: table.children,
                    }));
                    y += table_height;
                    remaining -= table_height;
                    match continuation {
                        None => {
                            pending_margin = PendingMargin::from_margin(bottom_margin);
                            continue;
                        }
                        Some(inner) => {
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
                        containing_block_size: None,
                    };
                    // Mirror of through_collapsed_top's descent predicate:
                    // when the child's leading chain joined THIS loop's
                    // collapse set, its first in-flow child must start
                    // flush inside.
                    let child_leading_consumed =
                        !child_resumed && !is_flow_root(child_style) && hbox.padding_top == 0.0;
                    let outcome = self.layout_container(
                        tree,
                        *child_id,
                        &child_space,
                        child_token.as_ref(),
                        cancel,
                        false,
                        child_leading_consumed,
                    )?;
                    let Fragment::Box(child_root) = outcome.fragments.root else {
                        return Err(LayoutError::Invalid(
                            "container layout must produce a box fragment root".to_owned(),
                        ));
                    };
                    if child_root.children.is_empty()
                        && child_root.rect.height > 0.0
                        && outcome.continuation.is_some()
                        && !child_resumed
                        && space.fragmentainer_remaining.is_some()
                        && !(fragments.is_empty() && fragmentainer_is_fresh)
                    {
                        // A childless head — the box opened with its
                        // leading border/padding but placed NO content —
                        // on a page that already holds something: the
                        // browser moves the WHOLE box to the next
                        // fragmentainer instead (measured on b53's
                        // bordered chat box: the 9px padding sliver at
                        // the page bottom was engine-only, the browser
                        // broke clean before the border). The padding-only
                        // head is real only when the box opens an
                        // otherwise EMPTY fragmentainer — b19's 2px-only
                        // blank column before a full-height illustration
                        // — which the fresh-page guard preserves.
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
                    if child_root.children.is_empty()
                        && child_root.rect.height <= 0.0
                        && outcome.continuation.is_none()
                    {
                        // A self-collapsing empty block (CSS 8.3.1): its
                        // margins collapse through it and it advances no
                        // flow — but the box exists. Chromium reports a
                        // zero-height rect at the collapsed position (a
                        // `<div style="clear:both"></div>` divider sits at
                        // the cleared flow position), the differential
                        // joins on it, and dropping the fragment read as a
                        // missing-box defect on every such divider. A
                        // childless head that carries a continuation is
                        // NOT that: it is a break-before, and the break
                        // must propagate.
                        fragments.push(Fragment::Box(BoxFragment {
                            source: *child_id,
                            rect: FragmentRect {
                                x: content_left + hbox.x,
                                y: y + gap,
                                width: hbox.border_width,
                                height: 0.0,
                            },
                            children: Vec::new(),
                        }));
                        pending_margin = if cleared {
                            // The spacer's swallowed set credits against
                            // the next collapse instead of resurrecting
                            // through the pass-through.
                            clear_credit = swallowed_set;
                            PendingMargin::from_margin(bottom_margin)
                        } else {
                            pending_margin.merge(top_set).join(bottom_margin)
                        };
                        continue;
                    }
                    {
                        y = layout_unit(y + gap);
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
                            pending_margin = PendingMargin::from_margin(bottom_margin);
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
            let resolved_pending = pending_margin.resolve();
            y += resolved_pending.min(remaining.max(0.0));
            remaining -= resolved_pending;
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
        child_style: &LayoutFormattingStyle,
        content_width: f64,
    ) -> Result<HorizontalBox, LayoutError> {
        let hbox = resolve_horizontal_box(child_style, content_width)?;
        if matches!(child_style.width, PreferredSize::Value(_))
            || matches!(child_style.max_width, MaximumSize::Value(_))
        {
            return Ok(hbox);
        }
        // Shrink-to-fit sizes the float's own content box (CSS 2.1
        // §10.3.5). The dispatchable intrinsics answer a different
        // question — what the box hands its PARENT, a margin-box
        // contribution (css-sizing-3 §5.2) — so an inline flow's raw
        // content sizes are taken directly, before its own margins are
        // folded in, and a container's contribution gives its own
        // horizontal margins back (measured: a title page's float
        // columns each carrying `margin-left: 0.2em` doubled every
        // inter-column gap when the margin stayed inside the fit).
        let resolve = |value| resolve_length_percentage(value, content_width);
        let margin_used = [child_style.margin.left, child_style.margin.right]
            .iter()
            .map(|side| match side {
                LengthPercentageOrAuto::Auto => 0.0,
                LengthPercentageOrAuto::Value(value) => resolve(*value),
            })
            .sum::<f64>();
        let sizes = match tree.node(child_id).content {
            FormattingNodeContent::InlineFlow { .. } => {
                self.inline.intrinsic_inline_sizes(tree, child_id)?
            }
            _ => {
                let contribution = self.intrinsic_inline_sizes(tree, child_id)?;
                IntrinsicInlineSizes {
                    min_content: (contribution.min_content - margin_used).max(0.0),
                    max_content: (contribution.max_content - margin_used).max(0.0),
                }
            }
        };
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
    #[allow(clippy::too_many_arguments)]
    fn inline_lines(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        inline_size: f64,
        page_block_size: Option<f64>,
        containing_block_size: Option<f64>,
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
            containing_block_size,
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
