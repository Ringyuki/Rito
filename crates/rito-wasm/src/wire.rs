use rito_core::runtime::{
    RuntimeActiveChapterPreviewRevisionRequest, RuntimeFrameResourceWarmPlan,
    RuntimeFullRevisionBundleRequest, RuntimeInitialPreviewRevisionRequest, RuntimeLocatorRequest,
    RuntimePreviewRevisionBundleRequest, RuntimeResourceKind, RuntimeResourceTransferPayload,
    RuntimeSearchRequest, RuntimeTextRangeGeometryRequest, RuntimeViewRevisionRequest,
};
use serde::{Deserialize, Serialize};

use crate::WasmRuntimeError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmResourcePrefetchRequest {
    pub resources: Vec<WasmResourceRequest>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmFullRevisionBundleRequest {
    #[serde(flatten)]
    pub runtime: RuntimeFullRevisionBundleRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_revision_id: Option<String>,
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
    pub pending_transfer_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmFrameResourcePrefetchResponse {
    pub revision_id: String,
    pub spread_index: usize,
    pub payloads: Vec<RuntimeResourceTransferPayload>,
    pub missing_resources: Vec<WasmMissingResource>,
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

pub fn parse_full_revision_bundle_request(
    json: &str,
) -> Result<WasmFullRevisionBundleRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!(
            "invalid full revision bundle request JSON: {error}"
        ))
    })
}

pub fn parse_active_chapter_preview_revision_request(
    json: &str,
) -> Result<RuntimeActiveChapterPreviewRevisionRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!(
            "invalid active chapter preview revision request JSON: {error}"
        ))
    })
}

pub fn parse_initial_preview_revision_request(
    json: &str,
) -> Result<RuntimeInitialPreviewRevisionRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!(
            "invalid initial preview revision request JSON: {error}"
        ))
    })
}

pub fn parse_preview_revision_bundle_request(
    json: &str,
) -> Result<RuntimePreviewRevisionBundleRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid preview revision request JSON: {error}"))
    })
}

pub fn parse_view_revision_request(
    json: &str,
) -> Result<RuntimeViewRevisionRequest, WasmRuntimeError> {
    serde_json::from_str(json).map_err(|error| {
        WasmRuntimeError::bad_request(format!("invalid view revision request JSON: {error}"))
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

pub fn serialize_json(value: &impl Serialize) -> Result<String, WasmRuntimeError> {
    serde_json::to_string(value).map_err(|error| {
        WasmRuntimeError::internal_error(format!("JSON serialization failed: {error}"))
    })
}
