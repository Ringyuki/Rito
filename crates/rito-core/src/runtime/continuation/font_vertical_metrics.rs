use crate::{
    layout::{
        calibrate_layout_font_vertical_metrics, merge_font_vertical_metric_samples,
        normalize_font_vertical_metric_samples,
    },
    runtime::{
        frame::revision_summary, metadata::layout_key,
        RuntimeCalibrateRevisionFontVerticalMetricsRequest, RuntimeContinuationError,
        RuntimeContinuationErrorKind, RuntimeDocument,
        RuntimeRevisionFontVerticalMetricCalibration, RuntimeRevisionStatus,
    },
};

use super::{
    error::{continuation_error, unknown_revision},
    state::RuntimeContinuationRecord,
};

impl RuntimeDocument {
    pub fn calibrate_revision_font_vertical_metrics(
        &mut self,
        request: RuntimeCalibrateRevisionFontVerticalMetricsRequest,
    ) -> Result<RuntimeRevisionFontVerticalMetricCalibration, RuntimeContinuationError> {
        let samples = validated_samples(&request)?;
        let next_version = self.validate_calibration_request(&request)?;
        let layout_identity = {
            let revision = self
                .revisions
                .get(&request.revision_id)
                .expect("calibration revision was validated");
            layout_key(&revision.layout_config, &self.pinned_font_policy)
                .map_err(super::error::engine_error)?
        };
        let mut continuation = self.take_calibration_continuation(&request, next_version);
        let calibrated_unpublished_run_count = continuation
            .as_mut()
            .map(|continuation| calibrate_continuation(continuation, &samples))
            .unwrap_or(0);
        let (revision, calibrated_published_run_count) = {
            let revision = self
                .revisions
                .get_mut(&request.revision_id)
                .expect("calibration revision remains available");
            merge_font_vertical_metric_samples(
                &mut revision.layout_config.font_vertical_metrics,
                &samples,
            );
            let calibrated =
                calibrate_layout_font_vertical_metrics(&mut revision.layout.pages, &samples);
            revision.revision_version = next_version;
            (
                revision_summary(&request.revision_id, &layout_identity, revision),
                calibrated,
            )
        };
        let continuation = continuation.map(|continuation| self.store_continuation(continuation));
        debug_assert_eq!(
            layout_identity,
            layout_key(
                &self
                    .revisions
                    .get(&request.revision_id)
                    .expect("calibrated revision exists")
                    .layout_config,
                &self.pinned_font_policy,
            )
            .expect("calibrated layout key remains serializable"),
        );
        Ok(RuntimeRevisionFontVerticalMetricCalibration {
            revision,
            continuation,
            calibrated_published_run_count,
            calibrated_unpublished_run_count,
        })
    }

    fn validate_calibration_request(
        &self,
        request: &RuntimeCalibrateRevisionFontVerticalMetricsRequest,
    ) -> Result<u32, RuntimeContinuationError> {
        let revision = self
            .revisions
            .get(&request.revision_id)
            .ok_or_else(|| unknown_revision(&request.revision_id))?;
        if revision.revision_version != request.revision_version {
            return Err(continuation_error(
                RuntimeContinuationErrorKind::StaleRevisionVersion,
                format!(
                    "stale revision version: expected {}, got {}",
                    revision.revision_version, request.revision_version
                ),
            ));
        }
        if matches!(
            revision.status,
            RuntimeRevisionStatus::Cancelled | RuntimeRevisionStatus::Failed
        ) {
            return Err(continuation_error(
                RuntimeContinuationErrorKind::RevisionNotContinuable,
                format!(
                    "revision cannot accept font calibration: {:?}",
                    revision.status
                ),
            ));
        }
        if request.continuation.is_some() && self.next_continuation_index == usize::MAX {
            return Err(continuation_error(
                RuntimeContinuationErrorKind::RevisionNotContinuable,
                "continuation cursor id space is exhausted",
            ));
        }
        self.validate_calibration_cursor(request)?;
        request.revision_version.checked_add(1).ok_or_else(|| {
            continuation_error(
                RuntimeContinuationErrorKind::RevisionNotContinuable,
                "revision version overflow",
            )
        })
    }

    fn validate_calibration_cursor(
        &self,
        request: &RuntimeCalibrateRevisionFontVerticalMetricsRequest,
    ) -> Result<(), RuntimeContinuationError> {
        let active_cursor = self.continuations.cursor_for_revision(&request.revision_id);
        let Some(requested) = request.continuation.as_ref() else {
            return if active_cursor.is_none() {
                Ok(())
            } else {
                Err(continuation_error(
                    RuntimeContinuationErrorKind::CursorOwnerMismatch,
                    "active revision calibration requires its continuation cursor",
                ))
            };
        };
        let continuation = self.continuations.get(&requested.cursor).ok_or_else(|| {
            continuation_error(
                RuntimeContinuationErrorKind::UnknownCursor,
                format!(
                    "unknown or consumed continuation cursor: {}",
                    requested.cursor
                ),
            )
        })?;
        if requested.revision_id != request.revision_id
            || requested.revision_version != request.revision_version
            || continuation.revision_id != request.revision_id
            || continuation.revision_version != request.revision_version
            || active_cursor != Some(requested.cursor.as_str())
        {
            return Err(continuation_error(
                RuntimeContinuationErrorKind::CursorOwnerMismatch,
                "continuation cursor does not belong to the calibrated revision version",
            ));
        }
        Ok(())
    }

    fn take_calibration_continuation(
        &mut self,
        request: &RuntimeCalibrateRevisionFontVerticalMetricsRequest,
        next_version: u32,
    ) -> Option<RuntimeContinuationRecord> {
        let requested = request.continuation.as_ref()?;
        let mut continuation = self
            .continuations
            .take_exact(&request.revision_id, &requested.cursor);
        continuation.revision_version = next_version;
        Some(continuation)
    }
}

fn validated_samples(
    request: &RuntimeCalibrateRevisionFontVerticalMetricsRequest,
) -> Result<Vec<crate::layout::FontVerticalMetricSample>, RuntimeContinuationError> {
    if request.font_vertical_metrics.is_empty() {
        return Err(continuation_error(
            RuntimeContinuationErrorKind::EngineFailure,
            "fontVerticalMetrics must not be empty",
        ));
    }
    normalize_font_vertical_metric_samples(&request.font_vertical_metrics).ok_or_else(|| {
        continuation_error(
            RuntimeContinuationErrorKind::EngineFailure,
            "fontVerticalMetrics contains an invalid sample",
        )
    })
}

fn calibrate_continuation(
    continuation: &mut RuntimeContinuationRecord,
    samples: &[crate::layout::FontVerticalMetricSample],
) -> usize {
    merge_font_vertical_metric_samples(
        &mut continuation.layout_config.font_vertical_metrics,
        samples,
    );
    continuation
        .current
        .as_mut()
        .map(|current| {
            calibrate_layout_font_vertical_metrics(&mut current.unpublished_pages, samples)
        })
        .unwrap_or(0)
}
