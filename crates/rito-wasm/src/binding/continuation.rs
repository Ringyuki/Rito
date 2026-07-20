use wasm_bindgen::prelude::*;

use super::{error_to_js_value, RitoWasmDocument};

#[wasm_bindgen(js_class = RitoWasmDocument)]
impl RitoWasmDocument {
    #[wasm_bindgen(js_name = calibrateRevisionFontVerticalMetricsJson)]
    pub fn calibrate_revision_font_vertical_metrics_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .calibrate_revision_font_vertical_metrics_json(request_json)
            .map_err(error_to_js_value)
    }

    #[wasm_bindgen(js_name = continueRevisionTowardSourceLocatorJson)]
    pub fn continue_revision_toward_source_locator_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .continue_revision_toward_source_locator_json(request_json)
            .map_err(error_to_js_value)
    }
}
