//! Text selection and annotation targets over the reader session
//! protocol. Every answer comes from the same engine resolvers the web
//! reader calls, so a selection, a caret move or a stored highlight
//! behaves identically on every host.

use super::{ReaderExactSourceRect, ReaderSourcePoint, ReaderSourceRange, ReaderTextPosition};

/// A point on one of an artifact's pages, in its display-list space
/// (the space [`super::ReaderHitEntry::bounds`] uses).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReaderTextPoint {
    pub page_index: u32,
    pub x: f64,
    pub y: f64,
}

/// Which side of a line break a caret sits on when one text offset is
/// both a line's end and the next line's start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderCaretAffinity {
    Upstream,
    Downstream,
}

/// A caret between two shaped clusters. `page_index` and `position`
/// address the revision behind the artifact the caret came from, so a
/// caret is only meaningful to requests on artifacts of that revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderCaretAddress {
    pub page_index: u32,
    pub position: ReaderTextPosition,
    pub affinity: ReaderCaretAffinity,
}

/// A caret's line in display-list space: its top and its height.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReaderCaretGeometry {
    pub x: f64,
    pub y: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderCaret {
    pub address: ReaderCaretAddress,
    /// Present when the caret's page is one this artifact draws.
    pub geometry: Option<ReaderCaretGeometry>,
    /// Canonical manifest href and source point the caret sits at.
    pub href: String,
    pub source_point: ReaderSourcePoint,
}

/// A resolved text range. `start` and `end` are `anchor` and `focus` in
/// document order; `rects` cover only the pages this artifact draws.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderTextSelection {
    pub anchor: ReaderCaretAddress,
    pub focus: ReaderCaretAddress,
    pub start: ReaderCaretAddress,
    pub end: ReaderCaretAddress,
    pub selected_text: String,
    /// Durable source identity of the normalized endpoints; the two hrefs
    /// differ only for a range that crosses resources.
    pub source_start_href: String,
    pub source_start: ReaderSourcePoint,
    pub source_end_href: String,
    pub source_end: ReaderSourcePoint,
    pub rects: Vec<ReaderExactSourceRect>,
}

/// How far a range from two points extends past them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderSelectionGranularity {
    Word,
    Paragraph,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderSelectionMovement {
    CharacterLeft,
    CharacterRight,
    WordLeft,
    WordRight,
    WordStartRight,
    LineUp,
    LineDown,
    LineStart,
    LineEnd,
    PageUp,
    PageDown,
    ParagraphBackward,
    ParagraphForward,
    ParagraphPreviousStart,
    ParagraphNextStart,
    ChapterStart,
    ChapterEnd,
    DocumentStart,
    DocumentEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderSelectionBoundary {
    Start,
    End,
}

/// One text interaction against an artifact.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ReaderTextInteractionQuery {
    /// The caret nearest a point.
    Caret { point: ReaderTextPoint },
    /// The range between two carets, as when a handle is dropped.
    Range {
        anchor: ReaderCaretAddress,
        focus: ReaderCaretAddress,
    },
    /// The range from a kept caret to a point, as while a handle or a
    /// character-wise drag moves.
    RangeToPoint {
        anchor: ReaderCaretAddress,
        focus: ReaderTextPoint,
    },
    /// The range two points span, widened to whole words or paragraphs.
    RangeFromPoints {
        anchor: ReaderTextPoint,
        focus: ReaderTextPoint,
        granularity: ReaderSelectionGranularity,
    },
    /// The focus caret moved by a keyboard-style step. The preferred
    /// positions are the ones the previous movement returned, echoed back
    /// so vertical steps keep their column.
    Movement {
        anchor: ReaderCaretAddress,
        focus: ReaderCaretAddress,
        movement: ReaderSelectionMovement,
        preferred_inline_position: Option<f64>,
        preferred_block_position: Option<f64>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReaderTextInteractionRequest {
    pub session_id: u64,
    pub artifact_id: u64,
    pub query: ReaderTextInteractionQuery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderTextInteractionUnavailableReason {
    ShapeUnavailable,
    SourceUnavailable,
    UnsupportedTransform,
    VisualGeometryUnavailable,
    InvalidCaret,
    DifferentChapter,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ReaderTextInteractionResult {
    Caret(ReaderCaret),
    Selection(Box<ReaderSelectionResult>),
    /// The point is not over text.
    Miss,
    /// The movement leaves this revision through that boundary.
    Boundary(ReaderSelectionBoundary),
    /// The movement needs pages past that boundary that are not laid out yet.
    Pending(ReaderSelectionBoundary),
    Unavailable(ReaderTextInteractionUnavailableReason),
}

/// A resolved range. The carets are present for every query but `Range`,
/// and the preferred positions only for `Movement`.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderSelectionResult {
    pub anchor_caret: Option<ReaderCaret>,
    pub focus_caret: Option<ReaderCaret>,
    pub selection: ReaderTextSelection,
    pub preferred_inline_position: Option<f64>,
    pub preferred_block_position: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderTextInteractionResponse {
    pub artifact_id: u64,
    pub result: ReaderTextInteractionResult,
}

/// Builds or locates an annotation target. Targets depend only on the
/// publication source, so no artifact is involved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReaderAnnotationQuery {
    /// Builds the target for a source range, normally a selection's.
    Create {
        href: String,
        range: ReaderSourceRange,
    },
    /// Finds a stored target, given as the JSON the engine wrote.
    Resolve { target_json: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderAnnotationRequest {
    pub session_id: u64,
    pub query: ReaderAnnotationQuery,
}

/// Which level of the cascade located a target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderAnnotationLevel {
    /// A target `Create` built.
    Created,
    Exact,
    Quote,
    Position,
    Progression,
    /// The chapter is gone.
    OrphanedHrefNotFound,
    /// The chapter holds no text.
    OrphanedEmptyChapter,
}

/// An annotation target: `json` is the engine's canonical serialization,
/// which is what hosts persist, and the remaining fields are its contents
/// so a host never parses JSON itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderAnnotationTarget {
    pub json: String,
    pub href: String,
    pub range: ReaderSourceRange,
    pub exact: String,
    pub prefix: String,
    pub suffix: String,
    /// UTF-16 offsets into the chapter's canonical text.
    pub start: u64,
    pub end: u64,
    pub chapter_length: u64,
}

/// The target built, or the stored one re-anchored where it was found;
/// absent only for the orphaned levels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderAnnotationResponse {
    pub level: ReaderAnnotationLevel,
    pub target: Option<ReaderAnnotationTarget>,
}
