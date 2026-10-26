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
    /// A vertical-writing caret extends horizontally; horizontal-writing
    /// carets retain a zero width and the existing serialized shape.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub width: f64,
    pub height: f64,
}

fn is_zero(value: &f64) -> bool {
    *value == 0.0
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
