mod types;
mod word_segmentation;

pub use types::{
    TextCaretAddress, TextCaretAffinity, TextCaretGeometry, TextInteractionUnavailableReason,
    TextSelectionBoundary, TextSelectionMovement,
};

pub(crate) use word_segmentation::{plain_word_around, plain_word_boundaries, WordSide};
