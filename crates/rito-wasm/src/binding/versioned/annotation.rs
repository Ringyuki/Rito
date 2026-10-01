use wasm_bindgen::prelude::*;

use super::super::{error_to_js_value, RitoWasmDocument};

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
    /// Builds the canonical annotation target for `{ href, sourceRange }`.
    #[wasm_bindgen(js_name = createAnnotationTargetAtRevisionJson)]
    pub fn create_annotation_target_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .create_annotation_target_at_revision_json(revision_id, revision_version, request_json)
            .map_err(error_to_js_value)
    }

    /// Resolves a stored annotation target against the chapter as it is now.
    #[wasm_bindgen(js_name = resolveAnnotationTargetAtRevisionJson)]
    pub fn resolve_annotation_target_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        target_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_annotation_target_at_revision_json(revision_id, revision_version, target_json)
            .map_err(error_to_js_value)
    }

    /// Answers a source-only reading-position question: the TOC entry a
    /// position reads under, or the order of two positions.
    #[wasm_bindgen(js_name = resolvePositionQueryAtRevisionJson)]
    pub fn resolve_position_query_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        query_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .resolve_position_query_at_revision_json(revision_id, revision_version, query_json)
            .map_err(error_to_js_value)
    }
}
