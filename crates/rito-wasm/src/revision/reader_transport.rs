use std::collections::BTreeMap;

use rito_core::runtime::{
    encode_runtime_bundle, RuntimeChapterTextIndex, RuntimeFootnotes, RuntimeRequiredFontFaces,
    RuntimeRevisionNavigation, RuntimeRevisionSummary, RuntimeTocTargets,
    RuntimeViewRevisionDisplay, RuntimeViewRevisionFollowUp, RuntimeViewRevisionKind,
    RuntimeViewRevisionMetadata,
};
use serde::Serialize;

use super::{WasmRevisionFrameSelection, WasmViewRevisionResponse};
use crate::{
    wire::{serialize_json, WasmPlannedFrameResourcePrefetchResponse},
    wire_metrics::{ViewRevisionWire, WireEncodeTimer},
    WasmRuntimeDocument, WasmRuntimeError,
};

const FULL_CHAPTER_TEXT_SCOPE_KEY: &str = "chapter-text-v1:full";

#[derive(Serialize)]
#[serde(untagged)]
enum WasmReaderViewRevisionProjection<'a> {
    Preview(&'a WasmViewRevisionResponse),
    Full(WasmReaderFullViewRevisionResponse<'a>),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmReaderFullViewRevisionResponse<'a> {
    kind: RuntimeViewRevisionKind,
    display: RuntimeViewRevisionDisplay,
    #[serde(skip_serializing_if = "Option::is_none")]
    follow_up: Option<&'a RuntimeViewRevisionFollowUp>,
    result: WasmReaderRevisionBundleResponse<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmReaderRevisionBundleResponse<'a> {
    bundle: WasmReaderRuntimeRevisionBundle<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_selection: Option<&'a WasmRevisionFrameSelection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    initial_frame_window: Option<&'a WasmPlannedFrameResourcePrefetchResponse>,
    preview: bool,
    released_previous_revision_transfer_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmReaderRuntimeRevisionBundle<'a> {
    revision: &'a RuntimeRevisionSummary,
    navigation: &'a RuntimeRevisionNavigation,
    toc_targets: &'a RuntimeTocTargets,
    footnotes: &'a RuntimeFootnotes,
    chapter_text_indices: WasmReaderChapterTextIndices<'a>,
    font_families: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    required_font_faces: Option<&'a RuntimeRequiredFontFaces>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmReaderChapterTextIndices<'a> {
    revision_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    entries: Option<&'a BTreeMap<String, RuntimeChapterTextIndex>>,
    scope_key: &'static str,
}

impl WasmRuntimeDocument {
    pub fn create_reader_view_revision_bundle_json(
        &mut self,
        request_json: &str,
        omit_full_indices: bool,
    ) -> Result<String, WasmRuntimeError> {
        let measure = self.view_revision_wire_measurement.consume_arm();
        let response = self.create_view_revision_bundle_response_with_metadata(
            request_json,
            reader_view_revision_metadata(omit_full_indices),
        )?;
        let projection = reader_view_revision_projection(&response, omit_full_indices);
        if !measure {
            return serialize_json(&projection);
        }

        let timer = WireEncodeTimer::start();
        let result = serialize_json(&projection);
        let rust_encode_ms = timer.elapsed_ms();
        if let Ok(payload) = &result {
            self.view_revision_wire_measurement.record(
                ViewRevisionWire::Json,
                payload.len(),
                rust_encode_ms,
            );
        }
        result
    }

    pub fn create_reader_view_revision_bundle_bytes(
        &mut self,
        request_json: &str,
        omit_full_indices: bool,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        let measure = self.view_revision_wire_measurement.consume_arm();
        let response = self.create_view_revision_bundle_response_with_metadata(
            request_json,
            reader_view_revision_metadata(omit_full_indices),
        )?;
        let projection = reader_view_revision_projection(&response, omit_full_indices);
        if !measure {
            return encode_runtime_bundle(&projection).map_err(WasmRuntimeError::from_engine);
        }

        let timer = WireEncodeTimer::start();
        let encoded = encode_runtime_bundle(&projection);
        let rust_encode_ms = timer.elapsed_ms();
        let result = encoded.map_err(WasmRuntimeError::from_engine);
        if let Ok(payload) = &result {
            self.view_revision_wire_measurement.record(
                ViewRevisionWire::Ritorb1,
                payload.len(),
                rust_encode_ms,
            );
        }
        result
    }
}

fn reader_view_revision_metadata(omit_full_indices: bool) -> RuntimeViewRevisionMetadata {
    if omit_full_indices {
        RuntimeViewRevisionMetadata::OmitFullChapterTextIndices
    } else {
        RuntimeViewRevisionMetadata::Complete
    }
}

fn reader_view_revision_projection(
    response: &WasmViewRevisionResponse,
    omit_full_indices: bool,
) -> WasmReaderViewRevisionProjection<'_> {
    if response.kind == RuntimeViewRevisionKind::Preview {
        return WasmReaderViewRevisionProjection::Preview(response);
    }

    let result = &response.result;
    let bundle = &result.bundle;
    WasmReaderViewRevisionProjection::Full(WasmReaderFullViewRevisionResponse {
        kind: response.kind,
        display: response.display,
        follow_up: response.follow_up.as_ref(),
        result: WasmReaderRevisionBundleResponse {
            bundle: WasmReaderRuntimeRevisionBundle {
                revision: &bundle.revision,
                navigation: &bundle.navigation,
                toc_targets: &bundle.toc_targets,
                footnotes: &bundle.footnotes,
                chapter_text_indices: WasmReaderChapterTextIndices {
                    revision_id: &bundle.chapter_text_indices.revision_id,
                    entries: (!omit_full_indices).then_some(&bundle.chapter_text_indices.entries),
                    scope_key: FULL_CHAPTER_TEXT_SCOPE_KEY,
                },
                font_families: &bundle.font_families,
                required_font_faces: bundle.required_font_faces.as_ref(),
            },
            frame_selection: result.frame_selection.as_ref(),
            initial_frame_window: result.initial_frame_window.as_ref(),
            preview: result.preview,
            released_previous_revision_transfer_count: result
                .released_previous_revision_transfer_count,
        },
    })
}
