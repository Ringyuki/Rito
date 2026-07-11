use std::ops::Range;

use serde_json::Value;

use super::super::{
    content::RuntimeBlock, line::LineBox, page::RuntimePageAccumulator, LayoutConfig,
    LayoutRuntimePage,
};
use super::place_pagination_block;

type PaginationBlock = RuntimeBlock<LineBox>;
type PaginationState = RuntimePageAccumulator<PaginationBlock>;

#[derive(Debug, Clone, Copy)]
struct PreviousBlockGeometry {
    y: f64,
    height: f64,
}

impl PreviousBlockGeometry {
    fn spacing_before(self, block: &PaginationBlock) -> f64 {
        block.y - (self.y + self.height)
    }
}

/// A view of the page extent that is stable at a pagination yield point.
///
/// Only sealed pages are exposed. The accumulator's current page is omitted
/// until a later block seals it or [`ContinuousPaginationSession::finish`]
/// does so explicitly. This is a borrowed synchronous view; callers must clone
/// or serialize it before crossing an asynchronous yield point.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PaginationSessionSnapshot<'a> {
    pub(crate) sealed_pages: &'a [LayoutRuntimePage],
    pub(crate) finished: bool,
}

#[derive(Debug, Clone)]
#[must_use]
pub(crate) struct PaginationPushResult<'a> {
    pub(crate) processed_blocks: usize,
    pub(crate) newly_sealed_pages: Range<usize>,
    pub(crate) snapshot: PaginationSessionSnapshot<'a>,
}

#[derive(Debug, Clone)]
#[must_use]
pub(crate) struct PaginationFinishResult<'a> {
    pub(crate) newly_sealed_pages: Range<usize>,
    pub(crate) snapshot: PaginationSessionSnapshot<'a>,
}

/// Stateful pagination over incremental continuous-layout block batches.
///
/// Input blocks are processed exactly once. The current page, previous source
/// block geometry, page paint, and layout policy remain owned by the session.
/// Splitting one block (including recursive composite splitting) is currently
/// atomic within `push_blocks`.
#[derive(Debug)]
pub(crate) struct ContinuousPaginationSession {
    state: PaginationState,
    previous_block: Option<PreviousBlockGeometry>,
    layout_config: LayoutConfig,
    content_height: f64,
    pagination_disabled: bool,
    finished: bool,
}

impl ContinuousPaginationSession {
    pub(crate) fn new(layout_config: &LayoutConfig, page_paint: Option<Value>) -> Self {
        let content_height = layout_config.content_height();
        Self {
            state: PaginationState::new(
                layout_config.page_width,
                layout_config.page_height,
                page_paint,
            ),
            previous_block: None,
            layout_config: layout_config.clone(),
            content_height,
            pagination_disabled: content_height <= 0.0,
            finished: false,
        }
    }

    pub(crate) fn push_blocks(&mut self, blocks: Vec<PaginationBlock>) -> PaginationPushResult<'_> {
        assert!(!self.finished, "cannot push blocks after pagination finish");
        let sealed_before = self.state.pages.len();
        let processed_blocks = blocks.len();

        for block in blocks {
            let geometry = PreviousBlockGeometry {
                y: block.y,
                height: block.height,
            };
            let spacing = self
                .previous_block
                .map_or(block.y, |previous| previous.spacing_before(&block));
            if !self.pagination_disabled {
                place_pagination_block(
                    block,
                    spacing,
                    self.content_height,
                    &mut self.state,
                    &self.layout_config,
                );
            }
            self.previous_block = Some(geometry);
        }

        let sealed_after = self.state.pages.len();
        PaginationPushResult {
            processed_blocks,
            newly_sealed_pages: sealed_before..sealed_after,
            snapshot: self.snapshot(),
        }
    }

    pub(crate) fn snapshot(&self) -> PaginationSessionSnapshot<'_> {
        PaginationSessionSnapshot {
            sealed_pages: &self.state.pages,
            finished: self.finished,
        }
    }

    pub(crate) fn finish(&mut self) -> PaginationFinishResult<'_> {
        let sealed_before = self.state.pages.len();
        if !self.finished {
            if !self.state.page_blocks.is_empty() {
                self.state.emit_page();
            }
            self.finished = true;
        }
        PaginationFinishResult {
            newly_sealed_pages: sealed_before..self.state.pages.len(),
            snapshot: self.snapshot(),
        }
    }

    pub(crate) fn into_pages(mut self) -> Vec<LayoutRuntimePage> {
        let finished = self.finish();
        debug_assert_eq!(
            finished.newly_sealed_pages.end,
            finished.snapshot.sealed_pages.len()
        );
        debug_assert!(finished.snapshot.finished);
        self.state.pages
    }
}

#[cfg(test)]
mod tests;
