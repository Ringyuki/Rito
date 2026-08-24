use std::num::NonZeroUsize;

use crate::{
    epub::{
        prepare_runtime_layout_chapter, shapeable_publication_families_for_layout_with_sources,
        EpubError, EpubResult, PreparedRuntimeLayoutChapter,
    },
    layout::{
        pagination_session::{LayoutAdvanceStatus, LayoutWorkBudget, LayoutWorkMeter},
        runtime_session::{RuntimeChapterLayoutAdvance, RuntimeChapterLayoutSession},
    },
    runtime::{revision::runtime_chapter_revision_interactions, RuntimeDocument},
};

use super::state::{
    RuntimeChapterContinuation, RuntimeChapterPageBatch, RuntimeContinuationRecord,
    RuntimeContinuationWork,
};

mod image_frontier;

impl RuntimeDocument {
    pub(super) fn advance_record(
        &mut self,
        record: &mut RuntimeContinuationRecord,
        budget: NonZeroUsize,
    ) -> EpubResult<RuntimeContinuationWork> {
        let mut remaining = budget.get();
        let mut layout_work = LayoutWorkMeter::new(LayoutWorkBudget::new(budget));
        let mut work = RuntimeContinuationWork::default();
        while remaining > 0
            && record.next_chapter_index < record.chapter_count
            && !record.reached_local_page_cap()
        {
            if let Err(error) = self.ensure_current_chapter(record, &mut work) {
                self.retire_orphaned_work(work);
                return Err(error);
            }
            if record
                .current
                .as_ref()
                .is_some_and(|chapter| !chapter.unpublished_pages.is_empty())
            {
                let chapter_complete = record
                    .current
                    .as_ref()
                    .is_some_and(|chapter| chapter.chapter_complete);
                let batch = capture_buffered_page_batch(record, chapter_complete);
                if !batch.pages.is_empty() {
                    work.batches.push(batch);
                    publish_pending_style_table(record, &mut work);
                }
                if cap_truncates_current_chapter(record, chapter_complete) {
                    break;
                }
                if chapter_complete {
                    let completed = finish_current_chapter(record, &mut work);
                    self.cleanup_queue.enqueue_completed_chapter(completed);
                    self.service_cleanup_queue();
                    continue;
                }
            }
            let advance = match self.advance_current_chapter(record, &mut layout_work) {
                Ok(advance) => advance,
                Err(error) => {
                    self.retire_orphaned_work(work);
                    return Err(error);
                }
            };
            let chapter_complete = advance.status == LayoutAdvanceStatus::Complete;
            remaining = remaining.saturating_sub(consumed_budget(&advance));
            layout_work.cap_root_work_remaining(remaining);
            work.processed_top_level_nodes += advance.processed_top_level_nodes;
            let batch = {
                #[cfg(any(test, feature = "bench-internals"))]
                let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                    crate::layout::bounded_work_probe::ContinuationTimingStage::PublishCleanup,
                );
                record_chapter_advance(record, advance);
                capture_buffered_page_batch(record, chapter_complete)
            };
            work.batches.push(batch);
            publish_pending_style_table(record, &mut work);
            if cap_truncates_current_chapter(record, chapter_complete) {
                break;
            }
            if chapter_complete {
                #[cfg(any(test, feature = "bench-internals"))]
                let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                    crate::layout::bounded_work_probe::ContinuationTimingStage::PublishCleanup,
                );
                let completed = finish_current_chapter(record, &mut work);
                self.cleanup_queue.enqueue_completed_chapter(completed);
                self.service_cleanup_queue();
            } else {
                break;
            }
        }
        // Reaching a chapter-local window cap seals this revision but does not
        // complete the owned layout cursor. The continuation remains available
        // for an explicit rollover into a fresh bounded revision.
        work.complete = record.is_complete();
        Ok(work)
    }

    fn ensure_current_chapter(
        &mut self,
        record: &mut RuntimeContinuationRecord,
        work: &mut RuntimeContinuationWork,
    ) -> EpubResult<()> {
        if record.current.is_some() {
            return Ok(());
        }
        let (current, interactions) = self.start_chapter(record)?;
        work.available_interactions.push(interactions);
        record.current = Some(current);
        Ok(())
    }

    fn start_chapter(
        &mut self,
        record: &RuntimeContinuationRecord,
    ) -> EpubResult<(
        RuntimeChapterContinuation,
        crate::runtime::frame::RuntimeRevisionInteractions,
    )> {
        #[cfg(any(test, feature = "bench-internals"))]
        let _probe_timer = crate::layout::bounded_work_probe::start_timing(
            crate::layout::bounded_work_probe::ContinuationTimingStage::EnsureStartChapter,
        );
        let chapter_index = record.next_chapter_index;
        {
            #[cfg(any(test, feature = "bench-internals"))]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::ChapterSourceLoad,
            );
            self.document.ensure_chapter_loaded(chapter_index)?;
        }
        let footnote_targets = {
            #[cfg(any(test, feature = "bench-internals"))]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::FootnoteIndex,
            );
            self.prepare_chapter_footnote_targets(chapter_index)?
        };
        let mut prepared = {
            #[cfg(any(test, feature = "bench-internals"))]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::DocumentWindow,
            );
            self.prepare_cached_document_window(chapter_index, 1, &footnote_targets)?
        };
        let font_fallbacks = {
            #[cfg(any(test, feature = "bench-internals"))]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::FontFallbackDiscovery,
            );
            let mut font_fallbacks = self.pinned_font_policy.family_fallbacks_for_layout(
                &record.layout_config,
                &self.document.package.metadata.language,
            );
            if let Some(policy) = font_fallbacks.as_mut() {
                let pinned_faces = self
                    .pinned_font_policy
                    .measurement_faces_for_layout(&record.layout_config);
                let available_families = shapeable_publication_families_for_layout_with_sources(
                    &self.document,
                    self.resolved_font_face_sources(),
                    &record.layout_config,
                    &pinned_faces,
                );
                policy.set_available_publication_families(available_families);
            }
            font_fallbacks
        };
        let PreparedRuntimeLayoutChapter {
            idref,
            styled_nodes,
            page_paint,
            layout_style_table,
            inline_style_table,
        } = prepare_runtime_layout_chapter(
            &prepared,
            &record.layout_config,
            font_fallbacks.as_ref(),
        )?
        .ok_or_else(|| EpubError::new("prepared runtime chapter is unavailable"))?;
        let mut interactions = {
            #[cfg(any(test, feature = "bench-internals"))]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::InteractionBuild,
            );
            runtime_chapter_revision_interactions(&prepared)
        };
        self.record_prepared_chapter_footnotes(std::mem::take(&mut prepared.interaction.footnotes));
        let (resolved_footnotes, pending_footnote_keys, footnote_index_complete) =
            self.chapter_footnote_interactions(chapter_index);
        interactions.footnotes = resolved_footnotes;
        interactions.pending_footnote_keys =
            crate::interaction::FootnoteTargetSet::new(pending_footnote_keys);
        interactions.footnote_index_complete = footnote_index_complete;
        let completed_chapter_idrefs = std::mem::take(&mut interactions.completed_chapter_idrefs);
        let current = {
            #[cfg(any(test, feature = "bench-internals"))]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::SessionInitialize,
            );
            RuntimeChapterContinuation::new(
                idref,
                RuntimeChapterLayoutSession::new_with_lazy_image_frontier(
                    styled_nodes,
                    &record.layout_config,
                    record.line_breaking,
                    page_paint,
                ),
                completed_chapter_idrefs,
                Vec::new(),
                false,
                Some(crate::runtime::frame::RuntimeChapterStyleTables {
                    layout: layout_style_table,
                    inline: inline_style_table,
                }),
            )
        };
        Ok((current, interactions))
    }

    pub(super) fn retire_orphaned_work(&mut self, work: RuntimeContinuationWork) {
        self.cleanup_queue.enqueue_continuation_work(work);
    }
}

