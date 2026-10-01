//! Annotation targets over the JSON boundary. A target crosses as the
//! engine's own serialization, so a browser host stores exactly the bytes a
//! native host would.

use rito_core::runtime::{annotation_target_from_json, RuntimeSourceRange};
use serde::Deserialize;

use crate::{
    versioned::revision_handle, wire::serialize_json, WasmRuntimeDocument, WasmRuntimeError,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateAnnotationTargetRequest {
    href: String,
    source_range: RuntimeSourceRange,
}

impl WasmRuntimeDocument {
    pub fn create_annotation_target_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request: CreateAnnotationTargetRequest =
            serde_json::from_str(request_json).map_err(|error| {
                WasmRuntimeError::bad_request(format!("annotation target request: {error}"))
            })?;
        let response = self
            .document
            .create_annotation_target_at(
                &revision_handle(revision_id, revision_version),
                &request.href,
                &request.source_range,
            )
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn resolve_annotation_target_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        target_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let target = annotation_target_from_json(target_json)
            .map_err(|error| WasmRuntimeError::bad_request(error.message))?;
        let response = self
            .document
            .resolve_annotation_target_at(&revision_handle(revision_id, revision_version), &target)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }
}
