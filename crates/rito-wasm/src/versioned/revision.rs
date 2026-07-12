use rito_core::runtime::RuntimeVersioned;
use serde::Serialize;

use super::revision_handle;
use crate::{wire::serialize_json, WasmRuntimeDocument, WasmRuntimeError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmRevisionReleaseResponse {
    released_revision: bool,
    released_transfer_count: usize,
}

impl WasmRuntimeDocument {
    pub fn get_revision_summary_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .get_revision_summary_at(&revision_handle(revision_id, revision_version))
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_revision_bundle_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        include_toc_targets: bool,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .revision_bundle_at(
                &revision_handle(revision_id, revision_version),
                include_toc_targets,
            )
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_revision_navigation_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .revision_navigation_at(&revision_handle(revision_id, revision_version))
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_shape_provenance_diagnostic_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .shape_provenance_diagnostic_at(&revision_handle(revision_id, revision_version))
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn release_revision_transfers_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, WasmRuntimeError> {
        let handle = revision_handle(revision_id, revision_version);
        let released = self.transfers.release_revision_at(&handle);
        serialize_json(&RuntimeVersioned::new(handle, released))
    }

    pub fn release_revision_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, WasmRuntimeError> {
        let handle = revision_handle(revision_id, revision_version);
        let released_revision = self
            .document
            .release_revision_at(&handle)
            .map_err(WasmRuntimeError::from_revision_access)?;
        let released_transfer_count = self.transfers.release_revision_at(&handle);
        serialize_json(&RuntimeVersioned::new(
            handle,
            WasmRevisionReleaseResponse {
                released_revision,
                released_transfer_count,
            },
        ))
    }
}
