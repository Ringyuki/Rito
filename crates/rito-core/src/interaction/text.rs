mod caret;
mod collect;
mod granularity;
mod movement;
mod paragraph_selection;
mod range;
mod range_to_point;
mod selection;
mod source_range;
mod types;
mod word_segmentation;

pub use types::{
    TextCaretAddress, TextCaretAffinity, TextCaretGeometry, TextInteractionUnavailableReason,
    TextSelectionBoundary, TextSelectionMovement,
};

pub(crate) use caret::resolve_text_caret;
pub(crate) use granularity::resolve_text_range_from_points;
pub(crate) use movement::{resolve_text_selection_movement, LayoutTextSelectionMovementInput};
pub(crate) use range::resolve_text_range;
pub(crate) use range_to_point::resolve_text_range_to_point;
pub(crate) use source_range::resolve_exact_source_range;
pub(crate) use types::{
    ExactTextRangeRect, LayoutExactTextRange, LayoutExactTextRangeResolution, LayoutSourcePoint,
    LayoutTextCaret, LayoutTextCaretResolution, LayoutTextPageRange, LayoutTextPageTarget,
    LayoutTextPoint, LayoutTextRangeFromPoints, LayoutTextRangeFromPointsResolution,
    LayoutTextSelectionGranularity, LayoutTextSelectionMovement,
    LayoutTextSelectionMovementResolution, LayoutTextSelectionMovementTarget,
};

#[cfg(test)]
mod granularity_tests;
#[cfg(test)]
mod movement_tests;
#[cfg(test)]
mod tests;
