use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextCaretAffinity {
    Upstream,
    Downstream,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextSelectionMovement {
    CharacterLeft,
    CharacterRight,
    WordLeft,
    WordRight,
    WordStartRight,
    LineUp,
    LineDown,
    LineStart,
    LineEnd,
    ParagraphBackward,
    ParagraphForward,
    ParagraphPreviousStart,
    ParagraphNextStart,
    ChapterStart,
    ChapterEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextSelectionBoundary {
    Start,
    End,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextCaretAddress {
    pub page_index: usize,
    pub block_index: usize,
    pub line_index: usize,
    pub run_index: usize,
    /// Run-local UTF-16 offset at an authoritative shaped cluster edge.
    pub char_index: usize,
    pub affinity: TextCaretAffinity,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextCaretGeometry {
    pub x: f64,
    pub y: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ExactTextRangeRect {
    pub(crate) page_index: usize,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) block_index: usize,
    pub(crate) line_index: usize,
    pub(crate) run_index: usize,
    pub(crate) start_char_index: usize,
    pub(crate) end_char_index: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextInteractionUnavailableReason {
    ShapeUnavailable,
    SourceUnavailable,
    UnsupportedTransform,
    VisualGeometryUnavailable,
    InvalidCaret,
    DifferentChapter,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LayoutSourcePoint {
    pub(crate) node_path: Vec<usize>,
    pub(crate) text_offset: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LayoutTextCaret {
    pub(crate) address: TextCaretAddress,
    pub(crate) geometry: TextCaretGeometry,
    pub(crate) source_point: LayoutSourcePoint,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LayoutTextCaretResolution {
    Resolved(LayoutTextCaret),
    Unavailable(TextInteractionUnavailableReason),
    Miss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LayoutTextSelectionGranularity {
    Word,
    Paragraph,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LayoutTextPoint {
    pub(crate) page_index: usize,
    pub(crate) x: f64,
    pub(crate) y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LayoutTextPageRange {
    pub(crate) first_page: usize,
    pub(crate) last_page: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LayoutTextRangeFromPoints {
    pub(crate) anchor_caret: LayoutTextCaret,
    pub(crate) focus_caret: LayoutTextCaret,
    pub(crate) range: Box<LayoutExactTextRange>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LayoutTextRangeFromPointsResolution {
    Resolved(Box<LayoutTextRangeFromPoints>),
    Unavailable(TextInteractionUnavailableReason),
    Miss,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LayoutExactTextRange {
    pub(crate) anchor: TextCaretAddress,
    pub(crate) focus: TextCaretAddress,
    pub(crate) start: TextCaretAddress,
    pub(crate) end: TextCaretAddress,
    pub(crate) selected_text: String,
    pub(crate) exact_source_segments: Vec<String>,
    pub(crate) source_start: LayoutSourcePoint,
    pub(crate) source_end: LayoutSourcePoint,
    pub(crate) rects: Vec<ExactTextRangeRect>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LayoutExactTextRangeResolution {
    Resolved(Box<LayoutExactTextRange>),
    Unavailable(TextInteractionUnavailableReason),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LayoutTextSelectionMovement {
    pub(crate) anchor_caret: LayoutTextCaret,
    pub(crate) focus_caret: LayoutTextCaret,
    pub(crate) range: Box<LayoutExactTextRange>,
    pub(crate) preferred_inline_position: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LayoutTextSelectionMovementResolution {
    Resolved(Box<LayoutTextSelectionMovement>),
    Boundary(TextSelectionBoundary),
    Unavailable(TextInteractionUnavailableReason),
}
