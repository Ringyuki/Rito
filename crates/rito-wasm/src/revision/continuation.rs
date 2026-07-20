use crate::{
    wire::{
        parse_bounded_revision_request, parse_calibrate_revision_font_vertical_metrics_request,
        parse_cancel_revision_request, parse_continue_revision_request,
        parse_continue_revision_toward_source_locator_request, serialize_json,
    },
    WasmRuntimeDocument, WasmRuntimeError,
};
use rito_core::runtime::{
    RuntimeContinuationErrorKind, RuntimeRevisionAdvance,
    RuntimeRevisionFontVerticalMetricCalibration, RuntimeRevisionHandle, RuntimeRevisionStatus,
    RuntimeRevisionSummary, RuntimeSourceLocator, RuntimeSourceLocatorPendingReason,
    RuntimeSourceLocatorResolution,
};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmRevisionAdvanceTowardSourceLocator {
    advance: RuntimeRevisionAdvance,
    released_revision: RuntimeRevisionHandle,
    released_transfer_count: usize,
    request: RuntimeSourceLocator,
    canonical_request: RuntimeSourceLocator,
    locator_outcome: WasmSourceLocatorAdvanceOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmRevisionFontVerticalMetricCalibration {
    #[serde(flatten)]
    calibration: RuntimeRevisionFontVerticalMetricCalibration,
    released_revision: RuntimeRevisionHandle,
    released_transfer_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum WasmSourceLocatorAdvanceOutcome {
    Resolved {
        resolution: RuntimeSourceLocatorResolution,
    },
    Failed {
        code: crate::WasmRuntimeErrorCode,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        revision: Option<RuntimeRevisionSummary>,
    },
}

impl WasmRuntimeDocument {
    /// Starts the experimental, bounded Rust revision path.
    pub fn create_bounded_revision_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_bounded_revision_request(request_json)?;
        let advance = self
            .document
            .create_bounded_revision(request)
            .map_err(WasmRuntimeError::from_continuation)?;
        let revision = rito_core::runtime::RuntimeRevisionHandle::from(&advance.revision);
        self.finish_created_revision_transport(revision, None, move |_, _, _| {
            serialize_json(&advance)
        })
    }

    /// Consumes one version-bound continuation cursor.
    pub fn continue_revision_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_continue_revision_request(request_json)?;
        let advance = self
            .document
            .continue_revision(request)
            .map_err(WasmRuntimeError::from_continuation)?;
        serialize_json(&advance)
    }

    /// Applies exact browser-measured interaction boxes without repagination.
    pub fn calibrate_revision_font_vertical_metrics_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_calibrate_revision_font_vertical_metrics_request(request_json)?;
        let released_revision =
            RuntimeRevisionHandle::new(&request.revision_id, request.revision_version);
        let calibration = self
            .document
            .calibrate_revision_font_vertical_metrics(request)
            .map_err(WasmRuntimeError::from_continuation)?;
        let released_transfer_count = self.transfers.release_revision_at(&released_revision);
        serialize_json(&WasmRevisionFontVerticalMetricCalibration {
            calibration,
            released_revision,
            released_transfer_count,
        })
    }

    /// Advances one bounded quantum and resolves a source locator without a
    /// browser-to-worker round trip between the mutation and the exact read.
    pub fn continue_revision_toward_source_locator_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_continue_revision_toward_source_locator_request(request_json)?;
        let released_revision = RuntimeRevisionHandle::new(
            &request.continuation.revision_id,
            request.continuation.revision_version,
        );
        let original_locator = request.locator;
        let canonical_locator = self
            .preflight_source_locator_continuation(&released_revision, original_locator.clone())?;
        let advance = match self.document.continue_revision(request.continuation) {
            Ok(advance) => advance,
            Err(error) => {
                if continuation_error_committed_next_revision(&error, &released_revision) {
                    self.transfers.release_revision_at(&released_revision);
                }
                return Err(WasmRuntimeError::from_continuation(error));
            }
        };
        let released_transfer_count = self.transfers.release_revision_at(&released_revision);
        let next_revision = RuntimeRevisionHandle::from(&advance.revision);
        let locator_outcome = match self
            .document
            .resolve_source_locator_at(&next_revision, canonical_locator.clone())
            .map_err(WasmRuntimeError::from_revision_access)
        {
            Ok(resolution) => WasmSourceLocatorAdvanceOutcome::Resolved {
                resolution: resolution.value,
            },
            Err(error) => source_locator_failure(error),
        };
        serialize_json(&WasmRevisionAdvanceTowardSourceLocator {
            advance,
            released_revision,
            released_transfer_count,
            request: original_locator,
            canonical_request: canonical_locator,
            locator_outcome,
        })
    }

    fn preflight_source_locator_continuation(
        &mut self,
        revision: &RuntimeRevisionHandle,
        locator: RuntimeSourceLocator,
    ) -> Result<RuntimeSourceLocator, WasmRuntimeError> {
        let preflight = self
            .document
            .resolve_source_locator_at(revision, locator)
            .map_err(WasmRuntimeError::from_revision_access)?;
        match preflight.value {
            RuntimeSourceLocatorResolution::Pending {
                locator,
                reason: RuntimeSourceLocatorPendingReason::NotPaginated,
                ..
            } => Ok(locator),
            _ => Err(WasmRuntimeError::bad_request(
                "source locator continuation requires a locator pending pagination",
            )),
        }
    }

    /// Cancels a bounded revision at its current version.
    pub fn cancel_revision_json(&mut self, request_json: &str) -> Result<String, WasmRuntimeError> {
        let request = parse_cancel_revision_request(request_json)?;
        let revision = self
            .document
            .cancel_revision(request)
            .map_err(WasmRuntimeError::from_continuation)?;
        serialize_json(&revision)
    }

    /// Returns control-plane state only; frames and interactions remain gated.
    pub fn get_revision_summary_json(&self, revision_id: &str) -> Result<String, WasmRuntimeError> {
        let revision = self
            .document
            .get_revision_summary(revision_id)
            .map_err(WasmRuntimeError::from_continuation)?;
        serialize_json(&revision)
    }
}

