use std::num::NonZeroUsize;

use crate::{
    epub::{EpubError, EpubResult},
    runtime::{
        RuntimeChapterLocalCoordinate, RuntimeChapterLocalPageRange,
        RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionCursor,
        RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionExtent,
        RuntimeContinuationErrorKind, RuntimeDocument, RuntimeRevisionStatus, RuntimeSourceLocator,
        RuntimeSourceLocatorResolution,
    },
};

use super::{
    super::{
        publish::{append_work_to_revision, update_revision_publication},
        RuntimeContinuationRecord, RuntimeContinuationWork,
    },
    model::{
        chapter_local_owner, chapter_local_summary, local_engine_error, local_locator_resolution,
        local_unknown_revision, mark_local_page_cap,
    },
};

/// Meter totals for one packed chapter-local request whose page batches were
/// already appended to the live revision.
pub(super) struct AppendedChapterLocalWork {
    pub(super) processed_top_level_nodes: usize,
    pub(super) complete: bool,
}

impl RuntimeDocument {
    pub(super) fn advance_initial_chapter_local(
        &mut self,
        mut record: RuntimeContinuationRecord,
        budget: NonZeroUsize,
        max_quanta: NonZeroUsize,
        coordinate: RuntimeChapterLocalCoordinate,
        target_locator: RuntimeSourceLocator,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionError> {
        let revision_id = record.revision_id.clone();
        let appended =
            match self.advance_local_quanta(&mut record, budget, max_quanta, &target_locator) {
                Ok(appended) => appended,
                Err(error) => {
                    self.retire_failed_initial_local_revision(record, &revision_id);
                    return Err(local_engine_error(error));
                }
            };
        let page_cap_reached = record.reached_local_page_cap() && !record.is_complete();
        self.apply_chapter_local_work(
            record,
            appended,
            RuntimeChapterLocalRevisionExtent {
                local_page_count: 0,
                local_spread_count: 0,
            },
            0,
            page_cap_reached,
            target_locator,
        )
        .inspect(|advance| {
            debug_assert_eq!(advance.revision.coordinate, coordinate);
        })
    }

    /// Runs up to `max_quanta` bounded meters, appending each meter's pages to
    /// the live revision, and stops early the moment the target locator
    /// resolves inside the appended extent. Publication metadata (version,
    /// status, known extent) is deliberately not updated here; the caller
    /// publishes exactly once for the whole request.
    pub(super) fn advance_local_quanta(
        &mut self,
        record: &mut RuntimeContinuationRecord,
        budget: NonZeroUsize,
        max_quanta: NonZeroUsize,
        target_locator: &RuntimeSourceLocator,
    ) -> EpubResult<AppendedChapterLocalWork> {
        let revision_id = record.revision_id.clone();
        let mut appended = AppendedChapterLocalWork {
            processed_top_level_nodes: 0,
            complete: false,
        };
        for quantum in 0..max_quanta.get() {
            // A meter that reports no new nodes or pages can still have done
            // real line/shaping work inside an open block, so every quantum
            // runs to the cap unless a hard boundary or the target stops it.
            let work = self.advance_record(record, budget)?;
            appended.processed_top_level_nodes += work.processed_top_level_nodes;
            appended.complete = work.complete;
            self.append_local_quantum_work(&revision_id, work)?;
            if appended.complete
                || record.reached_local_page_cap()
                || quantum + 1 == max_quanta.get()
                || self.local_target_resolves(&revision_id, target_locator)
            {
                break;
            }
        }
        Ok(appended)
    }

    fn append_local_quantum_work(
        &mut self,
        revision_id: &str,
        work: RuntimeContinuationWork,
    ) -> EpubResult<()> {
        let revision = self
            .chapter_local_revisions
            .get_mut(revision_id)
            .ok_or_else(|| {
                EpubError::new(format!("unknown chapter-local revision: {revision_id}"))
            })?;
        append_work_to_revision(revision, work);
        Ok(())
    }

    fn local_target_resolves(
        &mut self,
        revision_id: &str,
        target_locator: &RuntimeSourceLocator,
    ) -> bool {
        matches!(
            self.resolve_chapter_local_source_locator_inner(revision_id, target_locator.clone()),
            Ok(RuntimeSourceLocatorResolution::Resolved { .. })
        )
    }

    pub(super) fn apply_chapter_local_work(
        &mut self,
        record: RuntimeContinuationRecord,
        appended: AppendedChapterLocalWork,
        previous_extent: RuntimeChapterLocalRevisionExtent,
        revision_version: u32,
        page_cap_reached: bool,
        target_locator: RuntimeSourceLocator,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionError> {
        let revision_id = record.revision_id.clone();
        let layout_key = record.layout_key.clone();
        let processed_top_level_nodes = appended.processed_top_level_nodes;
        let complete = appended.complete;
        let owner =
            self.publish_local_work(&revision_id, revision_version, complete, page_cap_reached)?;
        let resolution = self
            .resolve_chapter_local_source_locator_inner(&revision_id, target_locator.clone())
            .expect("preflight-validated chapter-local locator remains resolvable");
        let target = local_locator_resolution(owner.clone(), resolution);
        let continuation = self.finish_local_record(record, complete, &owner, target_locator);
        let revision = self
            .chapter_local_revisions
            .get(&revision_id)
            .expect("chapter-local revision remains available");
        let summary = chapter_local_summary(&owner, &layout_key, revision);
        self.service_cleanup_queue();
        Ok(RuntimeChapterLocalRevisionAdvance {
            newly_known_local_pages: RuntimeChapterLocalPageRange {
                start_local_page: previous_extent.local_page_count,
                end_local_page_exclusive: summary.known_extent.local_page_count,
            },
            revision: summary,
            previous_known_extent: previous_extent,
            processed_top_level_nodes,
            target,
            continuation,
        })
    }

    pub(super) fn fail_chapter_local_revision(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        layout_key: &str,
        error: EpubError,
    ) -> RuntimeChapterLocalRevisionError {
        let document = &self.document;
        let revision = self
            .chapter_local_revisions
            .get_mut(revision_id)
            .expect("continuable chapter-local revision remains available");
        revision.revision_version = revision_version;
        revision.status = RuntimeRevisionStatus::Failed;
        revision.final_extent = None;
        let frame_cache = revision.take_frame_cache();
        let owner = chapter_local_owner(document, revision_id, revision_version, revision);
        let summary = chapter_local_summary(&owner, layout_key, revision);
        self.cleanup_queue.enqueue_frame_cache(frame_cache);
        self.service_cleanup_queue();
        RuntimeChapterLocalRevisionError {
            kind: RuntimeContinuationErrorKind::EngineFailure,
            message: error.message().to_owned(),
            revision: Some(Box::new(summary)),
        }
    }

    /// Publishes an already-appended request: page batches entered the live
    /// revision per meter in [`Self::advance_local_quanta`]; this seals the
    /// request with exactly one version/status/extent update.
    fn publish_local_work(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        complete: bool,
        page_cap_reached: bool,
    ) -> Result<crate::runtime::RuntimeChapterLocalRevisionHandle, RuntimeChapterLocalRevisionError>
    {
        let document = &self.document;
        let revision = self
            .chapter_local_revisions
            .get_mut(revision_id)
            .ok_or_else(|| local_unknown_revision(revision_id))?;
        update_revision_publication(revision, revision_version, complete);
        mark_local_page_cap(revision, page_cap_reached);
        Ok(chapter_local_owner(
            document,
            revision_id,
            revision_version,
            revision,
        ))
    }

    fn finish_local_record(
        &mut self,
        record: RuntimeContinuationRecord,
        complete: bool,
        owner: &crate::runtime::RuntimeChapterLocalRevisionHandle,
        target_locator: RuntimeSourceLocator,
    ) -> Option<RuntimeChapterLocalRevisionCursor> {
        if complete {
            self.cleanup_queue.enqueue_continuation(record);
            return None;
        }
        let cursor = self.store_continuation(record);
        Some(RuntimeChapterLocalRevisionCursor {
            owner: owner.clone(),
            cursor: cursor.cursor,
            target_locator,
        })
    }

    fn retire_failed_initial_local_revision(
        &mut self,
        record: RuntimeContinuationRecord,
        revision_id: &str,
    ) {
        self.cleanup_queue.enqueue_continuation(record);
        if let Some(revision) = self.chapter_local_revisions.remove(revision_id) {
            self.cleanup_queue.enqueue_revision(revision);
        }
        self.service_cleanup_queue();
    }
}
