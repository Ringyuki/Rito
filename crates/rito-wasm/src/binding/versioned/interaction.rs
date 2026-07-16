use wasm_bindgen::prelude::*;

use super::super::{error_to_js_value, RitoWasmDocument};

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
    #[wasm_bindgen(js_name = searchAtRevisionJson)]
    pub fn search_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .search_at_revision_json(revision_id, revision_version, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = resolveLocatorAtRevisionJson)]
    pub fn resolve_locator_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_locator_at_revision_json(revision_id, revision_version, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = resolveSourceLocatorAtRevisionJson)]
    pub fn resolve_source_locator_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_source_locator_at_revision_json(revision_id, revision_version, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = resolveExactSourceRangeAtRevisionJson)]
    pub fn resolve_exact_source_range_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_exact_source_range_at_revision_json(
                revision_id,
                revision_version,
                request_json,
            )
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getPageTargetsAtRevisionJson)]
    pub fn get_page_targets_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        page_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_page_targets_at_revision_json(revision_id, revision_version, page_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getPageSemanticsAtRevisionJson)]
    pub fn get_page_semantics_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        page_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_page_semantics_at_revision_json(revision_id, revision_version, page_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getPageReadingAnchorAtRevisionJson)]
    pub fn get_page_reading_anchor_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        page_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_page_reading_anchor_at_revision_json(revision_id, revision_version, page_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getPageTextPositionsAtRevisionJson)]
    pub fn get_page_text_positions_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        page_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .get_page_text_positions_at_revision_json(revision_id, revision_version, page_index)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getTextRangeGeometryAtRevisionJson)]
    pub fn get_text_range_geometry_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .get_text_range_geometry_at_revision_json(revision_id, revision_version, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = resolveTextCaretAtRevisionJson)]
    pub fn resolve_text_caret_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_text_caret_at_revision_json(revision_id, revision_version, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = resolveTextRangeAtRevisionJson)]
    pub fn resolve_text_range_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_text_range_at_revision_json(revision_id, revision_version, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = resolveTextRangeFromPointsAtRevisionJson)]
    pub fn resolve_text_range_from_points_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_text_range_from_points_at_revision_json(
                revision_id,
                revision_version,
                request_json,
            )
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getFootnoteAtRevisionJson)]
    pub fn get_footnote_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        key: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .get_footnote_at_revision_json(revision_id, revision_version, key)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getFootnotesAtRevisionJson)]
    pub fn get_footnotes_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, JsValue> {
        self.inner
            .get_footnotes_at_revision_json(revision_id, revision_version)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getChapterTextIndicesAtRevisionJson)]
    pub fn get_chapter_text_indices_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, JsValue> {
        self.inner
            .get_chapter_text_indices_at_revision_json(revision_id, revision_version)
            .map_err(error_to_js_value)
    }
}
