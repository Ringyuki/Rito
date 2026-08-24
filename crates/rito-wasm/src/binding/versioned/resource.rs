use wasm_bindgen::prelude::*;

use super::super::{error_to_js_value, parse_resource_kind, RitoWasmDocument};

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
    #[wasm_bindgen(js_name = getResourcePayloadAtRevisionJson)]
    pub fn get_resource_payload_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        kind: &str,
        href: &str,
    ) -> Result<String, JsValue> {
        let kind = parse_resource_kind(kind).map_err(error_to_js_value)?;
        self.inner
            .get_resource_payload_at_revision_json(revision_id, revision_version, kind, href)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = prefetchResourcesAtRevisionJson)]
    pub fn prefetch_resources_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .prefetch_resources_at_revision_json(revision_id, revision_version, request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = prefetchPlannedFrameResourcesAtRevisionJson)]
    pub fn prefetch_planned_frame_resources_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        spread_index: usize,
    ) -> Result<String, JsValue> {
        self.inner
            .prefetch_planned_frame_resources_at_revision_json(
                revision_id,
                revision_version,
                spread_index,
            )
            .map_err(error_to_js_value)
    }
}
