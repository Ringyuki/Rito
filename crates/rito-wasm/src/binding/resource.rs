use wasm_bindgen::prelude::*;

use super::{error_to_js_value, parse_resource_kind, RitoWasmDocument};

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
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

    #[wasm_bindgen(js_name = takeResourceTransfer)]
    pub fn take_resource_transfer(&mut self, transfer_id: &str) -> Result<Vec<u8>, JsValue> {
        self.inner
            .take_resource_transfer(transfer_id)
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
