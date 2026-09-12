use crate::runtime::frame::{revision_summary, RuntimeRevision};

use super::{
    metadata::layout_key, RuntimeBoundedRevisionRequest, RuntimeCancelRevisionRequest,
    RuntimeContinuationError, RuntimeContinuationErrorKind, RuntimeContinueRevisionRequest,
    RuntimeDocument, RuntimeRevisionAdvance, RuntimeRevisionCursor, RuntimeRevisionExtent,
    RuntimeRevisionStatus, RuntimeRevisionSummary,
};

mod chapter_local;
mod cleanup;
mod error;
mod font_vertical_metrics;
mod state;

pub(in crate::runtime) use cleanup::PendingRuntimeContinuationRecordCleanup;
use error::{checked_budget, continuation_error, engine_error, unknown_revision};
pub(in crate::runtime) use state::{RuntimeContinuationRecord, RuntimeContinuationStore};

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

    /// Every revision now paginates in one step, so no cursor can ever be
    /// live; the request is still validated so a host learns exactly why
    /// its cursor is spent.
    pub fn continue_revision(
        &mut self,
        request: RuntimeContinueRevisionRequest,
    ) -> Result<RuntimeRevisionAdvance, RuntimeContinuationError> {
        checked_budget(request.budget)?;
        self.require_continuable_revision(&request.revision_id, request.revision_version)?;
        let continuation = self.take_continuation(&request)?;
        self.cleanup_queue.enqueue_continuation(continuation);
        self.service_cleanup_queue();
        Err(continuation_error(
            RuntimeContinuationErrorKind::RevisionNotContinuable,
            "the revision paginated in one step; there is nothing to continue",
        ))
    }

    pub(super) fn store_continuation(
        &mut self,
        continuation: RuntimeContinuationRecord,
    ) -> RuntimeRevisionCursor {
        let cursor = format!("cursor-{}", self.next_continuation_index);
        let Some(next_continuation_index) = self.next_continuation_index.checked_add(1) else {
            PendingRuntimeContinuationRecordCleanup::new(continuation).drain();
            panic!("runtime continuation id space is exhausted");
        };
        self.next_continuation_index = next_continuation_index;
        let handle = RuntimeRevisionCursor {
            revision_id: continuation.revision_id.clone(),
            revision_version: continuation.revision_version,
            cursor: cursor.clone(),
        };
        self.continuations.insert_new(cursor, continuation);
        handle
    }
    pub(super) fn require_continuable_revision(
        &self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<RuntimeRevisionExtent, RuntimeContinuationError> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| unknown_revision(revision_id))?;
        require_revision_version(revision, revision_version)?;
        require_active_status(revision)?;
        Ok(revision.known_extent)
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

fn require_revision_version(
    revision: &RuntimeRevision,
    revision_version: u32,
) -> Result<(), RuntimeContinuationError> {
    if revision.revision_version == revision_version {
        return Ok(());
    }
    Err(continuation_error(
        RuntimeContinuationErrorKind::StaleRevisionVersion,
        format!(
            "stale revision version: expected {}, got {revision_version}",
            revision.revision_version
        ),
    ))
}

fn require_active_status(revision: &RuntimeRevision) -> Result<(), RuntimeContinuationError> {
    if matches!(
        revision.status,
        RuntimeRevisionStatus::Warming | RuntimeRevisionStatus::Ready
    ) {
        return Ok(());
    }
    Err(continuation_error(
        RuntimeContinuationErrorKind::RevisionNotContinuable,
        format!("revision is not continuable: {:?}", revision.status),
    ))
}
