use crate::runtime::frame::revision_summary;

use super::{
    metadata::layout_key, RuntimeBoundedRevisionRequest, RuntimeCancelRevisionRequest,
    RuntimeContinuationError, RuntimeContinuationErrorKind, RuntimeContinueRevisionRequest,
    RuntimeDocument, RuntimeRevisionAdvance, RuntimeRevisionStatus, RuntimeRevisionSummary,
};

mod chapter_local;
mod cleanup;
mod error;
mod font_vertical_metrics;
mod publish;
mod state;
mod work;

pub(in crate::runtime) use cleanup::{
    PendingRuntimeChapterContinuationCleanup, PendingRuntimeContinuationRecordCleanup,
    PendingRuntimeContinuationWorkCleanup,
};
use error::{
    checked_budget, continuation_error, engine_error, engine_error_with_revision, unknown_revision,
};
pub(in crate::runtime) use state::{
    RuntimeChapterContinuation, RuntimeContinuationRecord, RuntimeContinuationStore,
    RuntimeContinuationWork,
};

impl RuntimeDocument {
    /// Starts the experimental core-only bounded revision path.
    ///
    /// Foreground admission indexes only each chapter as it is started. The
    /// publication-wide cross-chapter index is a separate cooperative stream;
    /// Reader-v1 completes that stream before publishing a background layout.
    pub fn create_bounded_revision(
        &mut self,
        request: RuntimeBoundedRevisionRequest,
    ) -> Result<RuntimeRevisionAdvance, RuntimeContinuationError> {
        self.create_fragment_bounded_revision(request)
    }

    /// The fragment-only bounded path: the whole book paginates in one
    /// step and the advance arrives already complete, with no
    /// continuation to drive. Progressive per-chapter publication is the
    /// planned optimization on top of this.
    fn create_fragment_bounded_revision(
        &mut self,
        request: RuntimeBoundedRevisionRequest,
    ) -> Result<RuntimeRevisionAdvance, RuntimeContinuationError> {
        // The whole book paginates in one step, but the request contract
        // still requires a positive budget.
        checked_budget(request.budget)?;
        let summary = self
            .create_revision_with_line_breaking(&request.layout_config, request.line_breaking)
            .map_err(|error| {
                super::continuation::error::continuation_error(
                    crate::runtime::RuntimeContinuationErrorKind::EngineFailure,
                    error.message().to_owned(),
                )
            })?;
        Ok(RuntimeRevisionAdvance {
            previous_known_extent: crate::runtime::RuntimeRevisionExtent {
                page_count: 0,
                spread_count: 0,
            },
            newly_known_pages: crate::runtime::RuntimeRevisionPageRange {
                start_page: 0,
                end_page_exclusive: summary.known_extent.page_count,
            },
            processed_top_level_nodes: 0,
            continuation: None,
            revision: summary,
        })
    }

    pub fn continue_revision(
        &mut self,
        request: RuntimeContinueRevisionRequest,
    ) -> Result<RuntimeRevisionAdvance, RuntimeContinuationError> {
        let budget = checked_budget(request.budget)?;
        let previous_extent =
            self.require_continuable_revision(&request.revision_id, request.revision_version)?;
        let mut continuation = self.take_continuation(&request)?;
        let next_version = continuation.revision_version;
        let layout_key = continuation.layout_key.clone();
        let work = match self.advance_record(&mut continuation, budget) {
            Ok(work) => work,
            Err(error) => {
                self.cleanup_queue.enqueue_continuation(continuation);
                let revision =
                    self.mark_revision_failed(&request.revision_id, next_version, &layout_key);
                self.service_cleanup_queue();
                return Err(engine_error_with_revision(error, revision));
            }
        };
        self.apply_work(
            continuation,
            work,
            previous_extent,
            next_version,
            &layout_key,
        )
    }

    fn take_continuation(
        &mut self,
        request: &RuntimeContinueRevisionRequest,
    ) -> Result<RuntimeContinuationRecord, RuntimeContinuationError> {
        let continuation = self.continuations.get(&request.cursor).ok_or_else(|| {
            continuation_error(
                RuntimeContinuationErrorKind::UnknownCursor,
                format!(
                    "unknown or consumed continuation cursor: {}",
                    request.cursor
                ),
            )
        })?;
        if continuation.revision_id != request.revision_id
            || continuation.revision_version != request.revision_version
        {
            return Err(continuation_error(
                RuntimeContinuationErrorKind::CursorOwnerMismatch,
                "continuation cursor does not belong to the requested revision version",
            ));
        }
        let next_version = request.revision_version.checked_add(1).ok_or_else(|| {
            continuation_error(
                RuntimeContinuationErrorKind::RevisionNotContinuable,
                "revision version overflow",
            )
        })?;
        let mut continuation = self
            .continuations
            .take_exact(&request.revision_id, &request.cursor);
        continuation.revision_version = next_version;
        Ok(continuation)
    }

    pub fn cancel_revision(
        &mut self,
        request: RuntimeCancelRevisionRequest,
    ) -> Result<RuntimeRevisionSummary, RuntimeContinuationError> {
        self.require_continuable_revision(&request.revision_id, request.revision_version)?;
        let next_version = request.revision_version.checked_add(1).ok_or_else(|| {
            continuation_error(
                RuntimeContinuationErrorKind::RevisionNotContinuable,
                "revision version overflow",
            )
        })?;
        let key = {
            let revision = self
                .revisions
                .get(&request.revision_id)
                .expect("revision was validated");
            layout_key(&revision.layout_config, &self.pinned_font_policy).map_err(engine_error)?
        };
        if let Some(continuation) = self.continuations.remove_revision(&request.revision_id) {
            self.cleanup_queue.enqueue_continuation(continuation);
        }
        let frame_cache = {
            let revision = self
                .revisions
                .get_mut(&request.revision_id)
                .expect("revision was validated");
            revision.revision_version = next_version;
            revision.status = RuntimeRevisionStatus::Cancelled;
            revision.final_extent = None;
            revision.take_frame_cache()
        };
        self.cleanup_queue.enqueue_frame_cache(frame_cache);
        let summary = revision_summary(
            &request.revision_id,
            &key,
            self.revisions
                .get(&request.revision_id)
                .expect("cancelled revision remains available"),
        );
        self.service_cleanup_queue();
        Ok(summary)
    }

    pub fn get_revision_summary(
        &self,
        revision_id: &str,
    ) -> Result<RuntimeRevisionSummary, RuntimeContinuationError> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| unknown_revision(revision_id))?;
        let key =
            layout_key(&revision.layout_config, &self.pinned_font_policy).map_err(engine_error)?;
        Ok(revision_summary(revision_id, &key, revision))
    }
}
