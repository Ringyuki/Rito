use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    sync::Arc,
};

use crate::{
    interaction::FootnoteEntry,
    layout::create_empty_runtime_layout,
    runtime::frame::{revision_summary, RuntimeRevision},
};

use super::{
    metadata::layout_key, RuntimeBoundedRevisionRequest, RuntimeCancelRevisionRequest,
    RuntimeContinuationError, RuntimeContinuationErrorKind, RuntimeContinueRevisionRequest,
    RuntimeDocument, RuntimeRequiredFontFace, RuntimeRevisionAdvance, RuntimeRevisionExtent,
    RuntimeRevisionStatus, RuntimeRevisionSummary, RuntimeRevisionWorkBudget,
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
use publish::initial_revision_interactions;
pub(in crate::runtime) use state::{
    RuntimeChapterContinuation, RuntimeContinuationRecord, RuntimeContinuationStore,
    RuntimeContinuationWork,
};

struct BoundedRevisionPreflight {
    budget: NonZeroUsize,
    revision_id: String,
    layout_key: String,
    publication_footnotes: Option<Arc<BTreeMap<String, FootnoteEntry>>>,
    pending_footnote_keys: BTreeSet<String>,
    footnote_index_complete: bool,
    required_font_face_catalog: Option<Vec<RuntimeRequiredFontFace>>,
}

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
        let (continuation, layout_key, budget) = self.initialize_bounded_revision(request)?;
        self.advance_initial_revision(continuation, budget, &layout_key)
    }

    fn initialize_bounded_revision(
        &mut self,
        request: RuntimeBoundedRevisionRequest,
    ) -> Result<(RuntimeContinuationRecord, String, NonZeroUsize), RuntimeContinuationError> {
        let RuntimeBoundedRevisionRequest {
            layout_config,
            line_breaking,
            budget,
        } = request;
        let (layout_config, preflight) = self
            .run_with_owned_layout_config(layout_config, |document, layout_config| {
                document.preflight_bounded_revision(layout_config, budget)
            })?;
        let layout = create_empty_runtime_layout(self.document.chapters.len(), &layout_config);
        let BoundedRevisionPreflight {
            budget,
            revision_id,
            layout_key,
            publication_footnotes,
            pending_footnote_keys,
            footnote_index_complete,
            required_font_face_catalog,
        } = preflight;
        let mut interactions = initial_revision_interactions(BTreeMap::new());
        interactions.publication_footnotes = publication_footnotes;
        interactions.pending_footnote_keys =
            crate::interaction::FootnoteTargetSet::new(pending_footnote_keys);
        interactions.footnote_index_complete = footnote_index_complete;
        let revision = RuntimeRevision::warming(
            layout,
            layout_config.clone(),
            required_font_face_catalog,
            interactions,
        );
        self.insert_new_revision(revision_id.clone(), revision);
        let continuation = RuntimeContinuationRecord::new(
            revision_id,
            layout_key.clone(),
            layout_config,
            line_breaking,
            self.document.chapters.len(),
        );
        Ok((continuation, layout_key, budget))
    }

    fn preflight_bounded_revision(
        &mut self,
        layout_config: &crate::layout::LayoutConfig,
        budget: RuntimeRevisionWorkBudget,
    ) -> Result<BoundedRevisionPreflight, RuntimeContinuationError> {
        let budget = checked_budget(budget)?;
        let revision_id = self.create_revision_id();
        let layout_key =
            layout_key(layout_config, &self.pinned_font_policy).map_err(engine_error)?;
        self.ensure_layout_font_resources(layout_config)
            .map_err(engine_error)?;
        let required_font_face_catalog = self.required_font_face_catalog_for_layout(layout_config);
        let (publication_footnotes, pending_footnote_keys, footnote_index_complete) =
            self.publication_footnote_snapshot();
        Ok(BoundedRevisionPreflight {
            budget,
            revision_id,
            layout_key,
            publication_footnotes,
            pending_footnote_keys,
            footnote_index_complete,
            required_font_face_catalog,
        })
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
                self.cleanup_queue.enqueue_continuation(continuation);
                if let Some(revision) = self.revisions.remove(&revision_id) {
                    self.cleanup_queue.enqueue_revision(revision);
                }
                self.service_cleanup_queue();
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

    #[cfg(test)]
    pub(super) fn continuation_unpublished_page_count(&self, cursor: &str) -> Option<usize> {
        self.continuations
            .get(cursor)
            .and_then(|continuation| continuation.current.as_ref())
            .map(|chapter| chapter.unpublished_pages.len())
    }

    #[cfg(test)]
    pub(super) fn continuation_open_page_block_count(&self, cursor: &str) -> Option<usize> {
        self.continuations
            .get(cursor)
            .and_then(|continuation| continuation.current.as_ref())
            .map(|chapter| chapter.session.open_page_block_count())
    }
}
