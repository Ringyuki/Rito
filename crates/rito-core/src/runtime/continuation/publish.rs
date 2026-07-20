use std::collections::{BTreeMap, BTreeSet};

use crate::{
    layout::{
        append_runtime_chapter_pages, calibrate_layout_font_vertical_metrics, LayoutConfig,
        SpreadMode,
    },
    runtime::{
        frame::{
            revision_summary, RuntimeChapterTextIndexSource, RuntimeRevision,
            RuntimeRevisionInteractions,
        },
        RuntimeContinuationError, RuntimeContinuationErrorKind, RuntimeDocument,
        RuntimeRevisionAdvance, RuntimeRevisionCursor, RuntimeRevisionExtent,
        RuntimeRevisionPageRange, RuntimeRevisionStatus,
    },
};

use super::{
    error::{continuation_error, unknown_revision},
    state::{RuntimeChapterPageBatch, RuntimeContinuationRecord, RuntimeContinuationWork},
    PendingRuntimeContinuationRecordCleanup,
};

impl RuntimeDocument {
    pub(super) fn apply_work(
        &mut self,
        continuation: RuntimeContinuationRecord,
        work: RuntimeContinuationWork,
        previous_extent: RuntimeRevisionExtent,
        revision_version: u32,
        layout_key: &str,
    ) -> Result<RuntimeRevisionAdvance, RuntimeContinuationError> {
        #[cfg(any(test, feature = "bench-internals"))]
        let _probe_timer = crate::layout::bounded_work_probe::start_timing(
            crate::layout::bounded_work_probe::ContinuationTimingStage::PublishCleanup,
        );
        let revision_id = continuation.revision_id.clone();
        let processed_top_level_nodes = work.processed_top_level_nodes;
        let complete = work.complete;
        if !self.revisions.contains_key(&revision_id) {
            self.cleanup_queue.enqueue_continuation(continuation);
            self.retire_orphaned_work(work);
            self.service_cleanup_queue();
            return Err(unknown_revision(&revision_id));
        }
        let summary = {
            let revision = self
                .revisions
                .get_mut(&revision_id)
                .expect("revision existence was checked");
            append_work_to_revision(revision, work);
            update_revision_publication(revision, revision_version, complete);
            debug_assert_eq!(
                continuation.published_page_count,
                revision.known_extent.page_count
            );
            revision_summary(&revision_id, layout_key, revision)
        };
        let continuation = if complete {
            self.cleanup_queue.enqueue_continuation(continuation);
            None
        } else {
            Some(self.store_continuation(continuation))
        };
        self.service_cleanup_queue();
        Ok(RuntimeRevisionAdvance {
            newly_known_pages: RuntimeRevisionPageRange {
                start_page: previous_extent.page_count,
                end_page_exclusive: summary.known_extent.page_count,
            },
            revision: summary,
            previous_known_extent: previous_extent,
            processed_top_level_nodes,
            continuation,
        })
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

    pub(super) fn mark_revision_failed(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        layout_key: &str,
    ) -> crate::runtime::RuntimeRevisionSummary {
        if let Some(continuation) = self.continuations.remove_revision(revision_id) {
            self.cleanup_queue.enqueue_continuation(continuation);
        }
        let frame_cache = {
            let revision = self
                .revisions
                .get_mut(revision_id)
                .expect("continuable revision remains available while work advances");
            revision.revision_version = revision_version;
            revision.status = RuntimeRevisionStatus::Failed;
            revision.final_extent = None;
            revision.take_frame_cache()
        };
        self.cleanup_queue.enqueue_frame_cache(frame_cache);
        revision_summary(
            revision_id,
            layout_key,
            self.revisions
                .get(revision_id)
                .expect("failed revision remains available"),
        )
    }
}

pub(super) fn append_work_to_revision(
    revision: &mut RuntimeRevision,
    work: RuntimeContinuationWork,
) {
    for batch in work.batches {
        append_page_batch(revision, batch);
    }
    for interactions in work.available_interactions {
        merge_revision_interactions(&mut revision.interactions, interactions);
    }
    revision
        .interactions
        .completed_chapter_idrefs
        .extend(work.completed_chapter_idrefs);
}

fn append_page_batch(revision: &mut RuntimeRevision, mut batch: RuntimeChapterPageBatch) {
    // A resumable layout session can retain runs that were built before a
    // vertical-metric calibration. Every later page crosses this publication
    // boundary, so apply the revision's exact samples before it becomes visible.
    calibrate_layout_font_vertical_metrics(
        &mut batch.pages,
        &revision.layout_config.font_vertical_metrics,
    );
    append_runtime_chapter_pages(
        &mut revision.layout,
        &batch.idref,
        batch.block_count,
        batch.pages,
        &revision.layout_config,
    );
}

pub(super) fn update_revision_publication(
    revision: &mut RuntimeRevision,
    revision_version: u32,
    complete: bool,
) {
    let extent = revision_extent(revision);
    revision.revision_version = revision_version;
    revision.known_extent = extent;
    revision.status = if complete {
        RuntimeRevisionStatus::Complete
    } else if extent.spread_count > 0 {
        RuntimeRevisionStatus::Ready
    } else {
        RuntimeRevisionStatus::Warming
    };
    revision.final_extent = complete.then_some(extent);
    debug_assert_eq!(
        revision.layout.summary.pagination_flow.page_count,
        extent.page_count
    );
}

fn revision_extent(revision: &RuntimeRevision) -> RuntimeRevisionExtent {
    RuntimeRevisionExtent {
        page_count: revision.layout.pages.len(),
        spread_count: revision
            .layout
            .summary
            .pagination_flow
            .display_list_flow
            .spread_count,
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

pub(super) fn publishable_page_count(
    published_page_count: usize,
    chapter_has_published_pages: bool,
    candidate_count: usize,
    chapter_complete: bool,
    layout_config: &LayoutConfig,
) -> usize {
    if candidate_count == 0 || layout_config.spread_mode == SpreadMode::Single || chapter_complete {
        return candidate_count;
    }
    // An incomplete double-spread chapter exposes only complete pairs. Page zero
    // is the sole stable singleton; any other dangling page stays in the
    // candidate tail, so a later batch again starts at a left-page boundary.
    let isolated_first = usize::from(
        !chapter_has_published_pages && published_page_count == 0 && layout_config.first_page_alone,
    );
    isolated_first + (candidate_count - isolated_first) / 2 * 2
}

pub(super) fn initial_revision_interactions(
    footnotes: BTreeMap<String, crate::interaction::FootnoteEntry>,
) -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        publication_footnotes: None,
        footnotes,
        pending_footnote_keys: crate::interaction::FootnoteTargetSet::default(),
        footnote_index_complete: false,
        chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(BTreeMap::new()),
        completed_chapter_idrefs: BTreeSet::new(),
    }
}

fn merge_revision_interactions(
    target: &mut RuntimeRevisionInteractions,
    source: RuntimeRevisionInteractions,
) {
    if source.publication_footnotes.is_some() {
        target.publication_footnotes = source.publication_footnotes;
    }
    for (key, entry) in source.footnotes {
        let exists_in_publication = target
            .publication_footnotes
            .as_deref()
            .is_some_and(|footnotes| footnotes.contains_key(&key));
        if !exists_in_publication {
            target.footnotes.insert(key, entry);
        }
    }
    target.pending_footnote_keys = target
        .pending_footnote_keys
        .union(&source.pending_footnote_keys);
    target.footnote_index_complete = source.footnote_index_complete;
    target
        .completed_chapter_idrefs
        .extend(source.completed_chapter_idrefs);
    if let (
        RuntimeChapterTextIndexSource::Materialized(target_entries),
        RuntimeChapterTextIndexSource::Materialized(source_entries),
    ) = (
        &mut target.chapter_text_indices,
        source.chapter_text_indices,
    ) {
        target_entries.extend(source_entries);
    }
}

#[cfg(test)]
#[path = "publish/tests.rs"]
mod tests;