fn consumed_budget(advance: &RuntimeChapterLayoutAdvance) -> usize {
    advance.processed_top_level_nodes.max(usize::from(
        advance.status == LayoutAdvanceStatus::Complete && advance.processed_top_level_nodes == 0,
    ))
}

fn record_chapter_advance(
    record: &mut RuntimeContinuationRecord,
    advance: RuntimeChapterLayoutAdvance,
) {
    let current = record.current.as_mut().expect("chapter remains active");
    current.chapter_complete = advance.status == LayoutAdvanceStatus::Complete;
    current.total_block_count = advance.total_block_count;
    current.unpublished_pages.extend(advance.newly_sealed_pages);
}

fn capture_buffered_page_batch(
    record: &mut RuntimeContinuationRecord,
    chapter_complete: bool,
) -> RuntimeChapterPageBatch {
    let remaining_page_capacity = record.remaining_page_capacity();
    let (idref, block_count, pages) = {
        let current = record.current.as_mut().expect("chapter remains active");
        let publish_count = super::publish::publishable_page_count(
            record.published_page_count,
            current.has_published_pages,
            current.unpublished_pages.len(),
            chapter_complete,
            &record.layout_config,
        )
        .min(remaining_page_capacity);
        let pages = current
            .unpublished_pages
            .drain(..publish_count)
            .collect::<Vec<_>>();
        (current.idref.clone(), current.total_block_count, pages)
    };
    record_published_pages(record, pages.len());
    RuntimeChapterPageBatch {
        idref,
        block_count,
        pages,
    }
}

fn cap_truncates_current_chapter(
    record: &RuntimeContinuationRecord,
    chapter_complete: bool,
) -> bool {
    record.reached_local_page_cap()
        && (!chapter_complete
            || record
                .current
                .as_ref()
                .is_some_and(|chapter| !chapter.unpublished_pages.is_empty()))
}

fn record_published_pages(record: &mut RuntimeContinuationRecord, page_count: usize) {
    if page_count == 0 {
        return;
    }
    let current = record.current.as_mut().expect("chapter remains active");
    current.has_published_pages = true;
    record.published_page_count += page_count;
}

fn finish_current_chapter(
    record: &mut RuntimeContinuationRecord,
    work: &mut RuntimeContinuationWork,
) -> RuntimeChapterContinuation {
    let mut current = record.current.take().expect("completed chapter exists");
    debug_assert!(current.unpublished_pages.is_empty());
    // A chapter can complete without ever publishing a page (empty content);
    // its style table still describes the resolved chapter.
    if let Some(table) = current.pending_style_table.take() {
        work.chapter_style_tables
            .push((current.idref.clone(), table));
    }
    work.completed_chapter_idrefs
        .append(&mut current.completed_chapter_idrefs);
    record.next_chapter_index += 1;
    current
}

/// Moves the active chapter's style table into work that already carries a
/// published batch for it, so the table lands in the revision atomically
/// with the chapter's first visible pages.
fn publish_pending_style_table(
    record: &mut RuntimeContinuationRecord,
    work: &mut RuntimeContinuationWork,
) {
    let Some(current) = record.current.as_mut() else {
        return;
    };
    if let Some(table) = current.pending_style_table.take() {
        work.chapter_style_tables
            .push((current.idref.clone(), table));
    }
}

#[cfg(test)]
#[path = "work/tests.rs"]
mod tests;
