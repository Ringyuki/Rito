use serde_json::Value;

use super::{
    image_size::ImageSizeIndex,
    pagination_flow::cursor::ContinuousPaginationSession,
    pagination_session::{
        ContinuousLayoutSession, LayoutAdvanceStatus, LayoutSessionScope, LayoutWorkMeter,
    },
    LayoutConfig, LayoutRuntimePage, LineBreaking, TextMeasurementFonts,
};
use crate::style::StyledNode;

/// Resumable layout and pagination for one already styled chapter.
///
/// The layout cursor owns continuous-flow state while the pagination cursor
/// owns the open page. Sealed pages are moved into an advance result; the
/// open page remains private until later input seals it or chapter completion
/// explicitly finishes pagination.
#[derive(Debug)]
pub(crate) struct RuntimeChapterLayoutSession {
    layout: ContinuousLayoutSession,
    pagination: ContinuousPaginationSession,
    total_block_count: usize,
    finished: bool,
}

#[derive(Debug, Clone, PartialEq)]
#[must_use]
pub(crate) struct RuntimeChapterLayoutAdvance {
    pub(crate) status: LayoutAdvanceStatus,
    pub(crate) processed_top_level_nodes: usize,
    pub(crate) total_block_count: usize,
    pub(crate) newly_sealed_pages: Vec<LayoutRuntimePage>,
}

impl RuntimeChapterLayoutSession {
    pub(crate) fn new(
        styled_nodes: Vec<StyledNode>,
        image_sizes: ImageSizeIndex,
        layout_config: &LayoutConfig,
        line_breaking: LineBreaking,
        page_paint: Option<Value>,
    ) -> Self {
        Self {
            layout: ContinuousLayoutSession::new(
                styled_nodes,
                layout_config.content_width(),
                layout_config.content_height(),
                image_sizes,
                line_breaking,
            ),
            pagination: ContinuousPaginationSession::new(layout_config, page_paint),
            total_block_count: 0,
            finished: false,
        }
    }

    #[cfg(test)]
    pub(crate) fn advance<'fonts>(
        &mut self,
        budget: super::pagination_session::LayoutWorkBudget,
        fonts: &'fonts TextMeasurementFonts<'fonts>,
    ) -> RuntimeChapterLayoutAdvance {
        let mut work = LayoutWorkMeter::new(budget);
        self.advance_with_meter(&mut work, fonts)
    }

    pub(crate) fn advance_with_meter<'fonts>(
        &mut self,
        work: &mut LayoutWorkMeter,
        fonts: &'fonts TextMeasurementFonts<'fonts>,
    ) -> RuntimeChapterLayoutAdvance {
        assert!(!self.finished, "cannot advance a completed chapter layout");
        let layout = self
            .layout
            .advance_with_meter(work, LayoutSessionScope::Root, fonts);
        let batch_block_count = layout.output.len();
        self.total_block_count += batch_block_count;
        {
            let pushed = self.pagination.push_blocks(layout.output);
            debug_assert_eq!(pushed.processed_blocks, batch_block_count);
        }

        if layout.status == LayoutAdvanceStatus::Complete {
            {
                let finished = self.pagination.finish();
                debug_assert!(finished.snapshot.finished);
            }
            self.finished = true;
        }

        let newly_sealed_pages = self.pagination.take_sealed_pages();
        RuntimeChapterLayoutAdvance {
            status: layout.status,
            processed_top_level_nodes: layout.processed_top_level_nodes,
            total_block_count: self.total_block_count,
            newly_sealed_pages,
        }
    }
}

#[cfg(test)]
mod tests;
