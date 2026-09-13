//! Static parent-child margin collapsing. Margins that CSS lets escape
//! through an undecorated container are folded onto that container
//! bottom-up (padding, overflow, height, flow roots, leading or trailing
//! floats and clearing spacers stop the escape), and the chapter body's
//! own margins become body padding so the flow offsets on the first page.

use rito_fragment::{FormattingNode, FormattingNodeContent, FormattingNodeId};
use rito_style_contract::{
    Clear, Float, LayoutStyleTable, LengthPercentage, LengthPercentageOrAuto, MinimumHeight,
    NonNegativeLengthPercentage, Overflow, PreferredSize,
};

use crate::epub::{EpubError, EpubResult};

/// A contentless chapter tree, for sources the parser found no body in:
/// the chapter renders as one empty page instead of blocking the book.
/// Folds CSS parent-child margin collapse into the tree statically.
///
/// The block engine collapses adjacent sibling margins but treats every
/// container as a formatting-context root, so a paragraph's margin inside
/// an undecorated wrapper `<div>` would stack with the wrapper's own
/// margin where a browser collapses them through the boundary. Because
/// the bridge tree is fully resolved, the through-collapse is a static
/// property: an escaping child margin moves onto the parent (joined with
/// the CSS collapse rule) and the child keeps zero. Runs bottom-up so a
/// margin escapes any depth of plain wrappers, exactly like the cascade
/// of adjoining margins in CSS 2 §8.3.1.
///
/// A boundary stops the escape when CSS says it must: padding (borders
/// are already absorbed as padding by this bridge) on the meeting edge,
/// a non-`visible` overflow (a new formatting context), or — for the
/// bottom edge — a non-auto height or min-height.
pub(super) fn fold_through_collapsing_margins(
    nodes: &mut [FormattingNode],
    root: FormattingNodeId,
    layout: &mut LayoutStyleTable,
) -> EpubResult<()> {
    fn resolved_px(value: LengthPercentageOrAuto) -> Option<f64> {
        match value {
            LengthPercentageOrAuto::Value(LengthPercentage::Length(px)) => {
                Some(f64::from(px.get()))
            }
            // A zero percentage is zero at any basis; treating it as
            // unresolvable made a `body { margin: 0% 1%; }` swallow its
            // first child's escaped margin — the child was zeroed before
            // the body's own margin failed to resolve, and the chapter
            // opened flush where the browser keeps the 1.5em gap.
            LengthPercentageOrAuto::Value(LengthPercentage::Percentage(pct))
                if pct.ratio() == 0.0 =>
            {
                Some(0.0)
            }
            LengthPercentageOrAuto::Auto => Some(0.0),
            _ => None,
        }
    }
    fn zero_padding(value: NonNegativeLengthPercentage) -> bool {
        matches!(value.value(), LengthPercentage::Length(px) if px.get() == 0.0)
            || matches!(value.value(), LengthPercentage::Percentage(pct) if pct.ratio() == 0.0)
    }
    /// CSS 2 §8.3.1 pairwise join: positives take the max, negatives the
    /// most negative, mixed signs sum.
    fn join(a: f64, b: f64) -> f64 {
        a.max(0.0).max(b.max(0.0)) + a.min(0.0).min(b.min(0.0))
    }
    fn set_margin(
        layout: &mut LayoutStyleTable,
        nodes: &mut [FormattingNode],
        node: FormattingNodeId,
        top: Option<f64>,
        bottom: Option<f64>,
    ) -> EpubResult<()> {
        let mut style = *layout
            .style(nodes[node.0 as usize].style)
            .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?;
        let as_length = |px: f64| -> EpubResult<LengthPercentageOrAuto> {
            Ok(LengthPercentageOrAuto::Value(LengthPercentage::Length(
                rito_style_contract::CssPx::new(px as f32)
                    .map_err(|error| EpubError::new(format!("folded margin is finite: {error}")))?,
            )))
        };
        if let Some(px) = top {
            style.margin.top = as_length(px)?;
        }
        if let Some(px) = bottom {
            style.margin.bottom = as_length(px)?;
        }
        nodes[node.0 as usize].style = layout
            .intern(style)
            .map_err(|error| EpubError::new(format!("folded style interns: {error}")))?;
        Ok(())
    }
    fn fold(
        nodes: &mut [FormattingNode],
        node: FormattingNodeId,
        layout: &mut LayoutStyleTable,
        is_root: bool,
    ) -> EpubResult<()> {
        let children = nodes[node.0 as usize].children.clone();
        for child in &children {
            if matches!(
                nodes[child.0 as usize].content,
                FormattingNodeContent::BlockContainer
            ) {
                fold(nodes, *child, layout, false)?;
            }
        }
        if children.is_empty() {
            return Ok(());
        }
        let style = *layout
            .style(nodes[node.0 as usize].style)
            .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?;
        if style.overflow != Overflow::Visible {
            return Ok(());
        }
        // A flow root seals its margins: a FLOAT (or explicit flow-root)
        // container establishes a new block formatting context, so its
        // first child's margin stays INSIDE the box instead of lifting
        // onto it (bridge-level replica: a float holding a 21px-margined
        // h1 must sit at flow position 0 with the heading 21px inside —
        // the unguarded fold parked the float itself at 21).
        if style.float != Float::None
            || matches!(
                style.display.inside,
                rito_style_contract::LayoutDisplayInside::FlowRoot
            )
        {
            return Ok(());
        }
        fn in_flow(
            nodes: &[FormattingNode],
            layout: &mut LayoutStyleTable,
            id: FormattingNodeId,
        ) -> bool {
            layout
                .style(nodes[id.0 as usize].style)
                .map(|child| child.float == Float::None)
                .unwrap_or(false)
        }
        // At the ROOT container only: a float before the first in-flow
        // child anchors at the body top, above that child's top margin
        // (measured on b12's title: the glyph-stack floats sit at the
        // body top while the first in-flow block opens 1em lower — the
        // fold lifted the margin onto the body and every float moved
        // down with it). The margin stays on the child then. INNER
        // containers keep the fold even with leading floats: their
        // escaped margin acts before the container and the floats ride
        // with it (an unguarded skip moved b9's plate floats 22.7k).
        let float_leads = is_root
            && children
                .iter()
                .copied()
                .find(|id| {
                    in_flow(nodes, layout, *id)
                        || layout
                            .style(nodes[id.0 as usize].style)
                            .map(|child| child.float != Float::None)
                            .unwrap_or(false)
                })
                .is_some_and(|id| !in_flow(nodes, layout, id));
        if zero_padding(style.padding.top) && !float_leads {
            // The escaping set at the container top: the first in-flow
            // child's top margin — and, when that child is a
            // self-collapsing empty block (CSS 2 §8.3.1: no lines, no
            // children, auto heights, no padding), its bottom margin and
            // the NEXT sibling's top margin join the same set. Folding
            // only the top while the bottom stayed behind split the pair:
            // an empty `<h4>` with margins 30/25 read as 30 + 25 = 55
            // where the browser collapses the whole set to 30.
            fn is_self_collapsing_empty(
                nodes: &[FormattingNode],
                layout: &mut LayoutStyleTable,
                id: FormattingNodeId,
                zero_padding: &impl Fn(NonNegativeLengthPercentage) -> bool,
            ) -> bool {
                let node = &nodes[id.0 as usize];
                if !matches!(node.content, FormattingNodeContent::BlockContainer)
                    || !node.children.is_empty()
                {
                    return false;
                }
                layout
                    .style(node.style)
                    .map(|style| {
                        zero_padding(style.padding.top)
                            && zero_padding(style.padding.bottom)
                            && style.height == PreferredSize::Auto
                            && style.min_height == MinimumHeight::Auto
                    })
                    .unwrap_or(false)
            }
            let mut accumulated: Option<f64> = None;
            // The container's own margin must be resolvable before any
            // child margin is zeroed: an unresolvable own margin used to
            // abort AFTER the children were stripped, dropping their
            // margins on the floor instead of leaving them in place.
            let own = resolved_px(style.margin.top);
            let in_flow_children: Vec<FormattingNodeId> = if own.is_some() {
                children
                    .iter()
                    .copied()
                    .filter(|id| in_flow(nodes, layout, *id))
                    .collect()
            } else {
                Vec::new()
            };
            for child in in_flow_children {
                let child_style = layout
                    .style(nodes[child.0 as usize].style)
                    .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?;
                let child_clear = child_style.clear;
                let child_margin_top = child_style.margin.top;
                // A clearing spacer with float siblings before it takes
                // clearance at layout time; the margins at and after it
                // then resolve against the cleared line (follower top =
                // float margin-box bottom + max(0, join(spacer bottom,
                // follower top) - spacer top), 32-case browser matrix),
                // so the fold must leave them in place for the layout
                // pass instead of hoisting them onto the container.
                if child_clear != Clear::None
                    && is_self_collapsing_empty(nodes, layout, child, &zero_padding)
                    && children
                        .iter()
                        .copied()
                        .take_while(|id| *id != child)
                        .any(|id| {
                            layout
                                .style(nodes[id.0 as usize].style)
                                .map(|sibling| sibling.float != Float::None)
                                .unwrap_or(false)
                        })
                {
                    break;
                }
                let Some(top) = resolved_px(child_margin_top) else {
                    break;
                };
                let empty = is_self_collapsing_empty(nodes, layout, child, &zero_padding);
                let bottom = if empty {
                    resolved_px(
                        layout
                            .style(nodes[child.0 as usize].style)
                            .map_err(|error| {
                                EpubError::new(format!("fold style resolves: {error}"))
                            })?
                            .margin
                            .bottom,
                    )
                } else {
                    None
                };
                accumulated = Some(join(accumulated.unwrap_or(0.0), top));
                set_margin(layout, nodes, child, Some(0.0), None)?;
                if !empty {
                    break;
                }
                let Some(bottom) = bottom else {
                    break;
                };
                accumulated = Some(join(accumulated.unwrap_or(0.0), bottom));
                set_margin(layout, nodes, child, None, Some(0.0))?;
            }
            if let (Some(escape), Some(own)) = (accumulated, own) {
                if escape != 0.0 {
                    set_margin(layout, nodes, node, Some(join(own, escape)), None)?;
                }
            }
        }
        let bottom_open = !is_root
            && zero_padding(style.padding.bottom)
            && style.height == PreferredSize::Auto
            && style.min_height == MinimumHeight::Auto;
        if bottom_open {
            let last = children
                .iter()
                .rev()
                .copied()
                .find(|id| in_flow(nodes, layout, *id));
            // A float AFTER the last in-flow child anchors at its
            // hypothetical flow position, which lies BELOW that child's
            // bottom margin (measured: a title page's hoisted author
            // block — content, a clearing spacer, then a float with a
            // large negative margin-top — sat one spacer margin high
            // when the fold hid the margin from the float's anchor).
            // The margin stays on the child then; the block engine's
            // pending-margin chain carries it to the float.
            let floats_after = last.is_some_and(|last| {
                children
                    .iter()
                    .copied()
                    .skip_while(|id| *id != last)
                    .skip(1)
                    .any(|id| !in_flow(nodes, layout, id))
            });
            if let (Some(last), false) = (last, floats_after) {
                let last_style = layout
                    .style(nodes[last.0 as usize].style)
                    .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?;
                let escape = resolved_px(last_style.margin.bottom);
                let own = layout
                    .style(nodes[node.0 as usize].style)
                    .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?
                    .margin
                    .bottom;
                let own = resolved_px(own);
                if let (Some(escape), Some(own)) = (escape, own) {
                    if escape != 0.0 {
                        set_margin(layout, nodes, last, None, Some(0.0))?;
                        set_margin(layout, nodes, node, None, Some(join(own, escape)))?;
                    }
                }
            }
        }
        if is_root {
            root_margins_to_padding(nodes, node, layout)?;
        }
        Ok(())
    }
    /// The chapter body's margins — its own plus what collapsed into it —
    /// become body padding: the browser offsets the whole flow by them
    /// (horizontally too), and padding carries identical geometry through
    /// this engine, applying on the first page only exactly like a margin
    /// at an unforced fragmentainer start.
    fn root_margins_to_padding(
        nodes: &mut [FormattingNode],
        root: FormattingNodeId,
        layout: &mut LayoutStyleTable,
    ) -> EpubResult<()> {
        let mut style = *layout
            .style(nodes[root.0 as usize].style)
            .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?;
        let mut changed = false;
        let zero = || {
            LengthPercentageOrAuto::Value(LengthPercentage::Length(
                rito_style_contract::CssPx::new(0.0).expect("zero is finite"),
            ))
        };
        // Margin and padding percentages share the inline-size basis in
        // CSS, so a percentage margin folds into a percentage padding
        // unchanged. Mixed length + percentage cannot sum statically and
        // stays unfolded.
        let mut absorb = |margin: &mut LengthPercentageOrAuto,
                          padding: &mut NonNegativeLengthPercentage|
         -> EpubResult<()> {
            let folded = match (*margin, padding.value()) {
                (LengthPercentageOrAuto::Auto, _) => None,
                (
                    LengthPercentageOrAuto::Value(LengthPercentage::Length(margin_px)),
                    LengthPercentage::Length(existing),
                ) => {
                    let px = f64::from(margin_px.get());
                    if px <= 0.0 {
                        None
                    } else {
                        Some(LengthPercentage::Length(
                            rito_style_contract::CssPx::new(
                                (f64::from(existing.get()) + px) as f32,
                            )
                            .map_err(|error| {
                                EpubError::new(format!("padding is finite: {error}"))
                            })?,
                        ))
                    }
                }
                // A zero-percentage padding (`padding: 0% 0`) is exactly
                // zero regardless of basis, so a length margin folds into
                // it as a plain length — dropping into the fallthrough
                // instead silently vanished a chapter's 22px heading
                // margin and shifted every page of the book.
                (
                    LengthPercentageOrAuto::Value(LengthPercentage::Length(margin_px)),
                    LengthPercentage::Percentage(existing),
                ) if existing.ratio() == 0.0 && margin_px.get() > 0.0 => {
                    Some(LengthPercentage::Length(margin_px))
                }
                (
                    LengthPercentageOrAuto::Value(LengthPercentage::Percentage(pct)),
                    existing_padding,
                ) if pct.ratio() > 0.0 => {
                    let existing_ratio = match existing_padding {
                        LengthPercentage::Length(existing) if existing.get() == 0.0 => 0.0,
                        LengthPercentage::Percentage(existing) => f64::from(existing.ratio()),
                        _ => return Ok(()),
                    };
                    Some(LengthPercentage::Percentage(
                        rito_style_contract::Percentage::from_ratio(
                            (existing_ratio + f64::from(pct.ratio())) as f32,
                        )
                        .map_err(|error| {
                            EpubError::new(format!("padding ratio is finite: {error}"))
                        })?,
                    ))
                }
                _ => None,
            };
            if let Some(next) = folded {
                *padding = NonNegativeLengthPercentage::new(next);
                changed = true;
            }
            // Only a margin the padding actually absorbed may be
            // cleared; an unfoldable one (mixed length + percentage)
            // stays a real margin for layout to apply at the flow start.
            let absorbed = folded.is_some()
                || matches!(*margin, LengthPercentageOrAuto::Value(LengthPercentage::Length(px)) if px.get() <= 0.0)
                || matches!(*margin, LengthPercentageOrAuto::Auto);
            if absorbed
                && !matches!(*margin, LengthPercentageOrAuto::Value(LengthPercentage::Length(px)) if px.get() == 0.0)
            {
                *margin = zero();
                changed = true;
            }
            Ok(())
        };
        let mut margin = style.margin;
        let mut padding = style.padding;
        absorb(&mut margin.top, &mut padding.top)?;
        absorb(&mut margin.bottom, &mut padding.bottom)?;
        absorb(&mut margin.left, &mut padding.left)?;
        absorb(&mut margin.right, &mut padding.right)?;
        if changed {
            style.margin = margin;
            style.padding = padding;
            nodes[root.0 as usize].style = layout
                .intern(style)
                .map_err(|error| EpubError::new(format!("folded style interns: {error}")))?;
        }
        Ok(())
    }
    fold(nodes, root, layout, true)
}
