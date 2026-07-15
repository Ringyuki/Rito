use std::num::NonZeroUsize;

use crate::{
    epub::{
        prepare_runtime_layout_chapter, text_measurement_font_assembly_for_layout, EpubError,
        EpubResult, PreparedRuntimeLayoutChapter,
    },
    layout::{
        image_size::ImageSizeIndex,
        pagination_session::{LayoutAdvanceStatus, LayoutWorkBudget, LayoutWorkMeter},
        runtime_session::{RuntimeChapterLayoutAdvance, RuntimeChapterLayoutSession},
        PendingRuntimePageVectorCleanup,
    },
    resources::{binary_summary_from_metadata, BinaryResourceSummary},
    runtime::{revision::runtime_chapter_revision_interactions, RuntimeDocument},
};

use super::state::{
    RuntimeChapterContinuation, RuntimeChapterPageBatch, RuntimeContinuationRecord,
    RuntimeContinuationWork,
};

impl RuntimeDocument {
    pub(super) fn advance_record(
        &mut self,
        record: &mut RuntimeContinuationRecord,
        budget: NonZeroUsize,
    ) -> EpubResult<RuntimeContinuationWork> {
        let mut remaining = budget.get();
        let mut layout_work = LayoutWorkMeter::new(LayoutWorkBudget::new(budget));
        let mut work = RuntimeContinuationWork::default();
        while remaining > 0 && record.next_chapter_index < record.chapter_count {
            if let Err(error) = self.ensure_current_chapter(record, &mut work) {
                self.retire_orphaned_work(work);
                return Err(error);
            }
            let advance = self.advance_current_chapter(record, &mut layout_work);
            let chapter_complete = advance.status == LayoutAdvanceStatus::Complete;
            remaining = remaining.saturating_sub(consumed_budget(&advance));
            layout_work.cap_root_work_remaining(remaining);
            work.processed_top_level_nodes += advance.processed_top_level_nodes;
            work.batches
                .push(capture_page_batch(record, advance, chapter_complete));
            if chapter_complete {
                let completed = finish_current_chapter(record, &mut work);
                self.cleanup_queue.enqueue_completed_chapter(completed);
                self.service_cleanup_queue();
            } else {
                break;
            }
        }
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

    fn advance_current_chapter(
        &self,
        record: &mut RuntimeContinuationRecord,
        layout_work: &mut LayoutWorkMeter,
    ) -> RuntimeChapterLayoutAdvance {
        let pinned_faces = self
            .pinned_font_policy
            .measurement_faces_for_layout(&record.layout_config);
        let assembly = text_measurement_font_assembly_for_layout(
            &self.document,
            &record.layout_config,
            Some(self.text_measurement_cache.clone()),
            pinned_faces,
        );
        record
            .current
            .as_mut()
            .expect("chapter was started")
            .session
            .advance_with_meter(layout_work, &assembly.fonts)
    }

    fn start_chapter(
        &mut self,
        record: &RuntimeContinuationRecord,
    ) -> EpubResult<(
        RuntimeChapterContinuation,
        crate::runtime::frame::RuntimeRevisionInteractions,
    )> {
        let chapter_index = record.next_chapter_index;
        let footnote_targets = self.publication_footnote_index()?.targets.clone();
        self.document.ensure_chapter_loaded(chapter_index)?;
        self.document
            .ensure_chapter_image_dimensions_loaded(chapter_index, 1)?;
        let prepared = self.prepare_cached_document_window(chapter_index, 1, &footnote_targets)?;
        let pinned_faces = self
            .pinned_font_policy
            .measurement_faces_for_layout(&record.layout_config);
        let available_families = text_measurement_font_assembly_for_layout(
            &self.document,
            &record.layout_config,
            Some(self.text_measurement_cache.clone()),
            pinned_faces,
        )
        .shapeable_publication_families;
        let mut font_fallbacks = self.pinned_font_policy.family_fallbacks_for_layout(
            &record.layout_config,
            &self.document.package.metadata.language,
        );
        if let Some(policy) = font_fallbacks.as_mut() {
            policy.set_available_publication_families(available_families);
        }
        let PreparedRuntimeLayoutChapter {
            idref,
            styled_nodes,
            page_paint,
        } = prepare_runtime_layout_chapter(
            &prepared,
            &record.layout_config,
            font_fallbacks.as_ref(),
        )
        .ok_or_else(|| EpubError::new("prepared runtime chapter is unavailable"))?;
        let mut interactions = runtime_chapter_revision_interactions(&prepared);
        let completed_chapter_idrefs = std::mem::take(&mut interactions.completed_chapter_idrefs);
        Ok((
            RuntimeChapterContinuation::new(
                idref,
                RuntimeChapterLayoutSession::new(
                    styled_nodes,
                    live_image_sizes(&self.document),
                    &record.layout_config,
                    record.line_breaking,
                    page_paint,
                ),
                completed_chapter_idrefs,
                Vec::new(),
                false,
            ),
            interactions,
        ))
    }

    pub(super) fn retire_orphaned_work(&mut self, work: RuntimeContinuationWork) {
        let RuntimeContinuationWork {
            batches,
            available_interactions,
            completed_chapter_idrefs,
            processed_top_level_nodes,
            complete,
        } = work;
        self.cleanup_queue
            .enqueue_revision_interactions(available_interactions);
        for batch in batches {
            let RuntimeChapterPageBatch {
                idref,
                block_count,
                pages,
            } = batch;
            PendingRuntimePageVectorCleanup::new(pages).drain();
            let _ = (idref, block_count);
        }
        drop(completed_chapter_idrefs);
        let _ = (processed_top_level_nodes, complete);
    }
}

fn consumed_budget(advance: &RuntimeChapterLayoutAdvance) -> usize {
    advance.processed_top_level_nodes.max(usize::from(
        advance.status == LayoutAdvanceStatus::Complete && advance.processed_top_level_nodes == 0,
    ))
}

fn capture_page_batch(
    record: &mut RuntimeContinuationRecord,
    advance: RuntimeChapterLayoutAdvance,
    chapter_complete: bool,
) -> RuntimeChapterPageBatch {
    let (idref, pages) = {
        let current = record.current.as_mut().expect("chapter remains active");
        current.unpublished_pages.extend(advance.newly_sealed_pages);
        let publish_count = super::publish::publishable_page_count(
            record.published_page_count,
            current.has_published_pages,
            current.unpublished_pages.len(),
            chapter_complete,
            &record.layout_config,
        );
        let pages = current
            .unpublished_pages
            .drain(..publish_count)
            .collect::<Vec<_>>();
        (current.idref.clone(), pages)
    };
    record_published_pages(record, pages.len());
    RuntimeChapterPageBatch {
        idref,
        block_count: advance.total_block_count,
        pages,
    }
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
    work.completed_chapter_idrefs
        .append(&mut current.completed_chapter_idrefs);
    record.next_chapter_index += 1;
    current
}

fn live_image_sizes(document: &crate::epub::LoadedEpubDocument) -> ImageSizeIndex {
    let images = document
        .images
        .iter()
        .map(|image| {
            binary_summary_from_metadata(
                &image.href,
                image.byte_length,
                image.byte_hash.clone(),
                image.width,
                image.height,
            )
        })
        .collect::<Vec<BinaryResourceSummary>>();
    ImageSizeIndex::new(&images)
}

#[cfg(test)]
#[path = "work/tests.rs"]
mod tests;
