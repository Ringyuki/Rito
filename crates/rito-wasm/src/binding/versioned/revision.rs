use wasm_bindgen::prelude::*;

use super::super::{error_to_js_value, RitoWasmDocument};

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
    #[wasm_bindgen(js_name = getRevisionSummaryAtRevisionJson)]
    pub fn get_revision_summary_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, JsValue> {
        self.inner
            .get_revision_summary_at_revision_json(revision_id, revision_version)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getRevisionBundleAtRevisionJson)]
    pub fn get_revision_bundle_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        include_toc_targets: bool,
    ) -> Result<String, JsValue> {
        self.inner
            .get_revision_bundle_at_revision_json(
                revision_id,
                revision_version,
                include_toc_targets,
            )
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getRevisionPresentationAtRevisionJson)]
    pub fn get_revision_presentation_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, JsValue> {
        self.inner
            .get_revision_presentation_at_revision_json(revision_id, revision_version)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getRevisionNavigationAtRevisionJson)]
    pub fn get_revision_navigation_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, JsValue> {
        self.inner
            .get_revision_navigation_at_revision_json(revision_id, revision_version)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = getShapeProvenanceDiagnosticAtRevisionJson)]
    pub fn get_shape_provenance_diagnostic_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, JsValue> {
        self.inner
            .get_shape_provenance_diagnostic_at_revision_json(revision_id, revision_version)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = releaseRevisionTransfersAtRevision)]
    pub fn release_revision_transfers_at_revision(
        &mut self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, JsValue> {
        self.inner
            .release_revision_transfers_at_revision_json(revision_id, revision_version)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = releaseRevisionAtRevision)]
    pub fn release_revision_at_revision(
        &mut self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, JsValue> {
        self.inner
            .release_revision_at_revision_json(revision_id, revision_version)
            .map_err(error_to_js_value)
    }
}
