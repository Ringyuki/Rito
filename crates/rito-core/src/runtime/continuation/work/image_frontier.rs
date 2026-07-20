use crate::{
    epub::{text_measurement_fonts_for_layout_with_sources, EpubResult},
    layout::{
        pagination_session::{LayoutAdvanceStatus, LayoutWorkMeter},
        runtime_session::RuntimeChapterLayoutAdvance,
        TextMeasurementFonts, TextMeasurementMode,
    },
    runtime::RuntimeDocument,
};

use super::super::state::RuntimeContinuationRecord;

impl RuntimeDocument {
    pub(super) fn advance_current_chapter(
        &mut self,
        record: &mut RuntimeContinuationRecord,
        layout_work: &mut LayoutWorkMeter,
    ) -> EpubResult<RuntimeChapterLayoutAdvance> {
        let mut combined = None;
        loop {
            let prepared_frontier = self.prepare_next_image_frontier(record, layout_work)?;
            if combined.is_some() && !prepared_frontier {
                break;
            }
            let advance = self.advance_current_chapter_once(record, layout_work);
            let complete = advance.status == LayoutAdvanceStatus::Complete;
            merge_chapter_advance(&mut combined, advance);
            if complete {
                break;
            }
        }
        Ok(combined.expect("an active chapter advances at least once"))
    }

    fn prepare_next_image_frontier(
        &mut self,
        record: &mut RuntimeContinuationRecord,
        layout_work: &LayoutWorkMeter,
    ) -> EpubResult<bool> {
        let Some(hrefs) = record
            .current
            .as_mut()
            .expect("chapter was started")
            .session
            .reserve_next_image_frontier(layout_work)
        else {
            return Ok(false);
        };
        let dimensions = {
            #[cfg(any(test, feature = "bench-internals"))]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::ChapterImagePreparation,
            );
            self.document
                .ensure_image_dimensions_loaded_for_refs(&hrefs)?
        };
        record
            .current
            .as_mut()
            .expect("chapter remains active")
            .session
            .extend_image_sizes(dimensions);
        Ok(true)
    }

    fn advance_current_chapter_once(
        &self,
        record: &mut RuntimeContinuationRecord,
        layout_work: &mut LayoutWorkMeter,
    ) -> RuntimeChapterLayoutAdvance {
        let fonts = {
            #[cfg(any(test, feature = "bench-internals"))]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::FontAssembly,
            );
            match record.layout_config.text_measurement {
                TextMeasurementMode::FixtureCompatible => TextMeasurementFonts::empty(),
                TextMeasurementMode::FontAware => {
                    let pinned_faces = self
                        .pinned_font_policy
                        .measurement_faces_for_layout(&record.layout_config);
                    text_measurement_fonts_for_layout_with_sources(
                        &self.document,
                        self.resolved_font_face_sources(),
                        &record.layout_config,
                        self.text_measurement_cache.clone(),
                        pinned_faces,
                    )
                }
            }
        };
        #[cfg(any(test, feature = "bench-internals"))]
        let _probe_timer = crate::layout::bounded_work_probe::start_timing(
            crate::layout::bounded_work_probe::ContinuationTimingStage::SessionAdvance,
        );
        record
            .current
            .as_mut()
            .expect("chapter was started")
            .session
            .advance_with_meter(layout_work, &fonts)
    }
}

fn merge_chapter_advance(
    combined: &mut Option<RuntimeChapterLayoutAdvance>,
    advance: RuntimeChapterLayoutAdvance,
) {
    let Some(current) = combined.as_mut() else {
        *combined = Some(advance);
        return;
    };
    current.status = advance.status;
    current.processed_top_level_nodes += advance.processed_top_level_nodes;
    current.total_block_count = advance.total_block_count;
    current
        .newly_sealed_pages
        .extend(advance.newly_sealed_pages);
}
