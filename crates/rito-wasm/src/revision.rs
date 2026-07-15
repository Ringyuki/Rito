use crate::{
    wire::{
        parse_active_chapter_preview_revision_request, parse_full_revision_bundle_request,
        parse_initial_preview_revision_request, parse_preview_revision_bundle_request,
        serialize_json, WasmPlannedFrameResourcePrefetchResponse,
    },
    wire_metrics::{ViewRevisionWire, WireEncodeTimer},
    WasmRuntimeDocument, WasmRuntimeError,
};
use rito_core::runtime::{
    encode_runtime_bundle, RuntimeInitialFrameDecision, RuntimeRevisionBundle,
    RuntimeRevisionHandle, RuntimeViewRevisionMetadata,
};
use serde::Serialize;

mod continuation;
mod reader_transport;
mod transaction;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRevisionFrameSelection {
    pub spread_index: usize,
    pub display_spread_index: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmRevisionBundleResponse {
    pub bundle: RuntimeRevisionBundle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_selection: Option<WasmRevisionFrameSelection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_frame_window: Option<WasmPlannedFrameResourcePrefetchResponse>,
    pub preview: bool,
    pub released_previous_revision_transfer_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmViewRevisionResponse {
    pub kind: rito_core::runtime::RuntimeViewRevisionKind,
    pub display: rito_core::runtime::RuntimeViewRevisionDisplay,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_up: Option<rito_core::runtime::RuntimeViewRevisionFollowUp>,
    pub result: WasmRevisionBundleResponse,
}

impl WasmRuntimeDocument {
    pub(crate) fn measure_next_view_revision_wire(&mut self) {
        self.view_revision_wire_measurement.arm();
    }

    pub(crate) fn take_view_revision_wire_metrics_json(
        &mut self,
    ) -> Result<String, WasmRuntimeError> {
        serialize_json(&self.view_revision_wire_measurement.take())
    }

    pub fn create_full_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_full_revision_bundle_request(request_json)?;
        let previous_revision_id = request.previous_revision_id.clone();
        let creation = self
            .document
            .create_full_revision_bundle(request.runtime)
            .map_err(WasmRuntimeError::from_engine)?;
        let revision = RuntimeRevisionHandle::from(&creation.bundle.revision);
        self.finish_created_revision_transport(
            revision,
            previous_revision_id.as_deref(),
            move |document, revision, released_previous_revision_transfer_count| {
                let initial_frame_window = document.initial_frame_window(
                    revision,
                    creation.initial_frame.as_ref(),
                    released_previous_revision_transfer_count,
                )?;
                serialize_json(&WasmRevisionBundleResponse {
                    bundle: creation.bundle,
                    frame_selection: creation.initial_frame.as_ref().map(frame_selection),
                    initial_frame_window,
                    preview: creation.preview,
                    released_previous_revision_transfer_count,
                })
            },
        )
    }

    pub fn create_initial_preview_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_initial_preview_revision_request(request_json)?;
        let creation = self
            .document
            .create_initial_preview_revision_bundle(request)
            .map_err(WasmRuntimeError::from_engine)?;
        let revision = RuntimeRevisionHandle::from(&creation.bundle.revision);
        self.finish_created_revision_transport(
            revision,
            None,
            move |document, revision, released_previous_revision_transfer_count| {
                let initial_frame_window = document.initial_frame_window(
                    revision,
                    creation.initial_frame.as_ref(),
                    released_previous_revision_transfer_count,
                )?;
                serialize_json(&WasmRevisionBundleResponse {
                    bundle: creation.bundle,
                    frame_selection: creation.initial_frame.as_ref().map(frame_selection),
                    initial_frame_window,
                    preview: creation.preview,
                    released_previous_revision_transfer_count,
                })
            },
        )
    }

