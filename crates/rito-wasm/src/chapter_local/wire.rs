use std::collections::BTreeMap;

use rito_core::runtime::{
    RuntimeChapterLocalRevisionHandle, RuntimeChapterLocalRevisionRequest,
    RuntimeFrameCommandBufferMetadata, RuntimeResource, RuntimeResourceKind, RuntimeSourceLocator,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::WasmRuntimeError;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WasmChapterLocalFrameCommandBufferMetadata {
    pub(super) owner: RuntimeChapterLocalRevisionHandle,
    pub(super) local_spread_index: usize,
    pub(super) width: Value,
    pub(super) height: Value,
    pub(super) protocol_version: u32,
    pub(super) ratio: f64,
    pub(super) command_count: usize,
    pub(super) command_counts: BTreeMap<String, usize>,
    pub(super) primitive_count: usize,
    pub(super) byte_length: usize,
    pub(super) command_hash: String,
    pub(super) resource_ref_count: usize,
    pub(super) resource_table: Vec<String>,
    pub(super) font_families: Vec<String>,
    pub(super) image_dominated: bool,
}

impl WasmChapterLocalFrameCommandBufferMetadata {
    pub(super) fn try_new(
        owner: RuntimeChapterLocalRevisionHandle,
        local_spread_index: usize,
        metadata: RuntimeFrameCommandBufferMetadata,
    ) -> Result<Self, WasmRuntimeError> {
        if metadata.revision_id != owner.revision_id || metadata.spread_index != local_spread_index
        {
            return Err(WasmRuntimeError::internal_error(
                "chapter-local frame metadata does not match its exact owner",
            ));
        }
        Ok(Self {
            owner,
            local_spread_index,
            width: metadata.width,
            height: metadata.height,
            protocol_version: metadata.protocol_version,
            ratio: metadata.ratio,
            command_count: metadata.command_count,
            command_counts: metadata.command_counts,
            primitive_count: metadata.primitive_count,
            byte_length: metadata.byte_length,
            command_hash: metadata.command_hash,
            resource_ref_count: metadata.resource_ref_count,
            resource_table: metadata.resource_table,
            font_families: metadata.font_families,
            image_dominated: metadata.image_dominated,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WasmChapterLocalResourceTransferPayload {
    pub(super) owner: RuntimeChapterLocalRevisionHandle,
    pub(super) transfer_id: String,
    pub(super) kind: RuntimeResourceKind,
    pub(super) href: String,
    pub(super) media_type: String,
    pub(super) byte_length: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) height: Option<u32>,
}

impl WasmChapterLocalResourceTransferPayload {
    pub(super) fn from_resource(
        owner: RuntimeChapterLocalRevisionHandle,
        transfer_id: String,
        resource: &RuntimeResource,
    ) -> Self {
        Self {
            owner,
            transfer_id,
            kind: resource.kind,
            href: resource.href.clone(),
            media_type: resource.media_type.clone(),
            byte_length: resource.byte_length(),
            width: resource.width,
            height: resource.height,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WasmChapterLocalFrameResourceResponse {
    pub(super) owner: RuntimeChapterLocalRevisionHandle,
    pub(super) local_spread_index: usize,
    pub(super) payloads: Vec<WasmChapterLocalResourceTransferPayload>,
    pub(super) missing_resources: Vec<WasmChapterLocalMissingResource>,
    pub(super) pending_chapter_local_transfer_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WasmChapterLocalMissingResource {
    pub(super) kind: RuntimeResourceKind,
    pub(super) href: String,
    pub(super) message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WasmChapterLocalRevisionRelease {
    pub(super) owner: RuntimeChapterLocalRevisionHandle,
    pub(super) released_revision: bool,
    pub(super) released_transfer_count: usize,
}

pub(super) fn parse_create_request(
    json: &str,
) -> Result<RuntimeChapterLocalRevisionRequest, WasmRuntimeError> {
    parse_json(json, "chapter-local revision request")
}

pub(super) fn parse_owner(
    json: &str,
) -> Result<RuntimeChapterLocalRevisionHandle, WasmRuntimeError> {
    parse_json(json, "chapter-local owner")
}

pub(super) fn parse_locator(json: &str) -> Result<RuntimeSourceLocator, WasmRuntimeError> {
    parse_json(json, "chapter-local source locator")
}

fn parse_json<T: for<'de> Deserialize<'de>>(
    json: &str,
    label: &str,
) -> Result<T, WasmRuntimeError> {
    serde_json::from_str(json)
        .map_err(|error| WasmRuntimeError::bad_request(format!("invalid {label} JSON: {error}")))
}
