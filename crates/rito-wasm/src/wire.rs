use rito_core::layout::LayoutConfig;
use rito_core::runtime::{
    RuntimeExactSourceRangeRequest, RuntimeFrameResourceWarmPlan, RuntimeLocatorRequest,
    RuntimeResourceKind, RuntimeResourceTransferPayload, RuntimeSearchRequest,
    RuntimeSourceLocator, RuntimeTextPointRequest, RuntimeTextRangeFromPointsRequest,
    RuntimeTextRangeGeometryRequest, RuntimeTextRangeRequest, RuntimeTextRangeToPointRequest,
    RuntimeTextSelectionMovementRequest,
};
use serde::{Deserialize, Serialize};

use crate::WasmRuntimeError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmResourcePrefetchRequest {
    pub resources: Vec<WasmResourceRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmResourceRequest {
    pub kind: RuntimeResourceKind,
    pub href: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmResourcePrefetchResponse {
    pub revision_id: String,
    pub payloads: Vec<RuntimeResourceTransferPayload>,
    pub missing_resources: Vec<WasmMissingResource>,
    /// Resources whose content shard has not arrived. They are not
    /// missing: a read once the shard is supplied returns their bytes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_resources: Vec<WasmPendingResource>,
    pub pending_transfer_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmFrameResourcePrefetchResponse {
    pub revision_id: String,
    pub spread_index: usize,
    pub payloads: Vec<RuntimeResourceTransferPayload>,
    pub missing_resources: Vec<WasmMissingResource>,
    /// Resources whose content shard has not arrived. They are not
    /// missing: a read once the shard is supplied returns their bytes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_resources: Vec<WasmPendingResource>,
    /// A spread whose resource hrefs could not be enumerated at all
    /// (as opposed to individual resources missing). The window still
    /// delivers its sibling spreads; the reader loads this one on demand.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefetch_error: Option<String>,
    pub pending_transfer_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPlannedFrameResourcePrefetchResponse {
    pub plan: RuntimeFrameResourceWarmPlan,
    pub spreads: Vec<WasmFrameResourcePrefetchResponse>,
    pub pending_transfer_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmMissingResource {
    pub kind: RuntimeResourceKind,
    pub href: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPendingResource {
    pub kind: RuntimeResourceKind,
    pub href: String,
}

/// One batch of resource reads: each requested resource lands in exactly
/// one of the three lists.
#[derive(Debug)]
pub struct WasmResourceBatch<Payload, Missing> {
    pub payloads: Vec<Payload>,
    pub missing: Vec<Missing>,
    pub pending: Vec<WasmPendingResource>,
}

impl<Payload, Missing> Default for WasmResourceBatch<Payload, Missing> {
    fn default() -> Self {
        Self {
            payloads: Vec::new(),
            missing: Vec::new(),
            pending: Vec::new(),
        }
    }
}

pub fn parse_layout_config(json: &str) -> Result<LayoutConfig, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid layout config JSON: {error}"))
    })
}

pub fn parse_search_request(json: &str) -> Result<RuntimeSearchRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid search request JSON: {error}"))
    })
}

pub fn parse_locator_request(json: &str) -> Result<RuntimeLocatorRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid locator request JSON: {error}"))
    })
}

pub fn parse_source_locator_request(json: &str) -> Result<RuntimeSourceLocator, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid source locator request JSON: {error}"))
    })
}

pub fn parse_exact_source_range_request(
    json: &str,
) -> Result<RuntimeExactSourceRangeRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid exact source range request JSON: {error}"))
    })
}

pub fn parse_resource_prefetch_request(
    json: &str,
) -> Result<WasmResourcePrefetchRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid resource prefetch request JSON: {error}"))
    })
}

pub fn parse_text_range_geometry_request(
    json: &str,
) -> Result<RuntimeTextRangeGeometryRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid text range geometry request JSON: {error}"))
    })
}

pub fn parse_text_point_request(json: &str) -> Result<RuntimeTextPointRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid text point request JSON: {error}"))
    })
}

pub fn parse_text_range_request(json: &str) -> Result<RuntimeTextRangeRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid text range request JSON: {error}"))
    })
}

pub fn parse_text_range_from_points_request(
    json: &str,
) -> Result<RuntimeTextRangeFromPointsRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!(
            "invalid text range from points request JSON: {error}"
        ))
    })
}

pub fn parse_text_range_to_point_request(
    json: &str,
) -> Result<RuntimeTextRangeToPointRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid text range to point request JSON: {error}"))
    })
}

pub fn parse_text_selection_movement_request(
    json: &str,
) -> Result<RuntimeTextSelectionMovementRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!(
            "invalid text selection movement request JSON: {error}"
        ))
    })
}

pub fn serialize_json(value: &impl Serialize) -> Result<String, WasmRuntimeError> {
    serde_json::to_string(value).map_err(|error| {
        WasmRuntimeError::internal_error(format!("JSON serialization failed: {error}"))
    })
}
