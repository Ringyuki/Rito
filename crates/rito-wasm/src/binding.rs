use rito_core::runtime::RuntimeResourceKind;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::{WasmRuntimeDocument, WasmRuntimeError};

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

    #[wasm_bindgen(js_name = getResourcePayloadJson)]
    pub fn get_resource_payload_json(
        &mut self,
        revision_id: &str,
        kind: &str,
        href: &str,
    ) -> Result<String, JsValue> {
        let kind = parse_resource_kind(kind).map_err(error_to_js_value)?;
        self.inner
            .get_resource_payload_json(revision_id, kind, href)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = prefetchResourcesJson)]
    pub fn prefetch_resources_json(
        &mut self,
        revision_id: &str,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .prefetch_resources_json(revision_id, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = prefetchPlannedFrameResourcesJson)]
    pub fn prefetch_planned_frame_resources_json(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .prefetch_planned_frame_resources_json(revision_id, spread_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = readResourceTransfer)]
    pub fn read_resource_transfer(&self, transfer_id: &str) -> Result<Vec<u8>, JsValue> {
        self.inner
            .read_resource_transfer(transfer_id)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = releaseResourceTransfer)]
    pub fn release_resource_transfer(&mut self, transfer_id: &str) -> bool {
        self.inner.release_resource_transfer(transfer_id)
    }

    #[wasm_bindgen(js_name = releaseRevisionTransfers)]
    pub fn release_revision_transfers(&mut self, revision_id: &str) -> usize {
        self.inner.release_revision_transfers(revision_id)
    }

    #[wasm_bindgen(js_name = releaseRevision)]
    pub fn release_revision(&mut self, revision_id: &str) -> bool {
        self.inner.release_revision(revision_id)
    }

    #[wasm_bindgen(js_name = pendingResourceTransferCount)]
    pub fn pending_resource_transfer_count(&self) -> usize {
        self.inner.pending_resource_transfer_count()
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
    };
    serde_json::to_string(&payload).unwrap_or_else(|_| "{\"code\":\"internal-error\"}".to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmErrorPayload {
    code: &'static str,
    message: String,
}

#[cfg(test)]
mod tests {
    use super::{error_json_string, parse_resource_kind};
    use crate::{WasmRuntimeError, WasmRuntimeErrorCode};

    #[test]
    fn parses_wire_resource_kinds() {
        assert!(parse_resource_kind("image").is_ok());
        assert!(parse_resource_kind("font").is_ok());
        assert!(parse_resource_kind("stylesheet").is_ok());

        let error = parse_resource_kind("audio").expect_err("unsupported kind fails");

        assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
        assert_eq!(error.message(), "unsupported resource kind: audio");
    }

    #[test]
    fn serializes_structured_errors_to_json_strings() {
        let value = error_json_string(WasmRuntimeError::bad_request("bad input"));

        assert_eq!(value, r#"{"code":"bad-request","message":"bad input"}"#);
    }
}
