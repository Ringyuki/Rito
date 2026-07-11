use serde_json::Value;

use super::{
    image_size::ImageSizeIndex,
    pagination_flow::cursor::ContinuousPaginationSession,
    pagination_session::{ContinuousLayoutSession, LayoutAdvanceStatus, LayoutWorkBudget},
    LayoutConfig, LayoutRuntimePage, LineBreaking, TextMeasurementFonts,
};
use crate::style::StyledNode;

/// Resumable layout and pagination for one already styled chapter.
///
/// The layout cursor owns continuous-flow state while the pagination cursor
/// owns the open page. Only sealed pages are cloned into an advance result; the
/// open page remains private until later input seals it or chapter completion
/// explicitly finishes pagination.
#[derive(Debug)]
#[allow(
    dead_code,
    reason = "the layout continuation boundary intentionally lands before its runtime owner"
)]
pub(crate) struct RuntimeChapterLayoutSession {
    layout: ContinuousLayoutSession,
    pagination: ContinuousPaginationSession,
    published_page_count: usize,
    total_block_count: usize,
    finished: bool,
}

#[derive(Debug, Clone, PartialEq)]
#[must_use]
#[allow(
    dead_code,
    reason = "the layout continuation boundary intentionally lands before its runtime owner"
)]
pub(crate) struct RuntimeChapterLayoutAdvance {
    pub(crate) status: LayoutAdvanceStatus,
    pub(crate) processed_top_level_nodes: usize,
    pub(crate) total_block_count: usize,
    pub(crate) newly_sealed_pages: Vec<LayoutRuntimePage>,
}

#[allow(
    dead_code,
    reason = "the layout continuation boundary intentionally lands before its runtime owner"
)]
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
            published_page_count: 0,
            total_block_count: 0,
            finished: false,
        }
    }

    pub(crate) fn advance<'fonts>(
        &mut self,
        budget: LayoutWorkBudget,
        fonts: &'fonts TextMeasurementFonts<'fonts>,
    ) -> RuntimeChapterLayoutAdvance {
        assert!(!self.finished, "cannot advance a completed chapter layout");
        let layout = self.layout.advance(budget, fonts);
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

        let snapshot = self.pagination.snapshot();
        let newly_sealed_pages = snapshot.sealed_pages[self.published_page_count..].to_vec();
        self.published_page_count = snapshot.sealed_pages.len();
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