fn continuation_error_committed_next_revision(
    error: &rito_core::runtime::RuntimeContinuationError,
    previous: &RuntimeRevisionHandle,
) -> bool {
    let Some(next_version) = previous.revision_version.checked_add(1) else {
        return false;
    };
    error.kind == RuntimeContinuationErrorKind::EngineFailure
        && error.revision.as_deref().is_some_and(|revision| {
            revision.status == RuntimeRevisionStatus::Failed
                && revision.revision_id == previous.revision_id
                && revision.revision_version == next_version
        })
}

fn source_locator_failure(error: WasmRuntimeError) -> WasmSourceLocatorAdvanceOutcome {
    WasmSourceLocatorAdvanceOutcome::Failed {
        code: error.code(),
        message: error.message().to_owned(),
        revision: error.revision().cloned(),
    }
}

#[cfg(test)]
mod tests {
    use rito_core::runtime::{
        RuntimeContinuationError, RuntimeContinuationErrorKind, RuntimeRevisionExtent,
        RuntimeRevisionStatus, RuntimeRevisionSummary,
    };
    use serde_json::json;

    use super::{source_locator_failure, WasmSourceLocatorAdvanceOutcome};
    use crate::{wire::serialize_json, WasmRuntimeError};

    #[test]
    fn locator_failure_preserves_a_committed_failed_revision() {
        let revision = RuntimeRevisionSummary {
            revision_id: "rev-9".to_owned(),
            revision_version: 3,
            layout_key: "layout".to_owned(),
            status: RuntimeRevisionStatus::Failed,
            known_extent: RuntimeRevisionExtent {
                page_count: 2,
                spread_count: 2,
            },
            final_extent: None,
            page_count: 2,
            spread_count: 2,
        };
        let outcome = source_locator_failure(WasmRuntimeError::from_continuation(
            RuntimeContinuationError {
                kind: RuntimeContinuationErrorKind::EngineFailure,
                message: "post-read failed".to_owned(),
                revision: Some(Box::new(revision)),
            },
        ));

        assert!(matches!(
            &outcome,
            WasmSourceLocatorAdvanceOutcome::Failed { .. }
        ));
        let value: serde_json::Value =
            serde_json::from_str(&serialize_json(&outcome).expect("locator failure serializes"))
                .expect("locator failure JSON parses");
        assert_eq!(value["kind"], "failed");
        assert_eq!(value["code"], "engine-error");
        assert_eq!(value["message"], "post-read failed");
        assert_eq!(
            value["revision"],
            json!({
                "revisionId": "rev-9",
                "revisionVersion": 3,
                "layoutKey": "layout",
                "status": "failed",
                "knownExtent": { "pageCount": 2, "spreadCount": 2 },
                "pageCount": 2,
                "spreadCount": 2,
            })
        );
    }
}
