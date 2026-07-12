use serde::{Deserialize, Serialize};

use crate::interaction::{TextCaretAddress, TextCaretGeometry, TextInteractionUnavailableReason};

use super::super::{RuntimeSourceLocator, RuntimeSourceLocatorPendingReason, RuntimeSourceRange};

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
pub struct RuntimeSameFlowTextRangeRequest {
    pub anchor: TextCaretAddress,
    pub focus: TextCaretAddress,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSameFlowTextRangeResponse {
    pub revision_id: String,
    pub resolution: RuntimeSameFlowTextRangeResolution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeSameFlowTextRangeResolution {
    Resolved {
        range: Box<RuntimeSameFlowTextRange>,
    },
    Unavailable {
        reason: TextInteractionUnavailableReason,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSameFlowTextRange {
    pub anchor: TextCaretAddress,
    pub focus: TextCaretAddress,
    pub start: TextCaretAddress,
    pub end: TextCaretAddress,
    pub selected_text: String,
    pub source_locator: RuntimeSourceLocator,
    pub rects: Vec<RuntimeExactTextRangeRect>,
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
