use crate::{wire::serialize_json, WasmRuntimeDocument, WasmRuntimeError};

impl WasmRuntimeDocument {
    pub fn get_frame_json(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let frame = self
            .document
            .get_frame(revision_id, spread_index)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&frame)
    }

    pub fn get_frame_command_buffer_metadata_json(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let buffer = self
            .document
            .get_frame_command_buffer(revision_id, spread_index)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&buffer.metadata)
    }

    pub fn read_frame_command_buffer(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        self.document
            .get_frame_command_buffer(revision_id, spread_index)
            .map(|buffer| buffer.bytes)
            .map_err(WasmRuntimeError::from_engine)
    }
}
