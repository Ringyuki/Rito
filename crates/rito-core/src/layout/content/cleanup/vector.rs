use std::{num::NonZeroUsize, vec::IntoIter};

use super::{CleanupProgress, LayoutBlock, PendingRuntimeBlockCleanup};

/// Releases a block vector without recursively dropping unread block trees.
#[derive(Debug)]
#[allow(dead_code)] // Runtime page-accumulator retirement consumes this next.
pub(crate) struct PendingRuntimeBlockVectorCleanup {
    owner: Option<Vec<LayoutBlock>>,
    blocks: Option<IntoIter<LayoutBlock>>,
    block: Option<PendingRuntimeBlockCleanup>,
    stage: BlockVectorCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlockVectorCleanupStage {
    BlocksSource,
    Blocks,
    Complete,
}

#[allow(dead_code)] // Direct tests precede page-accumulator retirement wiring.
impl PendingRuntimeBlockVectorCleanup {
    pub(crate) fn new(owner: Vec<LayoutBlock>) -> Self {
        Self {
            owner: Some(owner),
            blocks: None,
            block: None,
            stage: BlockVectorCleanupStage::BlocksSource,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == BlockVectorCleanupStage::Complete
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            BlockVectorCleanupStage::BlocksSource => self.start_blocks(),
            BlockVectorCleanupStage::Blocks => self.advance_blocks(),
            BlockVectorCleanupStage::Complete => false,
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
        let owner = self.owner.take().expect("cleanup owns its block vector");
        self.blocks = Some(owner.into_iter());
        self.stage = BlockVectorCleanupStage::Blocks;
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
        self.stage = BlockVectorCleanupStage::Complete;
        true
    }
}

impl Drop for PendingRuntimeBlockVectorCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "vector/tests.rs"]
mod tests;
