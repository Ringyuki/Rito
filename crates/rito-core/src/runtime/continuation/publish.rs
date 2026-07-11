use std::collections::{BTreeMap, BTreeSet};

use crate::{
    layout::{append_runtime_chapter_pages, build_spread_slots, LayoutConfig, SpreadMode},
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
        let revision_id = continuation.revision_id.clone();
        let processed_top_level_nodes = work.processed_top_level_nodes;
        let complete = work.complete;
        let summary = {
            let revision = self
                .revisions
                .get_mut(&revision_id)
                .ok_or_else(|| unknown_revision(&revision_id))?;
            append_work_to_revision(revision, work);
            update_revision_publication(revision, revision_version, complete);
            debug_assert_eq!(
                continuation.published_page_count,
                revision.known_extent.page_count
            );
            revision_summary(&revision_id, layout_key, revision)
        };
        let continuation = (!complete).then(|| self.store_continuation(continuation));
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

    fn store_continuation(
        &mut self,
        continuation: RuntimeContinuationRecord,
    ) -> RuntimeRevisionCursor {
        let cursor = format!("cursor-{}", self.next_continuation_index);
        self.next_continuation_index += 1;
        let handle = RuntimeRevisionCursor {
            revision_id: continuation.revision_id.clone(),
            revision_version: continuation.revision_version,
            cursor: cursor.clone(),
        };
        self.continuations.insert(cursor, continuation);
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
        self.continuations
            .retain(|_, continuation| continuation.revision_id != revision_id);
        let revision = self
            .revisions
            .get_mut(revision_id)
            .expect("continuable revision remains available while work advances");
        revision.revision_version = revision_version;
        revision.status = RuntimeRevisionStatus::Failed;
        revision.final_extent = None;
        revision.clear_frame_cache();
        revision_summary(revision_id, layout_key, revision)
    }
}

fn append_work_to_revision(revision: &mut RuntimeRevision, work: RuntimeContinuationWork) {
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

fn append_page_batch(revision: &mut RuntimeRevision, batch: RuntimeChapterPageBatch) {
    append_runtime_chapter_pages(
        &mut revision.layout,
        &batch.idref,
        batch.block_count,
        batch.pages,
        &revision.layout_config,
    );
}

fn update_revision_publication(
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
    revision.clear_frame_cache();
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
    chapter_start_pages: &BTreeSet<usize>,
    chapter_has_published_pages: bool,
    candidate_count: usize,
    chapter_complete: bool,
    layout_config: &LayoutConfig,
) -> usize {
    if candidate_count == 0 || layout_config.spread_mode == SpreadMode::Single || chapter_complete {
        return candidate_count;
    }
    let mut starts = chapter_start_pages.clone();
    if !chapter_has_published_pages {
        starts.insert(published_page_count);
    }
    stable_page_count(
        published_page_count,
        candidate_count,
        &starts,
        layout_config,
    )
    .saturating_sub(published_page_count)
}

fn stable_page_count(
    published_page_count: usize,
    candidate_count: usize,
    chapter_start_pages: &BTreeSet<usize>,
    layout_config: &LayoutConfig,
) -> usize {
    let slots = build_spread_slots(
        published_page_count + candidate_count,
        chapter_start_pages,
        layout_config,
    );
    let stable_spread_count = slots
        .len()
        .saturating_sub(usize::from(slots.last().is_some_and(|slot| {
            slot.right_page_index.is_none()
                && !(layout_config.first_page_alone && slot.left_page_index == 0)
        })));
    slots
        .iter()
        .take(stable_spread_count)
        .flat_map(|slot| [Some(slot.left_page_index), slot.right_page_index])
        .flatten()
        .max()
        .map_or(0, |index| index + 1)
}

pub(super) fn empty_revision_interactions() -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        footnotes: BTreeMap::new(),
        chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(BTreeMap::new()),
        completed_chapter_idrefs: BTreeSet::new(),
    }
}

fn merge_revision_interactions(
    target: &mut RuntimeRevisionInteractions,
    source: RuntimeRevisionInteractions,
) {
    target.footnotes.extend(source.footnotes);
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