    pub fn create_active_chapter_preview_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_active_chapter_preview_revision_request(request_json)?;
        let previous_revision_id = request.previous_revision_id.clone();
        let Some(creation) = self
            .document
            .create_active_chapter_preview_revision_bundle(request)
            .map_err(WasmRuntimeError::from_engine)?
        else {
            return serialize_json(&Option::<WasmRevisionBundleResponse>::None);
        };
        let revision = RuntimeRevisionHandle::from(&creation.bundle.revision);
        self.finish_created_revision_transport(
            revision,
            Some(&previous_revision_id),
            move |document, revision, released_previous_revision_transfer_count| {
                let initial_frame_window = document.initial_frame_window(
                    revision,
                    creation.initial_frame.as_ref(),
                    released_previous_revision_transfer_count,
                )?;
                serialize_json(&Some(WasmRevisionBundleResponse {
                    bundle: creation.bundle,
                    frame_selection: creation.initial_frame.as_ref().map(frame_selection),
                    initial_frame_window,
                    preview: creation.preview,
                    released_previous_revision_transfer_count,
                }))
            },
        )
    }

    pub fn create_preview_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_preview_revision_bundle_request(request_json)?;
        let previous_revision_id = request.previous_revision_id.clone();
        let Some(creation) = self
            .document
            .create_preview_revision_bundle(request)
            .map_err(WasmRuntimeError::from_engine)?
        else {
            return serialize_json(&Option::<WasmRevisionBundleResponse>::None);
        };
        let revision = RuntimeRevisionHandle::from(&creation.bundle.revision);
        self.finish_created_revision_transport(
            revision,
            previous_revision_id.as_deref(),
            move |document, revision, released_previous_revision_transfer_count| {
                let initial_frame_window = document.initial_frame_window(
                    revision,
                    creation.initial_frame.as_ref(),
                    released_previous_revision_transfer_count,
                )?;
                serialize_json(&Some(WasmRevisionBundleResponse {
                    bundle: creation.bundle,
                    frame_selection: creation.initial_frame.as_ref().map(frame_selection),
                    initial_frame_window,
                    preview: creation.preview,
                    released_previous_revision_transfer_count,
                }))
            },
        )
    }

    pub fn create_view_revision_bundle_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let measure = self.view_revision_wire_measurement.consume_arm();
        if !measure {
            return self.finish_view_revision_transport(
                request_json,
                RuntimeViewRevisionMetadata::Complete,
                serialize_json,
            );
        }

        let (payload, rust_encode_ms) = self.finish_view_revision_transport(
            request_json,
            RuntimeViewRevisionMetadata::Complete,
            |response| {
                let timer = WireEncodeTimer::start();
                let result = serialize_json(response);
                let rust_encode_ms = timer.elapsed_ms();
                result.map(|payload| (payload, rust_encode_ms))
            },
        )?;
        self.view_revision_wire_measurement.record(
            ViewRevisionWire::Json,
            payload.len(),
            rust_encode_ms,
        );
        Ok(payload)
    }

    pub fn create_view_revision_bundle_bytes(
        &mut self,
        request_json: &str,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        let measure = self.view_revision_wire_measurement.consume_arm();
        if !measure {
            return self.finish_view_revision_transport(
                request_json,
                RuntimeViewRevisionMetadata::Complete,
                |response| encode_runtime_bundle(response).map_err(WasmRuntimeError::from_engine),
            );
        }

        let (payload, rust_encode_ms) = self.finish_view_revision_transport(
            request_json,
            RuntimeViewRevisionMetadata::Complete,
            |response| {
                let timer = WireEncodeTimer::start();
                let result = encode_runtime_bundle(response).map_err(WasmRuntimeError::from_engine);
                let rust_encode_ms = timer.elapsed_ms();
                result.map(|payload| (payload, rust_encode_ms))
            },
        )?;
        self.view_revision_wire_measurement.record(
            ViewRevisionWire::Ritorb1,
            payload.len(),
            rust_encode_ms,
        );
        Ok(payload)
    }

    fn initial_frame_window(
        &mut self,
        revision: &RuntimeRevisionHandle,
        initial_frame: Option<&RuntimeInitialFrameDecision>,
        excluded_transfer_count: usize,
    ) -> Result<Option<WasmPlannedFrameResourcePrefetchResponse>, WasmRuntimeError> {
        let Some(initial_frame) = initial_frame else {
            return Ok(None);
        };
        let mut plan = self
            .document
            .frame_resource_warm_plan_at(revision, initial_frame.spread_index)
            .map_err(WasmRuntimeError::from_revision_access)?
            .value;
        plan.display_spread_index = initial_frame.display_spread_index;
        let mut spreads = Vec::new();
        for spread_index in plan.spread_indexes.clone() {
            let mut spread = self.prefetch_frame_resources_at(revision, spread_index)?;
            spread.pending_transfer_count = spread
                .pending_transfer_count
                .checked_sub(excluded_transfer_count)
                .ok_or_else(invalid_excluded_transfer_count)?;
            spreads.push(spread);
        }
        Ok(Some(WasmPlannedFrameResourcePrefetchResponse {
            plan,
            spreads,
            pending_transfer_count: self
                .pending_resource_transfer_count()
                .checked_sub(excluded_transfer_count)
                .ok_or_else(invalid_excluded_transfer_count)?,
        }))
    }
}

fn invalid_excluded_transfer_count() -> WasmRuntimeError {
    WasmRuntimeError::internal_error(
        "previous revision transfer count exceeded the pending transfer count",
    )
}

fn frame_selection(initial_frame: &RuntimeInitialFrameDecision) -> WasmRevisionFrameSelection {
    WasmRevisionFrameSelection {
        spread_index: initial_frame.spread_index,
        display_spread_index: initial_frame.display_spread_index,
    }
}
