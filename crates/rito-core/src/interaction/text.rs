mod caret;
mod collect;
mod range;
mod selection;
mod source_range;
mod types;

pub use types::{
    TextCaretAddress, TextCaretAffinity, TextCaretGeometry, TextInteractionUnavailableReason,
};

pub(crate) use caret::resolve_text_caret;
pub(crate) use range::resolve_text_range;
pub(crate) use source_range::resolve_exact_source_range;
pub(crate) use types::{
    ExactTextRangeRect, LayoutExactTextRange, LayoutExactTextRangeResolution, LayoutSourcePoint,
    LayoutTextCaret, LayoutTextCaretResolution,
};

#[cfg(test)]
mod tests;
