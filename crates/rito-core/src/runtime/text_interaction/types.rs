use serde::{Deserialize, Serialize};

use crate::interaction::{
    TextCaretAddress, TextCaretGeometry, TextInteractionUnavailableReason, TextSelectionBoundary,
    TextSelectionMovement,
};

use super::super::{
    RuntimeSourceLocator, RuntimeSourceLocatorPendingReason, RuntimeSourcePoint, RuntimeSourceRange,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExactSourceRangeRequest {
    pub href: String,
    pub source_range: RuntimeSourceRange,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExactSourceRangeResponse {
    pub revision_id: String,
    pub resolution: RuntimeExactSourceRangeResolution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeExactSourceRangeResolution {
    Resolved {
        range: Box<RuntimeExactSourceRange>,
    },
    Pending {
        reason: RuntimeSourceLocatorPendingReason,
    },
    Unavailable {
        reason: TextInteractionUnavailableReason,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExactSourceRange {
    pub selected_text: String,
    pub source_locator: RuntimeSourceLocator,
    pub rects: Vec<RuntimeExactTextRangeRect>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextPointRequest {
    pub page_index: usize,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeTextSelectionGranularity {
    Word,
    Paragraph,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextRangeFromPointsRequest {
    pub anchor: RuntimeTextPointRequest,
    pub focus: RuntimeTextPointRequest,
    pub granularity: RuntimeTextSelectionGranularity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextRangeFromPointsResponse {
    pub revision_id: String,
    pub resolution: RuntimeTextRangeFromPointsResolution,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextRangeToPointRequest {
    pub anchor: TextCaretAddress,
    pub focus: RuntimeTextPointRequest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextRangeToPointResponse {
    pub revision_id: String,
    pub resolution: RuntimeTextRangeFromPointsResolution,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextSelectionMovementRequest {
    pub anchor: TextCaretAddress,
    pub focus: TextCaretAddress,
    pub movement: TextSelectionMovement,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_inline_position: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_block_position: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextSelectionMovementResponse {
    pub revision_id: String,
    pub resolution: RuntimeTextSelectionMovementResolution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeTextSelectionMovementResolution {
    Resolved {
        anchor_caret: Box<RuntimeTextCaret>,
        focus_caret: Box<RuntimeTextCaret>,
        range: Box<RuntimeTextRange>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        preferred_inline_position: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        preferred_block_position: Option<f64>,
    },
    Boundary {
        boundary: TextSelectionBoundary,
    },
    Pending {
        boundary: TextSelectionBoundary,
    },
    Unavailable {
        reason: TextInteractionUnavailableReason,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeTextRangeFromPointsResolution {
    Resolved {
        anchor_caret: Box<RuntimeTextCaret>,
        focus_caret: Box<RuntimeTextCaret>,
        range: Box<RuntimeTextRange>,
    },
    Unavailable {
        reason: TextInteractionUnavailableReason,
    },
    Miss,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextCaretResponse {
    pub revision_id: String,
    pub page_index: usize,
    pub spread_index: usize,
    pub resolution: RuntimeTextCaretResolution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeTextCaretResolution {
    Resolved {
        caret: Box<RuntimeTextCaret>,
    },
    Unavailable {
        reason: TextInteractionUnavailableReason,
    },
    Miss,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextCaret {
    pub address: TextCaretAddress,
    pub geometry: TextCaretGeometry,
    pub source_locator: RuntimeSourceLocator,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextRangeRequest {
    pub anchor: TextCaretAddress,
    pub focus: TextCaretAddress,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextRangeResponse {
    pub revision_id: String,
    pub resolution: RuntimeTextRangeResolution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeTextRangeResolution {
    Resolved {
        range: Box<RuntimeTextRange>,
    },
    Unavailable {
        reason: TextInteractionUnavailableReason,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextRange {
    pub anchor: TextCaretAddress,
    pub focus: TextCaretAddress,
    pub start: TextCaretAddress,
    pub end: TextCaretAddress,
    pub selected_text: String,
    /// Durable source identity for both normalized range endpoints. Each
    /// endpoint is resource-qualified so the span can cross spine resources.
    pub source_span: RuntimeTextSourceSpan,
    /// Backward-compatible single-resource locator. Cross-resource ranges use
    /// `source_span` and omit this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_locator: Option<RuntimeSourceLocator>,
    pub rects: Vec<RuntimeExactTextRangeRect>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextSourceSpan {
    pub start: RuntimeTextSourceSpanEndpoint,
    /// End-exclusive source boundary.
    pub end: RuntimeTextSourceSpanEndpoint,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextSourceSpanEndpoint {
    /// Canonical manifest href containing `source_point`.
    pub href: String,
    pub source_point: RuntimeSourcePoint,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExactTextRangeRect {
    pub page_index: usize,
    pub spread_index: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub block_index: usize,
    pub line_index: usize,
    pub run_index: usize,
    pub start_char_index: usize,
    pub end_char_index: usize,
}
