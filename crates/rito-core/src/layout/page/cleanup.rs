use std::{mem, num::NonZeroUsize, vec::IntoIter};

use super::RuntimePage;
use crate::layout::{
    content::{PendingRuntimeBlockCleanup, RuntimeBlock},
    line::LineBox,
    CleanupProgress,
};

mod accumulator;
mod vector;

pub(crate) use accumulator::PendingRuntimePageAccumulatorCleanup;
pub(crate) use vector::PendingRuntimePageVectorCleanup;

type LayoutBlock = RuntimeBlock<LineBox>;
type LayoutPage = RuntimePage<LayoutBlock>;

/// Releases one page's block tree before its paint and owner shell.
#[derive(Debug)]
#[allow(dead_code)] // Runtime revision retirement consumes this cursor next.
pub(crate) struct PendingRuntimePageCleanup {
    owner: Option<LayoutPage>,
    blocks: Option<IntoIter<LayoutBlock>>,
    block: Option<PendingRuntimeBlockCleanup>,
    stage: PageCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PageCleanupStage {
    BlocksSource,
    Blocks,
    Paint,
    Owner,
    Complete,
}

#[allow(dead_code)] // Direct tests precede runtime revision retirement wiring.
impl PendingRuntimePageCleanup {
    pub(crate) fn new(owner: LayoutPage) -> Self {
        Self {
            owner: Some(owner),
            blocks: None,
            block: None,
            stage: PageCleanupStage::BlocksSource,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == PageCleanupStage::Complete
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            PageCleanupStage::BlocksSource => self.start_blocks(),
            PageCleanupStage::Blocks => self.advance_blocks(),
            PageCleanupStage::Paint => self.release_paint(),
            PageCleanupStage::Owner => self.release_owner(),
            PageCleanupStage::Complete => false,
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

    fn start_blocks(&mut self) -> bool {
        let owner = self.owner.as_mut().expect("cleanup owns its page");
        self.blocks = Some(mem::take(&mut owner.content).into_iter());
        self.stage = PageCleanupStage::Blocks;
        true
    }

    fn advance_blocks(&mut self) -> bool {
        if self.block.as_ref().is_some_and(|block| block.is_complete()) {
            self.block = None;
            return true;
        }
        if let Some(block) = self.block.as_mut() {
            return block.advance_one();
        }
        let blocks = self.blocks.as_mut().expect("block source exists");
        if let Some(block) = blocks.next() {
            self.block = Some(PendingRuntimeBlockCleanup::new(block));
            return self
                .block
                .as_mut()
                .expect("active block cleanup exists")
                .advance_one();
        }
        self.blocks = None;
        self.stage = PageCleanupStage::Paint;
        true
    }

    fn release_paint(&mut self) -> bool {
        let owner = self.owner.as_mut().expect("cleanup owns its page");
        drop(owner.paint.take());
        self.stage = PageCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its page");
        debug_assert!(owner.content.is_empty());
        debug_assert!(owner.paint.is_none());
        drop(owner);
        self.stage = PageCleanupStage::Complete;
        true
    }

    #[cfg(test)]
    fn owner(&self) -> &LayoutPage {
        self.owner.as_ref().expect("cleanup owns its page")
    }
}

impl Drop for PendingRuntimePageCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "cleanup/tests.rs"]
mod tests;
