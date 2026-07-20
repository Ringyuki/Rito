use rito_core::runtime::RuntimeResourceKind;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::{WasmRuntimeDocument, WasmRuntimeError};

mod chapter_local;
mod continuation;
mod pinned_font;
mod resource;
mod versioned;

#[wasm_bindgen(js_name = RitoWasmDocument)]
pub struct RitoWasmDocument {
    inner: WasmRuntimeDocument,
}

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<RitoWasmDocument, JsValue> {
        WasmRuntimeDocument::open(bytes)
            .map(|inner| Self { inner })
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = publicationJson)]
    pub fn publication_json(&self) -> Result<String, JsValue> {
        self.inner.publication_json().map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = createFullRevisionBundleJson)]
    pub fn create_full_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .create_full_revision_bundle_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = createInitialPreviewRevisionBundleJson)]
    pub fn create_initial_preview_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .create_initial_preview_revision_bundle_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = createActiveChapterPreviewRevisionBundleJson)]
    pub fn create_active_chapter_preview_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .create_active_chapter_preview_revision_bundle_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = createPreviewRevisionBundleJson)]
    pub fn create_preview_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .create_preview_revision_bundle_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = createViewRevisionBundleJson)]
    pub fn create_view_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .create_view_revision_bundle_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = createViewRevisionBundleBytes)]
    pub fn create_view_revision_bundle_bytes(
        &mut self,
        request_json: &str,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .create_view_revision_bundle_bytes(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = createBoundedRevisionJson)]
    pub fn create_bounded_revision_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        self.inner
            .create_bounded_revision_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = continueRevisionJson)]
    pub fn continue_revision_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        self.inner
            .continue_revision_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = cancelRevisionJson)]
    pub fn cancel_revision_json(&mut self, request_json: &str) -> Result<String, JsValue> {
        self.inner
            .cancel_revision_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getRevisionSummaryJson)]
    pub fn get_revision_summary_json(&self, revision_id: &str) -> Result<String, JsValue> {
        self.inner
            .get_revision_summary_json(revision_id)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = createReaderViewRevisionBundleJson)]
    pub fn create_reader_view_revision_bundle_json(
        &mut self,
        request_json: &str,
        omit_full_indices: bool,
    ) -> Result<String, JsValue> {
        self.inner
            .create_reader_view_revision_bundle_json(request_json, omit_full_indices)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = createReaderViewRevisionBundleBytes)]
    pub fn create_reader_view_revision_bundle_bytes(
        &mut self,
        request_json: &str,
        omit_full_indices: bool,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .create_reader_view_revision_bundle_bytes(request_json, omit_full_indices)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = measureNextViewRevisionWire)]
    pub fn measure_next_view_revision_wire(&mut self) {
        self.inner.measure_next_view_revision_wire();
    }

    #[wasm_bindgen(js_name = takeViewRevisionWireMetricsJson)]
    pub fn take_view_revision_wire_metrics_json(&mut self) -> Result<String, JsValue> {
        self.inner
            .take_view_revision_wire_metrics_json()
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getFrameJson)]
    pub fn get_frame_json(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_frame_json(revision_id, spread_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getFrameCommandBufferMetadataJson)]
    pub fn get_frame_command_buffer_metadata_json(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_frame_command_buffer_metadata_json(revision_id, spread_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = readFrameCommandBuffer)]
    pub fn read_frame_command_buffer(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .read_frame_command_buffer(revision_id, spread_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getPageTargetsJson)]
    pub fn get_page_targets_json(
        &self,
        revision_id: &str,
        page_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_page_targets_json(revision_id, page_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getPageTextPositionsJson)]
    pub fn get_page_text_positions_json(
        &self,
        revision_id: &str,
        page_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_page_text_positions_json(revision_id, page_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getTextRangeGeometryJson)]
    pub fn get_text_range_geometry_json(
        &self,
        revision_id: &str,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .get_text_range_geometry_json(revision_id, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getFootnoteJson)]
    pub fn get_footnote_json(&mut self, revision_id: &str, key: &str) -> Result<String, JsValue> {
        self.inner
            .get_footnote_json(revision_id, key)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getFootnotesJson)]
    pub fn get_footnotes_json(&mut self, revision_id: &str) -> Result<String, JsValue> {
        self.inner
            .get_footnotes_json(revision_id)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getChapterTextIndicesJson)]
    pub fn get_chapter_text_indices_json(&mut self, revision_id: &str) -> Result<String, JsValue> {
        self.inner
            .get_chapter_text_indices_json(revision_id)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = searchJson)]
    pub fn search_json(&self, revision_id: &str, request_json: &str) -> Result<String, JsValue> {
        self.inner
            .search_json(revision_id, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = resolveLocatorJson)]
    pub fn resolve_locator_json(
        &self,
        revision_id: &str,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_locator_json(revision_id, request_json)
            .map_err(error_to_js_value)
    }
}

fn parse_resource_kind(kind: &str) -> Result<RuntimeResourceKind, WasmRuntimeError> {
    match kind {
        "image" => Ok(RuntimeResourceKind::Image),
        "font" => Ok(RuntimeResourceKind::Font),
        "stylesheet" => Ok(RuntimeResourceKind::Stylesheet),
        _ => Err(WasmRuntimeError::bad_request(format!(
            "unsupported resource kind: {kind}"
        ))),
    }
}

fn error_to_js_value(error: WasmRuntimeError) -> JsValue {
    JsValue::from_str(&error_json_string(error))
}

fn error_json_string(error: WasmRuntimeError) -> String {
    let payload = WasmErrorPayload {
        code: error.code().as_str(),
        message: error.message().to_owned(),
        revision: error.revision().cloned(),
        chapter_local_revision: error.chapter_local_revision().cloned(),
        released_chapter_local_revision: error.released_chapter_local_revision().cloned(),
    };
    serde_json::to_string(&payload).unwrap_or_else(|_| "{\"code\":\"internal-error\"}".to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmErrorPayload {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<rito_core::runtime::RuntimeRevisionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chapter_local_revision: Option<rito_core::runtime::RuntimeChapterLocalRevisionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    released_chapter_local_revision: Option<rito_core::runtime::RuntimeChapterLocalRevisionSummary>,
}

#[cfg(test)]
mod tests;
