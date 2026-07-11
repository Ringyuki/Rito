use wasm_bindgen::prelude::*;

use super::super::{error_to_js_value, RitoWasmDocument};

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
    #[wasm_bindgen(js_name = getFrameAtRevisionJson)]
    pub fn get_frame_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        spread_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_frame_at_revision_json(revision_id, revision_version, spread_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getFrameCommandBufferMetadataAtRevisionJson)]
    pub fn get_frame_command_buffer_metadata_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        spread_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_frame_command_buffer_metadata_at_revision_json(
                revision_id,
                revision_version,
                spread_index,
            )
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = readFrameCommandBufferAtRevision)]
    pub fn read_frame_command_buffer_at_revision(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        spread_index: usize,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .read_frame_command_buffer_at_revision(revision_id, revision_version, spread_index)
            .map_err(error_to_js_value)
    }
}
