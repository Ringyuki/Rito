use crate::{
    layout::create_empty_runtime_layout,
    runtime::frame::{revision_summary, RuntimeRevision},
};

use super::{
    metadata::layout_key, RuntimeBoundedRevisionRequest, RuntimeCancelRevisionRequest,
    RuntimeContinuationError, RuntimeContinuationErrorKind, RuntimeContinueRevisionRequest,
    RuntimeDocument, RuntimeRevisionAdvance, RuntimeRevisionExtent, RuntimeRevisionStatus,
    RuntimeRevisionSummary,
};

mod error;
mod publish;
mod state;
mod work;

use error::{
    checked_budget, continuation_error, engine_error, engine_error_with_revision, unknown_revision,
};
use publish::initial_revision_interactions;
pub(in crate::runtime) use state::RuntimeContinuationRecord;

impl RuntimeDocument {
    /// Starts the experimental core-only bounded revision path.
    ///
    /// The first bounded revision for a document pays for a publication-wide,
    /// two-pass XHTML footnote scan. The resulting target/definition index is
    /// cached without materializing lazy chapter or binary-resource state.
    pub fn create_bounded_revision(
        &mut self,
        request: RuntimeBoundedRevisionRequest,
    ) -> Result<RuntimeRevisionAdvance, RuntimeContinuationError> {
        let budget = checked_budget(request.budget)?;
        let (continuation, layout_key) = self.initialize_bounded_revision(request)?;
        self.advance_initial_revision(continuation, budget, &layout_key)
    }

    fn initialize_bounded_revision(
        &mut self,
        request: RuntimeBoundedRevisionRequest,
    ) -> Result<(RuntimeContinuationRecord, String), RuntimeContinuationError> {
        let revision_id = self.create_revision_id();
        let layout_key =
            layout_key(&request.layout_config, &self.pinned_font_policy).map_err(engine_error)?;
        let footnotes = self
            .publication_footnote_index()
            .map_err(engine_error)?
            .footnotes
            .clone();
        let layout =
            create_empty_runtime_layout(self.document.chapters.len(), &request.layout_config);
        let revision = RuntimeRevision::warming(
            layout,
            request.layout_config.clone(),
            initial_revision_interactions(footnotes),
        );
        self.revisions.insert(revision_id.clone(), revision);
        if let Err(error) = self.ensure_layout_font_resources(&request.layout_config) {
            self.revisions.remove(&revision_id);
            return Err(engine_error(error));
        }
        let continuation = RuntimeContinuationRecord::new(
            revision_id,
            layout_key.clone(),
            request.layout_config,
            request.line_breaking,
            self.document.chapters.len(),
        );
        Ok((continuation, layout_key))
    }

    fn advance_initial_revision(
        &mut self,
        mut continuation: RuntimeContinuationRecord,
        budget: std::num::NonZeroUsize,
        layout_key: &str,
    ) -> Result<RuntimeRevisionAdvance, RuntimeContinuationError> {
        let revision_id = continuation.revision_id.clone();
        let work = match self.advance_record(&mut continuation, budget) {
            Ok(work) => work,
            Err(error) => {
                self.revisions.remove(&revision_id);
                return Err(engine_error(error));
            }
        };
        self.apply_work(
            continuation,
            work,
            RuntimeRevisionExtent {
                page_count: 0,
                spread_count: 0,
            },
            0,
            layout_key,
        )
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
                let revision =
                    self.mark_revision_failed(&request.revision_id, next_version, &layout_key);
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
            .remove(&request.cursor)
            .expect("validated continuation cursor exists");
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
        self.continuations
            .retain(|_, continuation| continuation.revision_id != request.revision_id);
        let revision = self
            .revisions
            .get_mut(&request.revision_id)
            .expect("revision was validated");
        revision.revision_version = next_version;
        revision.status = RuntimeRevisionStatus::Cancelled;
        revision.final_extent = None;
        revision.clear_frame_cache();
        let key =
            layout_key(&revision.layout_config, &self.pinned_font_policy).map_err(engine_error)?;
        Ok(revision_summary(&request.revision_id, &key, revision))
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

    #[cfg(test)]
    pub(super) fn continuation_unpublished_page_count(&self, cursor: &str) -> Option<usize> {
        self.continuations
            .get(cursor)
            .and_then(|continuation| continuation.current.as_ref())
            .map(|chapter| chapter.unpublished_pages.len())
    }
}
