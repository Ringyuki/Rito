//! Wire forms of text interactions (`RITOTIQ1`/`RITOTIR1`) and annotation
//! targets (`RITOANQ1`/`RITOANR1`). Every enum crosses as a `u8` tag in
//! declaration order; the tables below are the contract both directions
//! share.

mod decode;
mod encode;

pub(super) use decode::{
    annotation_request, annotation_response, navigation_request, navigation_result,
    text_interaction_request, text_interaction_response,
};
pub(super) use encode::{
    annotation_request as encode_annotation_request,
    annotation_response as encode_annotation_response,
    navigation_request as encode_navigation_request, navigation_result as encode_navigation_result,
    text_interaction_request as encode_text_interaction_request,
    text_interaction_response as encode_text_interaction_response,
};

use super::primitives::invalid;
use crate::runtime::reader_session::{
    ReaderAnnotationLevel, ReaderCaretAffinity, ReaderError, ReaderLocatorMatch,
    ReaderSelectionBoundary, ReaderSelectionGranularity, ReaderSelectionMovement,
    ReaderTextInteractionUnavailableReason,
};

const MOVEMENTS: [ReaderSelectionMovement; 19] = [
    ReaderSelectionMovement::CharacterLeft,
    ReaderSelectionMovement::CharacterRight,
    ReaderSelectionMovement::WordLeft,
    ReaderSelectionMovement::WordRight,
    ReaderSelectionMovement::WordStartRight,
    ReaderSelectionMovement::LineUp,
    ReaderSelectionMovement::LineDown,
    ReaderSelectionMovement::LineStart,
    ReaderSelectionMovement::LineEnd,
    ReaderSelectionMovement::PageUp,
    ReaderSelectionMovement::PageDown,
    ReaderSelectionMovement::ParagraphBackward,
    ReaderSelectionMovement::ParagraphForward,
    ReaderSelectionMovement::ParagraphPreviousStart,
    ReaderSelectionMovement::ParagraphNextStart,
    ReaderSelectionMovement::ChapterStart,
    ReaderSelectionMovement::ChapterEnd,
    ReaderSelectionMovement::DocumentStart,
    ReaderSelectionMovement::DocumentEnd,
];

const UNAVAILABLE_REASONS: [ReaderTextInteractionUnavailableReason; 6] = [
    ReaderTextInteractionUnavailableReason::ShapeUnavailable,
    ReaderTextInteractionUnavailableReason::SourceUnavailable,
    ReaderTextInteractionUnavailableReason::UnsupportedTransform,
    ReaderTextInteractionUnavailableReason::VisualGeometryUnavailable,
    ReaderTextInteractionUnavailableReason::InvalidCaret,
    ReaderTextInteractionUnavailableReason::DifferentChapter,
];

const ANNOTATION_LEVELS: [ReaderAnnotationLevel; 7] = [
    ReaderAnnotationLevel::Created,
    ReaderAnnotationLevel::Exact,
    ReaderAnnotationLevel::Quote,
    ReaderAnnotationLevel::Position,
    ReaderAnnotationLevel::Progression,
    ReaderAnnotationLevel::OrphanedHrefNotFound,
    ReaderAnnotationLevel::OrphanedEmptyChapter,
];

const LOCATOR_MATCHES: [ReaderLocatorMatch; 5] = [
    ReaderLocatorMatch::SourceRange,
    ReaderLocatorMatch::SourcePoint,
    ReaderLocatorMatch::Anchor,
    ReaderLocatorMatch::Progression,
    ReaderLocatorMatch::Href,
];
const ORDERINGS: [std::cmp::Ordering; 3] = [
    std::cmp::Ordering::Less,
    std::cmp::Ordering::Equal,
    std::cmp::Ordering::Greater,
];

const AFFINITIES: [ReaderCaretAffinity; 2] = [
    ReaderCaretAffinity::Upstream,
    ReaderCaretAffinity::Downstream,
];
const GRANULARITIES: [ReaderSelectionGranularity; 2] = [
    ReaderSelectionGranularity::Word,
    ReaderSelectionGranularity::Paragraph,
];
const BOUNDARIES: [ReaderSelectionBoundary; 2] =
    [ReaderSelectionBoundary::Start, ReaderSelectionBoundary::End];

fn tag_of<T: PartialEq>(table: &[T], value: &T) -> u8 {
    let index = table
        .iter()
        .position(|candidate| candidate == value)
        .expect("every variant is in its tag table");
    u8::try_from(index).expect("tag tables are short")
}

fn from_tag<T: Copy>(table: &[T], tag: u8, field: &str) -> Result<T, ReaderError> {
    table
        .get(usize::from(tag))
        .copied()
        .ok_or_else(|| invalid(format!("unknown {field} tag: {tag}")))
}
