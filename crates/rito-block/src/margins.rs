//! Vertical margins: resolving a child's own top and bottom margins,
//! walking the first-descendant chain its top margin collapses through,
//! and the set of adjoining margins that collapses to one value — the
//! largest positive plus the most negative.

use crate::*;

/// Resolved vertical margins of one in-flow child, in CSS px.
///
/// Percentages resolve against the containing block's inline size (CSS
/// resolves the vertical sides against the *inline* axis) and `auto`
/// resolves to zero in block flow.
pub(crate) fn vertical_margins(
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

/// The adjoining top-margin SET of an in-flow child: its own top margin
/// joined with its first-in-flow-descendant chain wherever CSS 2 §8.3.1
/// collapses them through — no top padding on the box, and no new
/// formatting context. The bridge folds every statically-resolvable case
/// of this cascade before layout and zeroes the absorbed children, so the
/// chain normally contributes nothing extra; a percentage margin has no
/// basis until now, and whatever the fold left behind joins here
/// (measured on b59 contents2: `div { margin-top: 2%; }` around a
/// UA-margined `<h4>` — Blink absorbs the resolved 2% into the larger
/// heading margin via the set max; stacking them sat the block 13px low).
pub(crate) fn through_collapsed_top(
    tree: &FormattingTree,
    child: FormattingNodeId,
    containing_width: f64,
) -> Result<PendingMargin, LayoutError> {
    let styles = tree.styles().ok_or_else(|| {
        LayoutError::Invalid("block layout requires the tree to carry style tables".to_owned())
    })?;
    let style_of = |id: FormattingNodeId| -> Result<&LayoutFormattingStyle, LayoutError> {
        styles
            .layout
            .style(tree.node(id).style)
            .map_err(|error| LayoutError::Invalid(error.to_string()))
    };
    let mut set = PendingMargin::ZERO;
    let mut node = child;
    let mut width = containing_width;
    loop {
        let style = style_of(node)?;
        set = set.join(resolve_margin(style.margin.top, width));
        if !matches!(
            tree.node(node).content,
            FormattingNodeContent::BlockContainer
        ) || is_flow_root(style)
        {
            break;
        }
        let Ok(hbox) = resolve_horizontal_box(style, width) else {
            break;
        };
        if hbox.padding_top != 0.0 {
            break;
        }
        let mut first = None;
        let mut float_precedes = false;
        for id in &tree.node(node).children {
            if style_of(*id)?.float == Float::None {
                first = Some(*id);
                break;
            }
            float_precedes = true;
        }
        // A clearing child behind float siblings takes clearance; its
        // margin chain resolves against the cleared line and never
        // reaches the container position (the container top is constant
        // across every spacer/follower margin in the measured matrix).
        if float_precedes
            && first
                .map(|id| style_of(id).map(|style| style.clear != Clear::None))
                .transpose()?
                .unwrap_or(false)
        {
            break;
        }
        let Some(first) = first else {
            break;
        };
        width = hbox.content_width;
        node = first;
    }
    Ok(set)
}

fn resolve_margin(value: LengthPercentageOrAuto, inline_size: f64) -> f64 {
    match value {
        LengthPercentageOrAuto::Auto => 0.0,
        // The browser converts a computed margin to LayoutUnit by
        // TRUNCATION toward zero (LayoutUnit's float constructor), unlike
        // line heights which round: a 0.2em margin at 16px (3.2 as f32,
        // 3.2000000476… as f64) lands on 3.1875, and rounding it instead
        // drifted a message page one 1/64 px per paragraph until a line
        // crossed a device row (measured: truth paragraph gap 3.1875,
        // engine 3.203125, delta ×13 paragraphs ≈ 1px).
        LengthPercentageOrAuto::Value(value) => {
            (resolve_length_percentage(value, inline_size) * 64.0).trunc() / 64.0
        }
    }
}

impl PendingMargin {
    pub(crate) const ZERO: Self = Self {
        positive: 0.0,
        negative: 0.0,
    };

    pub(crate) fn from_margin(margin: f64) -> Self {
        Self {
            positive: margin.max(0.0),
            negative: margin.min(0.0),
        }
    }

    /// Adds one adjoining margin to the set.
    pub(crate) fn join(self, margin: f64) -> Self {
        Self {
            positive: self.positive.max(margin.max(0.0)),
            negative: self.negative.min(margin.min(0.0)),
        }
    }

    /// Unions two adjoining sets: still one max of positives and one min
    /// of negatives (CSS 2 §8.3.1 treats every member alike).
    pub(crate) fn merge(self, other: Self) -> Self {
        Self {
            positive: self.positive.max(other.positive),
            negative: self.negative.min(other.negative),
        }
    }

    /// The set's collapsed value.
    pub(crate) fn resolve(self) -> f64 {
        self.positive + self.negative
    }
}
