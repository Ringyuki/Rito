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

    /// Cutover lever: lets completed whole-book revisions hand pagination
    /// to the fragment engine. Off by default until the fragment
    /// interaction surface is complete.
    #[wasm_bindgen(js_name = setFragmentPageTableEnabled)]
    pub fn set_fragment_page_table_enabled(&mut self, enabled: bool) {
        self.inner.document.set_fragment_page_table_enabled(enabled);
    }

    /// Injects host-measured `line-height: normal` metrics: a JSON array
    /// of `{family, size, strut, cjk}`. The host (the surrounding
    /// browser) measures normal line heights per (family, size, sample)
    /// because those integers come from the host font scaler and are not
    /// derivable from font tables. An empty sample is an inline box's own
    /// strut; a one-character sample measures the font the host resolves
    /// for that character, so runs served by a fallback font are sized by
    /// that font rather than by the declared family.
    #[wasm_bindgen(js_name = setHostLineMetricsJson)]
    pub fn set_host_line_metrics_json(&self, entries_json: &str) -> Result<(), JsValue> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Entry {
            family: String,
            size: f64,
            #[serde(default)]
            sample: String,
            height: f64,
            baseline: f64,
        }
        let entries: Vec<Entry> = serde_json::from_str(entries_json)
            .map_err(|error| JsValue::from_str(&format!("host metrics parse: {error}")))?;
        for entry in entries {
            self.inner.document.set_host_line_metric(
                &entry.family,
                entry.size,
                &entry.sample,
                rito_inline::HostNormalLineMetric {
                    height: entry.height,
                    baseline: entry.baseline,
                },
            );
        }
        Ok(())
    }

    /// Drains the (family, size, sample) keys layout needed but no host
    /// metric covered, as a JSON array of `{family, size, sample}`. The
    /// host measures
    /// each, injects via `setHostLineMetricsJson`, and relayouts; a
    /// steady-state layout drains nothing.
    #[wasm_bindgen(js_name = takeHostLineMetricRequestsJson)]
    pub fn take_host_line_metric_requests_json(&self) -> String {
        #[derive(serde::Serialize)]
        struct Entry {
            family: String,
            size: f64,
            sample: String,
        }
        let entries: Vec<Entry> = self
            .inner
            .document
            .take_host_line_metric_requests()
            .into_iter()
            .map(|(family, size, sample)| Entry {
                family,
                size,
                sample,
            })
            .collect();
        serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_owned())
    }

    /// Fragment-engine representability of a revision's chapters, for
    /// diagnostics: per chapter, whether a formatting tree built, its node
    /// count, and the failure reason when it did not.
    #[wasm_bindgen(js_name = chapterTreeReportJson)]
    pub fn chapter_tree_report_json(&self, revision_id: &str) -> Result<String, JsValue> {
        let report = self
            .inner
            .document
            .chapter_tree_report(revision_id)
            .map_err(|error| error_to_js_value(WasmRuntimeError::from_engine(error)))?;
        serde_json::to_string(&report)
            .map_err(|error| JsValue::from_str(&format!("report serialization failed: {error}")))
    }

    /// Which backend owns a revision's pagination ("fragment" or
    /// "retained"), for diagnostics.
    #[wasm_bindgen(js_name = revisionPaginationBackend)]
    pub fn revision_pagination_backend(&self, revision_id: &str) -> Option<String> {
        self.inner
            .document
            .revision_pagination_backend(revision_id)
            .map(str::to_owned)
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
