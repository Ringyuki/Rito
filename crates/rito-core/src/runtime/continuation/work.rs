use std::num::NonZeroUsize;

use crate::{
    epub::{
        prepare_runtime_layout_chapter, text_measurement_fonts_for_layout, EpubError, EpubResult,
        PreparedRuntimeLayoutChapter,
    },
    layout::{
        image_size::ImageSizeIndex,
        pagination_session::{LayoutAdvanceStatus, LayoutWorkBudget},
        runtime_session::{RuntimeChapterLayoutAdvance, RuntimeChapterLayoutSession},
    },
    resources::{binary_summary_from_metadata, BinaryResourceSummary},
    runtime::{revision::runtime_revision_interactions, RuntimeDocument},
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
        let mut work = RuntimeContinuationWork::default();
        while remaining > 0 && record.next_chapter_index < record.chapter_count {
            self.ensure_current_chapter(record, &mut work)?;
            let advance = self.advance_current_chapter(record, remaining);
            let chapter_complete = advance.status == LayoutAdvanceStatus::Complete;
            remaining = remaining.saturating_sub(consumed_budget(&advance));
            work.processed_top_level_nodes += advance.processed_top_level_nodes;
            work.batches
                .push(capture_page_batch(record, advance, chapter_complete));
            if chapter_complete {
                finish_current_chapter(record, &mut work);
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
        let current = self.start_chapter(record)?;
        let mut interactions = current.interactions.clone();
        interactions.completed_chapter_idrefs.clear();
        work.available_interactions.push(interactions);
        record.current = Some(current);
        Ok(())
    }

    fn advance_current_chapter(
        &self,
        record: &mut RuntimeContinuationRecord,
        remaining: usize,
    ) -> RuntimeChapterLayoutAdvance {
        let pinned_faces = self
            .pinned_font_policy
            .measurement_faces_for_layout(&record.layout_config);
        let fonts = text_measurement_fonts_for_layout(
            &self.document,
            &record.layout_config,
            Some(self.text_measurement_cache.clone()),
            pinned_faces,
        );
        let budget = LayoutWorkBudget::new(
            NonZeroUsize::new(remaining).expect("remaining work is non-zero"),
        );
        record
            .current
            .as_mut()
            .expect("chapter was started")
            .session
            .advance(budget, &fonts)
    }

    fn start_chapter(
        &mut self,
        record: &RuntimeContinuationRecord,
    ) -> EpubResult<RuntimeChapterContinuation> {
        let chapter_index = record.next_chapter_index;
        let footnote_targets = self.publication_footnote_index()?.targets.clone();
        self.document.ensure_chapter_loaded(chapter_index)?;
        self.document
            .ensure_chapter_image_dimensions_loaded(chapter_index, 1)?;
        let prepared = self.prepare_cached_document_window(chapter_index, 1, &footnote_targets)?;
        let font_fallbacks = self.pinned_font_policy.family_fallbacks_for_layout(
            &record.layout_config,
            &self.document.package.metadata.language,
        );
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
        Ok(RuntimeChapterContinuation {
            idref,
            session: RuntimeChapterLayoutSession::new(
                styled_nodes,
                live_image_sizes(&self.document),
                &record.layout_config,
                record.line_breaking,
                page_paint,
            ),
            interactions: runtime_revision_interactions(&prepared, false),
            unpublished_pages: Vec::new(),
            has_published_pages: false,
        })
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
            &record.chapter_start_pages,
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
    if !current.has_published_pages {
        record
            .chapter_start_pages
            .insert(record.published_page_count);
        current.has_published_pages = true;
    }
    record.published_page_count += page_count;
}

fn finish_current_chapter(
    record: &mut RuntimeContinuationRecord,
    work: &mut RuntimeContinuationWork,
) {
    let current = record.current.take().expect("completed chapter exists");
    debug_assert!(current.unpublished_pages.is_empty());
    work.completed_chapter_idrefs
        .extend(current.interactions.completed_chapter_idrefs);
    record.next_chapter_index += 1;
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
