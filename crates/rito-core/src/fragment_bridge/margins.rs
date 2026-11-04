//! Static parent-child margin collapsing. Margins that CSS lets escape
//! through an undecorated container are folded onto that container
//! bottom-up (padding, overflow, height, flow roots, leading or trailing
//! floats and clearing spacers stop the escape), and the chapter body's
//! own margins become body padding so the flow offsets on the first page.
//!
//! Margins collapse along the block axis: "top" and "bottom" here are the
//! block-start and block-end edges of the container's flow, the right and
//! left sides of a vertical-rl one. A box whose writing mode differs from
//! its parent's starts a formatting context of its own, which no margin
//! escapes.

use rito_fragment::{FormattingNode, FormattingNodeContent, FormattingNodeId};
use rito_style_contract::{
    Clear, Float, LayoutFormattingStyle, LayoutStyleTable, LengthPercentage,
    LengthPercentageOrAuto, MinimumSize, NonNegativeLengthPercentage, Overflow, PreferredSize,
    WritingDirection, WritingMode,
};

use crate::epub::{EpubError, EpubResult};

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
) -> EpubResult<f64> {
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
    /// The block-start and block-end margins of a box in a flow laid out
    /// in `writing`.
    fn block_margins(
        style: &LayoutFormattingStyle,
        writing: WritingDirection,
    ) -> (LengthPercentageOrAuto, LengthPercentageOrAuto) {
        let margin = style.margin_in(writing);
        (margin.block_start, margin.block_end)
    }
    /// Sets the block-start (`top`) and block-end (`bottom`) margins of a
    /// box in a flow laid out in `writing`.
    fn set_margin(
        layout: &mut LayoutStyleTable,
        nodes: &mut [FormattingNode],
        node: FormattingNodeId,
        writing: WritingDirection,
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
        let mut margin = style.margin_in(writing);
        if let Some(px) = top {
            margin.block_start = as_length(px)?;
        }
        if let Some(px) = bottom {
            margin.block_end = as_length(px)?;
        }
        style.margin = margin.to_physical(writing);
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
        parent_mode: WritingMode,
        sets: &mut FoldedSets,
    ) -> EpubResult<()> {
        let style = *layout
            .style(nodes[node.0 as usize].style)
            .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?;
        let children = nodes[node.0 as usize].children.clone();
        for child in &children {
            if matches!(
                nodes[child.0 as usize].content,
                FormattingNodeContent::BlockContainer
            ) {
                fold(nodes, *child, layout, false, style.writing_mode, sets)?;
            }
        }
        if children.is_empty() {
            return Ok(());
        }
        // The box's flow: its children's margins and its own lie on the
        // block edges of these lines (a box laid out in another writing
        // mode than its parent's contains its children's margins below).
        let writing = style.writing_direction();
        if style.overflow != Overflow::Visible || style.writing_mode != parent_mode {
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
                .map(|child| {
                    child.float == Float::None
                        && child.position != rito_style_contract::Position::Absolute
                })
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
        if zero_padding(style.flow_padding().block_start) && !float_leads {
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
                // Absolutely positioned children are out of flow: a block
                // holding only those is still empty.
                let holds_in_flow = node.children.iter().any(|child| {
                    layout
                        .style(nodes[child.0 as usize].style)
                        .map(|style| style.position != rito_style_contract::Position::Absolute)
                        .unwrap_or(true)
                });
                if !matches!(node.content, FormattingNodeContent::BlockContainer) || holds_in_flow {
                    return false;
                }
                layout
                    .style(node.style)
                    .map(|style| {
                        zero_padding(style.flow_padding().block_start)
                            && zero_padding(style.flow_padding().block_end)
                            && style.block_size() == PreferredSize::Auto
                            && style.min_block_size() == MinimumSize::Auto
                    })
                    .unwrap_or(false)
            }
            let mut accumulated: Option<MarginSet> = None;
            // The container's own margin must be resolvable before any
            // child margin is zeroed: an unresolvable own margin used to
            // abort AFTER the children were stripped, dropping their
            // margins on the floor instead of leaving them in place.
            let own = resolved_px(block_margins(&style, writing).0);
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
                let child_margin_top = block_margins(child_style, writing).0;
                // A clearing spacer with float siblings before it takes
                // clearance at layout time; the margins at and after it
                // then resolve against the cleared line (follower top =
                // float margin-box bottom + max(0, join(spacer bottom,
                // follower top) - spacer top), 32-case browser matrix),
                // so the fold must leave them in place for the layout
                // pass instead of hoisting them onto the container. A
                // block with content that clears a float before it stops
                // the escape too: the container settles its block offset
                // above that block's margins (Blink's
                // `HasClearancePastAdjoiningFloats`), which then act only
                // inside the clearance, leaving the floats at the top.
                let floats_before: Vec<Float> = children
                    .iter()
                    .copied()
                    .take_while(|id| *id != child)
                    .filter_map(|id| {
                        layout
                            .style(nodes[id.0 as usize].style)
                            .ok()
                            .map(|sibling| sibling.float)
                            .filter(|float| *float != Float::None)
                    })
                    .collect();
                let clears_a_float_before = floats_before.iter().any(|float| {
                    matches!(
                        (child_clear, float),
                        (Clear::Both, _)
                            | (Clear::Left, Float::Left)
                            | (Clear::Right, Float::Right)
                    )
                });
                if child_clear != Clear::None
                    && !floats_before.is_empty()
                    && (clears_a_float_before
                        || is_self_collapsing_empty(nodes, layout, child, &zero_padding))
                {
                    break;
                }
                let Some(top) = resolved_px(child_margin_top) else {
                    break;
                };
                let empty = is_self_collapsing_empty(nodes, layout, child, &zero_padding);
                let bottom = if empty {
                    resolved_px(
                        block_margins(
                            layout
                                .style(nodes[child.0 as usize].style)
                                .map_err(|error| {
                                    EpubError::new(format!("fold style resolves: {error}"))
                                })?,
                            writing,
                        )
                        .1,
                    )
                } else {
                    None
                };
                let top = sets.top.remove(&child).unwrap_or(MarginSet::of(top));
                accumulated = Some(accumulated.unwrap_or_default().join(top));
                set_margin(layout, nodes, child, writing, Some(0.0), None)?;
                if !empty {
                    break;
                }
                let Some(bottom) = bottom else {
                    break;
                };
                let bottom = sets.bottom.remove(&child).unwrap_or(MarginSet::of(bottom));
                accumulated = Some(accumulated.unwrap_or_default().join(bottom));
                set_margin(layout, nodes, child, writing, None, Some(0.0))?;
            }
            if let (Some(escape), Some(own)) = (accumulated, own) {
                if !escape.is_zero() {
                    let set = MarginSet::of(own).join(escape);
                    set_margin(layout, nodes, node, writing, Some(set.value()), None)?;
                    sets.top.insert(node, set);
                }
            }
        }
        let bottom_open = !is_root
            && zero_padding(style.flow_padding().block_end)
            && style.block_size() == PreferredSize::Auto
            && style.min_block_size() == MinimumSize::Auto;
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
                let escape = resolved_px(block_margins(last_style, writing).1);
                let own = block_margins(
                    layout
                        .style(nodes[node.0 as usize].style)
                        .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?,
                    writing,
                )
                .1;
                let own = resolved_px(own);
                if let (Some(escape), Some(own)) = (escape, own) {
                    let escape = sets
                        .bottom
                        .get(&last)
                        .copied()
                        .unwrap_or(MarginSet::of(escape));
                    if !escape.is_zero() {
                        sets.bottom.remove(&last);
                        let set = MarginSet::of(own).join(escape);
                        set_margin(layout, nodes, last, writing, None, Some(0.0))?;
                        set_margin(layout, nodes, node, writing, None, Some(set.value()))?;
                        sets.bottom.insert(node, set);
                    }
                }
            }
        }
        Ok(())
    }
    /// The chapter body's margins — its own plus what collapsed into it —
    /// become body padding: the browser offsets the whole flow by them
    /// (horizontally too), and padding carries identical geometry through
    /// this engine, applying on the first page only exactly like a margin
    /// at an unforced fragmentainer start. Returns the top margin that
    /// became padding with no padding of its own before it: the collapsed
    /// margin above the body's first in-flow child.
    fn root_margins_to_padding(
        nodes: &mut [FormattingNode],
        root: FormattingNodeId,
        layout: &mut LayoutStyleTable,
    ) -> EpubResult<f64> {
        let mut style = *layout
            .style(nodes[root.0 as usize].style)
            .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?;
        let writing = style.writing_direction();
        let leading = match (
            block_margins(&style, writing).0,
            style.flow_padding().block_start.value(),
        ) {
            (
                LengthPercentageOrAuto::Value(LengthPercentage::Length(margin)),
                LengthPercentage::Length(padding),
            ) if padding.get() == 0.0 => f64::from(margin.get()).max(0.0),
            (
                LengthPercentageOrAuto::Value(LengthPercentage::Length(margin)),
                LengthPercentage::Percentage(padding),
            ) if padding.ratio() == 0.0 => f64::from(margin.get()).max(0.0),
            _ => 0.0,
        };
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
        Ok(leading)
    }
    let root_mode = layout
        .style(nodes[root.0 as usize].style)
        .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?
        .writing_mode;
    fold(
        nodes,
        root,
        layout,
        true,
        root_mode,
        &mut FoldedSets::default(),
    )?;
    root_margins_to_padding(nodes, root, layout)
}

/// An adjoining margin set (CSS 2 §8.3.1): its largest positive margin and
/// its most negative one, which collapse to their sum. Kept apart while
/// the fold lifts margins up several wrappers, so a negative margin deep
/// in the chain still cancels against the largest positive at any level
/// instead of being summed away at the first join.
#[derive(Clone, Copy, Debug, Default)]
struct MarginSet {
    positive: f64,
    negative: f64,
}

impl MarginSet {
    fn of(margin: f64) -> Self {
        Self {
            positive: margin.max(0.0),
            negative: margin.min(0.0),
        }
    }

    fn join(self, other: Self) -> Self {
        Self {
            positive: self.positive.max(other.positive),
            negative: self.negative.min(other.negative),
        }
    }

    fn value(self) -> f64 {
        self.positive + self.negative
    }

    fn is_zero(self) -> bool {
        self.positive == 0.0 && self.negative == 0.0
    }
}

/// The margin sets the fold has lifted onto a box's block-start and
/// block-end edges, which the box's own parent joins in turn.
#[derive(Default)]
struct FoldedSets {
    top: std::collections::HashMap<FormattingNodeId, MarginSet>,
    bottom: std::collections::HashMap<FormattingNodeId, MarginSet>,
}
