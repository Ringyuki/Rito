use crate::{BorderEdges, LengthPercentage, LengthPercentageOrAuto, NonNegativeLengthPercentage};

/// Four physical sides in top-right-bottom-left order.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct PhysicalSides<T> {
    /// Top side.
    pub top: T,
    /// Right side.
    pub right: T,
    /// Bottom side.
    pub bottom: T,
    /// Left side.
    pub left: T,
}

/// Elliptical radius for one border corner.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct CornerRadius {
    /// Horizontal radius; percentages use the border box width.
    pub horizontal: NonNegativeLengthPercentage,
    /// Vertical radius; percentages use the border box height.
    pub vertical: NonNegativeLengthPercentage,
}

/// Four physical border-corner radii.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct BorderRadii {
    /// Top-left corner.
    pub top_left: CornerRadius,
    /// Top-right corner.
    pub top_right: CornerRadius,
    /// Bottom-right corner.
    pub bottom_right: CornerRadius,
    /// Bottom-left corner.
    pub bottom_left: CornerRadius,
}

/// Computed `alignment-baseline` longhand.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum AlignmentBaseline {
    /// Use the dominant baseline choice of the parent.
    Baseline,
    /// Use the text-under baseline.
    TextBottom,
    /// Use the alphabetic baseline.
    Alphabetic,
    /// Use the ideographic-under baseline.
    Ideographic,
    /// Use the x-middle baseline.
    Middle,
    /// Use the central baseline.
    Central,
    /// Use the mathematical baseline.
    Mathematical,
    /// Use the hanging baseline.
    Hanging,
    /// Use the text-over baseline.
    TextTop,
}

/// Computed `baseline-source` longhand.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BaselineSource {
    /// Use the layout-dependent initial baseline source.
    Auto,
    /// Use the first baseline set.
    First,
    /// Use the last baseline set.
    Last,
}

/// Computed `baseline-shift` longhand.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BaselineShift {
    /// Use the parent's subscript offset.
    Sub,
    /// Use the parent's superscript offset.
    Super,
    /// Align with the line-over edge.
    Top,
    /// Align centers in the block axis.
    Center,
    /// Align with the line-under edge.
    Bottom,
    /// Apply the shift; percentages use this element's line height.
    Offset(LengthPercentage),
}

/// Inline fragment geometry retained before basis and writing-mode resolution.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct InlineFragmentStyleV1 {
    /// Physical margins; percentages use the containing block's inline basis.
    pub margin: PhysicalSides<LengthPercentageOrAuto>,
    /// Physical padding with non-negative range constraints retained.
    pub padding: PhysicalSides<NonNegativeLengthPercentage>,
    /// Physical resolved border width, computed style, and computed color.
    pub border: BorderEdges,
    /// Physical elliptical border radii.
    pub border_radii: BorderRadii,
    /// Baseline chosen for alignment.
    pub alignment_baseline: AlignmentBaseline,
    /// First/last baseline source policy.
    pub baseline_source: BaselineSource,
    /// Baseline shift retained independently from baseline choice.
    pub baseline_shift: BaselineShift,
}
