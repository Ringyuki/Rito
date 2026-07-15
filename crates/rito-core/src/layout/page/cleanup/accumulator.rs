use std::{mem, num::NonZeroUsize};

use super::{CleanupProgress, LayoutBlock, PendingRuntimePageVectorCleanup};
use crate::layout::{content::PendingRuntimeBlockVectorCleanup, page::RuntimePageAccumulator};

type LayoutPageAccumulator = RuntimePageAccumulator<LayoutBlock>;

/// Releases sealed pages and the open page before page paint and the scalar
/// accumulator shell.
///
/// Page paint remains an indivisible JSON destructor residual, so this cursor
/// does not by itself establish a wall-clock hard bound.
#[derive(Debug)]
#[allow(dead_code)] // Pagination-session retirement consumes this cursor next.
pub(crate) struct PendingRuntimePageAccumulatorCleanup {
    owner: Option<LayoutPageAccumulator>,
    pages: Option<PendingRuntimePageVectorCleanup>,
    blocks: Option<PendingRuntimeBlockVectorCleanup>,
    stage: PageAccumulatorCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PageAccumulatorCleanupStage {
    PagesSource,
    Pages,
    BlocksSource,
    Blocks,
    Paint,
    Owner,
    Complete,
}

#[allow(dead_code)] // Direct tests precede pagination-session retirement wiring.
impl PendingRuntimePageAccumulatorCleanup {
    pub(crate) fn new(owner: LayoutPageAccumulator) -> Self {
        Self {
            owner: Some(owner),
            pages: None,
            blocks: None,
            stage: PageAccumulatorCleanupStage::PagesSource,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == PageAccumulatorCleanupStage::Complete
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            PageAccumulatorCleanupStage::PagesSource => self.start_pages(),
            PageAccumulatorCleanupStage::Pages => self.advance_pages(),
            PageAccumulatorCleanupStage::BlocksSource => self.start_blocks(),
            PageAccumulatorCleanupStage::Blocks => self.advance_blocks(),
            PageAccumulatorCleanupStage::Paint => self.release_paint(),
            PageAccumulatorCleanupStage::Owner => self.release_owner(),
            PageAccumulatorCleanupStage::Complete => false,
        }
    }

    pub(crate) fn advance(&mut self, budget: NonZeroUsize) -> CleanupProgress {
        let mut consumed_units = 0;
        while consumed_units < budget.get() && self.advance_one() {
            consumed_units += 1;
        }
        let progress = CleanupProgress {
            consumed_units,
            complete: self.is_complete(),
        };
        debug_assert!(progress.complete || progress.consumed_units == budget.get());
        progress
    }

    pub(crate) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }

    fn start_pages(&mut self) -> bool {
        let owner = self.owner.as_mut().expect("cleanup owns its accumulator");
        self.pages = Some(PendingRuntimePageVectorCleanup::new(mem::take(
            &mut owner.pages,
        )));
        self.stage = PageAccumulatorCleanupStage::Pages;
        true
    }

    fn advance_pages(&mut self) -> bool {
        let pages = self.pages.as_mut().expect("page cleanup exists");
        if pages.is_complete() {
            self.pages = None;
            self.stage = PageAccumulatorCleanupStage::BlocksSource;
            return true;
        }
        let advanced = pages.advance_one();
        debug_assert!(advanced, "incomplete page cleanup has work");
        true
    }

    fn start_blocks(&mut self) -> bool {
        let owner = self.owner.as_mut().expect("cleanup owns its accumulator");
        self.blocks = Some(PendingRuntimeBlockVectorCleanup::new(mem::take(
            &mut owner.page_blocks,
        )));
        self.stage = PageAccumulatorCleanupStage::Blocks;
        true
    }

    fn advance_blocks(&mut self) -> bool {
        let blocks = self.blocks.as_mut().expect("block cleanup exists");
        if blocks.is_complete() {
            self.blocks = None;
            self.stage = PageAccumulatorCleanupStage::Paint;
            return true;
        }
        let advanced = blocks.advance_one();
        debug_assert!(advanced, "incomplete block cleanup has work");
        true
    }

    fn release_paint(&mut self) -> bool {
        let owner = self.owner.as_mut().expect("cleanup owns its accumulator");
        drop(owner.page_paint.take());
        self.stage = PageAccumulatorCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its accumulator");
        debug_assert!(owner.pages.is_empty());
        debug_assert!(owner.page_blocks.is_empty());
        debug_assert!(owner.page_paint.is_none());
        drop(owner);
        self.stage = PageAccumulatorCleanupStage::Complete;
        true
    }

    #[cfg(test)]
    fn owner(&self) -> &LayoutPageAccumulator {
        self.owner.as_ref().expect("cleanup owns its accumulator")
    }
}

impl Drop for PendingRuntimePageAccumulatorCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "accumulator/tests.rs"]
mod tests;
