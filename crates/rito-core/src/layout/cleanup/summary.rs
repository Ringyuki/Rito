use std::{collections::btree_map::IntoIter, num::NonZeroUsize};

use super::CleanupProgress;
use crate::layout::{LayoutSummary, PaginationFlowChapterRange};

/// Releases a layout summary's chapter map before its remaining diagnostics.
///
/// With `CM` chapter-map entries, this cursor costs exactly `CM + 3` structural
/// units. A B-tree iterator step may still perform standard-library internal
/// tree work. Runtime summaries keep every other diagnostic vector and string
/// empty; detailed full-publication summaries retain those values in the final
/// owner unit and remain a destructor residual.
#[derive(Debug)]
pub(super) struct PendingLayoutSummaryCleanup {
    owner: Option<LayoutSummary>,
    chapter_map: Option<IntoIter<String, PaginationFlowChapterRange>>,
    stage: LayoutSummaryCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LayoutSummaryCleanupStage {
    ChapterMapSource,
    ChapterMap,
    Owner,
    Complete,
}

impl PendingLayoutSummaryCleanup {
    pub(super) fn new(owner: LayoutSummary) -> Self {
        Self {
            owner: Some(owner),
            chapter_map: None,
            stage: LayoutSummaryCleanupStage::ChapterMapSource,
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        self.stage == LayoutSummaryCleanupStage::Complete
    }

    pub(super) fn advance_one(&mut self) -> bool {
        match self.stage {
            LayoutSummaryCleanupStage::ChapterMapSource => self.start_chapter_map(),
            LayoutSummaryCleanupStage::ChapterMap => self.release_next_chapter(),
            LayoutSummaryCleanupStage::Owner => self.release_owner(),
            LayoutSummaryCleanupStage::Complete => false,
        }
    }

    pub(super) fn advance(&mut self, budget: NonZeroUsize) -> CleanupProgress {
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

    pub(super) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }

    fn start_chapter_map(&mut self) -> bool {
        let owner = self.owner.as_mut().expect("layout-summary owner exists");
        self.chapter_map = Some(std::mem::take(&mut owner.pagination_flow.chapter_map).into_iter());
        self.stage = LayoutSummaryCleanupStage::ChapterMap;
        true
    }

    fn release_next_chapter(&mut self) -> bool {
        let chapter_map = self
            .chapter_map
            .as_mut()
            .expect("layout-summary chapter-map source exists");
        if let Some(entry) = chapter_map.next() {
            drop(entry);
            return true;
        }
        self.chapter_map = None;
        self.stage = LayoutSummaryCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        drop(self.owner.take().expect("layout-summary owner exists"));
        self.stage = LayoutSummaryCleanupStage::Complete;
        true
    }
}

impl Drop for PendingLayoutSummaryCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "summary/tests.rs"]
mod tests;
