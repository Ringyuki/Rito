mod types;
mod word_segmentation;

pub use types::{
    TextCaretAddress, TextCaretAffinity, TextCaretGeometry, TextInteractionUnavailableReason,
    TextSelectionBoundary, TextSelectionMovement,
};

pub(crate) use word_segmentation::{plain_word_boundaries, plain_word_bounds};
