use rito_core::runtime::{RuntimeFrameCommandBufferMetadata, RuntimeVersioned};

use super::revision_handle;
use crate::{wire::serialize_json, WasmRuntimeDocument, WasmRuntimeError};

impl WasmRuntimeDocument {
    pub fn get_frame_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        spread_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let frame = self
            .document
            .get_frame_at(
                &revision_handle(revision_id, revision_version),
                spread_index,
            )
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&frame)
    }

    pub fn get_frame_command_buffer_metadata_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        spread_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let buffer = self
            .document
            .get_frame_command_buffer_at(
                &revision_handle(revision_id, revision_version),
                spread_index,
            )
            .map_err(WasmRuntimeError::from_revision_access)?;
        let metadata = RuntimeVersioned::<RuntimeFrameCommandBufferMetadata>::new(
            buffer.revision,
            buffer.value.metadata,
        );
        serialize_json(&metadata)
    }

    pub fn read_frame_command_buffer_at_revision(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        spread_index: usize,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        self.document
            .get_frame_command_buffer_at(
                &revision_handle(revision_id, revision_version),
                spread_index,
            )
            .map(|buffer| buffer.value.bytes)
            .map_err(WasmRuntimeError::from_revision_access)
    }
}
