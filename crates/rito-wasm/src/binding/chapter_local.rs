use wasm_bindgen::prelude::*;

use super::{error_to_js_value, parse_resource_kind, RitoWasmDocument};

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
    #[wasm_bindgen(js_name = createBoundedChapterLocalRevisionJson)]
    pub fn create_bounded_chapter_local_revision_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .create_bounded_chapter_local_revision_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = continueChapterLocalRevisionJson)]
    pub fn continue_chapter_local_revision_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .continue_chapter_local_revision_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getChapterLocalRevisionSummaryJson)]
    pub fn get_chapter_local_revision_summary_json(
        &self,
        owner_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .get_chapter_local_revision_summary_json(owner_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = resolveChapterLocalSourceLocatorJson)]
    pub fn resolve_chapter_local_source_locator_json(
        &mut self,
        owner_json: &str,
        locator_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_chapter_local_source_locator_json(owner_json, locator_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getChapterLocalFrameJson)]
    pub fn get_chapter_local_frame_json(
        &mut self,
        owner_json: &str,
        local_spread_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_chapter_local_frame_json(owner_json, local_spread_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getChapterLocalFrameCommandBufferMetadataJson)]
    pub fn get_chapter_local_frame_command_buffer_metadata_json(
        &mut self,
        owner_json: &str,
        local_spread_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_chapter_local_frame_command_buffer_metadata_json(owner_json, local_spread_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = readChapterLocalFrameCommandBuffer)]
    pub fn read_chapter_local_frame_command_buffer(
        &mut self,
        owner_json: &str,
        local_spread_index: usize,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .read_chapter_local_frame_command_buffer(owner_json, local_spread_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getChapterLocalResourcePayloadJson)]
    pub fn get_chapter_local_resource_payload_json(
        &mut self,
        owner_json: &str,
        kind: &str,
        href: &str,
    ) -> Result<String, JsValue> {
        let kind = parse_resource_kind(kind).map_err(error_to_js_value)?;
        self.inner
            .get_chapter_local_resource_payload_json(owner_json, kind, href)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = prefetchChapterLocalFrameResourcesJson)]
    pub fn prefetch_chapter_local_frame_resources_json(
        &mut self,
        owner_json: &str,
        local_spread_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .prefetch_chapter_local_frame_resources_json(owner_json, local_spread_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = readChapterLocalResourceTransfer)]
    pub fn read_chapter_local_resource_transfer(
        &self,
        owner_json: &str,
        transfer_id: &str,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .read_chapter_local_resource_transfer(owner_json, transfer_id)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = takeChapterLocalResourceTransfer)]
    pub fn take_chapter_local_resource_transfer(
        &mut self,
        owner_json: &str,
        transfer_id: &str,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .take_chapter_local_resource_transfer(owner_json, transfer_id)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = releaseChapterLocalResourceTransfer)]
    pub fn release_chapter_local_resource_transfer(
        &mut self,
        owner_json: &str,
        transfer_id: &str,
    ) -> Result<bool, JsValue> {
        self.inner
            .release_chapter_local_resource_transfer(owner_json, transfer_id)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = releaseChapterLocalRevisionJson)]
    pub fn release_chapter_local_revision_json(
        &mut self,
        owner_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .release_chapter_local_revision_json(owner_json)
            .map_err(error_to_js_value)
    }
}
