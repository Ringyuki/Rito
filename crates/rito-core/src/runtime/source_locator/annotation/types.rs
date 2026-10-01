use serde::{Deserialize, Serialize};

use super::super::RuntimeSourceRange;

/// The one annotation target format every host persists. Bumped whenever a
/// field's meaning changes; a target of any other version is rejected.
pub const ANNOTATION_TARGET_VERSION: u32 = 1;

/// A durable highlight anchor, built and read only by the engine so every
/// host writes and resolves the same bytes.
///
/// All offsets are UTF-16 code units. `position` counts into the chapter's
/// canonical text: the concatenated text of the raw parsed XHTML tree, with
/// no revision or footnote filtering, so it never depends on layout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationTarget {
    pub version: u32,
    /// Canonical manifest href of the chapter.
    pub href: String,
    /// The authoritative selector: where the highlight sits in the source tree.
    pub source_range: RuntimeSourceRange,
    /// The highlighted text and up to 32 units of context on each side,
    /// never splitting a surrogate pair.
    pub quote: AnnotationQuote,
    /// The highlight's offsets in the canonical text, with that text's length
    /// at creation so a proportional position survives edits.
    pub position: AnnotationPosition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationQuote {
    pub exact: String,
    pub prefix: String,
    pub suffix: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationPosition {
    pub start: usize,
    pub end: usize,
    pub chapter_length: usize,
}

/// Which selector located a target in the chapter as it is now. Every level
/// but `orphaned` carries the target re-anchored at that location, ready to
/// project and to persist in place of the stored one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "level",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AnnotationTargetResolution {
    /// The source range still maps and still covers the quoted text.
    Exact { target: AnnotationTarget },
    /// The quoted text was found elsewhere in the chapter.
    Quote { target: AnnotationTarget },
    /// Neither matched; the stored offsets still fit the chapter.
    Position { target: AnnotationTarget },
    /// Only the proportional position survived: one character there.
    Progression { target: AnnotationTarget },
    /// The chapter is gone or holds no text.
    Orphaned { reason: AnnotationOrphanReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnnotationOrphanReason {
    HrefNotFound,
    EmptyChapter,
}
