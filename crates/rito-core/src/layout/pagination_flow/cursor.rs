use std::ops::Range;

use serde_json::Value;

use super::super::{
    content::RuntimeBlock, line::LineBox, page::RuntimePageAccumulator, LayoutConfig,
    LayoutRuntimePage, PaginationPolicy,
};
use super::place_pagination_block;

mod cleanup;

#[allow(unused_imports)] // Chapter-session retirement consumes this cursor next.
pub(crate) use cleanup::PendingContinuousPaginationSessionCleanup;

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

fn snapshot_pagination_policy(policy: Option<&PaginationPolicy>) -> Option<PaginationPolicy> {
    policy.map(|policy| {
        let PaginationPolicy {
            enabled,
            default_orphans,
            default_widows,
        } = policy;
        PaginationPolicy {
            enabled: *enabled,
            default_orphans: *default_orphans,
            default_widows: *default_widows,
        }
    })
}

/// A view of the page extent that is stable at a pagination yield point.
///
/// Only currently buffered sealed pages are exposed. The accumulator's current
/// page is omitted until a later block seals it or
/// [`ContinuousPaginationSession::finish`] does so explicitly. Pages moved out
/// by [`ContinuousPaginationSession::take_sealed_pages`] are no longer included.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PaginationSessionSnapshot<'a> {
    pub(crate) sealed_pages: &'a [LayoutRuntimePage],
    pub(crate) finished: bool,
}

#[derive(Debug, Clone)]
#[must_use]
pub(crate) struct PaginationPushResult<'a> {
    pub(crate) processed_blocks: usize,
    /// Range within `snapshot.sealed_pages`, not chapter-local page indexes.
    pub(crate) newly_sealed_pages: Range<usize>,
    pub(crate) snapshot: PaginationSessionSnapshot<'a>,
}

#[derive(Debug, Clone)]
#[must_use]
pub(crate) struct PaginationFinishResult<'a> {
    /// Range within `snapshot.sealed_pages`, not chapter-local page indexes.
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
    pagination_policy: Option<PaginationPolicy>,
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
            pagination_policy: snapshot_pagination_policy(layout_config.pagination_policy.as_ref()),
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
                    self.pagination_policy.as_ref(),
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

    #[cfg(test)]
    pub(crate) fn open_page_block_count(&self) -> usize {
        self.state.page_blocks.len()
    }

    /// Moves all currently buffered sealed pages out of the session.
    /// Chapter-local page indexes remain monotonic across subsequent takes.
    pub(crate) fn take_sealed_pages(&mut self) -> Vec<LayoutRuntimePage> {
        self.state.take_pages()
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

    /// Finishes and returns only pages still buffered by the session.
    /// Eager callers use this without mixing in [`Self::take_sealed_pages`].
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
