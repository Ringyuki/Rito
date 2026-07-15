use std::{collections::BTreeSet, num::NonZeroUsize};

use super::CleanupProgress;
use crate::layout::{BuiltLayout, LayoutSummary, PendingRuntimePageVectorCleanup};

/// Releases a built layout's recursive pages before its diagnostic metadata.
///
/// If the nested page-vector cleanup costs `PV` units, this cursor costs
/// exactly `PV + 4` units. `LayoutSummary` and `chapter_start_pages` retain
/// unbounded vectors, JSON values and B-trees, so they remain indivisible
/// destructor residuals. This cursor establishes structural stack safety, not
/// a wall-clock cleanup bound.
#[derive(Debug)]
#[allow(dead_code)] // The runtime cleanup queue consumes this through revision retirement next.
pub(crate) struct PendingBuiltLayoutCleanup {
    owner: Option<BuiltLayout>,
    pages: Option<PendingRuntimePageVectorCleanup>,
    summary: Option<LayoutSummary>,
    chapter_start_pages: Option<BTreeSet<usize>>,
    stage: BuiltLayoutCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Kept alongside the pending cursor until production scheduling lands.
enum BuiltLayoutCleanupStage {
    PagesSource,
    Pages,
    Summary,
    ChapterStartPages,
    Complete,
}

#[allow(dead_code)] // Direct tests precede production revision retirement wiring.
impl PendingBuiltLayoutCleanup {
    pub(crate) fn new(owner: BuiltLayout) -> Self {
        Self {
            owner: Some(owner),
            pages: None,
            summary: None,
            chapter_start_pages: None,
            stage: BuiltLayoutCleanupStage::PagesSource,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == BuiltLayoutCleanupStage::Complete
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            BuiltLayoutCleanupStage::PagesSource => self.start_pages(),
            BuiltLayoutCleanupStage::Pages => self.advance_pages(),
            BuiltLayoutCleanupStage::Summary => self.release_summary(),
            BuiltLayoutCleanupStage::ChapterStartPages => self.release_chapter_start_pages(),
            BuiltLayoutCleanupStage::Complete => false,
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
        let owner = self.owner.take().expect("cleanup owns its built layout");
        let BuiltLayout {
            summary,
            pages,
            chapter_start_pages,
        } = owner;
        self.pages = Some(PendingRuntimePageVectorCleanup::new(pages));
        self.summary = Some(summary);
        self.chapter_start_pages = Some(chapter_start_pages);
        self.stage = BuiltLayoutCleanupStage::Pages;
        true
    }

    fn advance_pages(&mut self) -> bool {
        let pages = self.pages.as_mut().expect("page-vector cleanup exists");
        if pages.is_complete() {
            self.pages = None;
            self.stage = BuiltLayoutCleanupStage::Summary;
            return true;
        }
        let advanced = pages.advance_one();
        debug_assert!(advanced, "incomplete page-vector cleanup has work");
        true
    }

    fn release_summary(&mut self) -> bool {
        drop(self.summary.take().expect("layout summary exists"));
        self.stage = BuiltLayoutCleanupStage::ChapterStartPages;
        true
    }

    fn release_chapter_start_pages(&mut self) -> bool {
        drop(
            self.chapter_start_pages
                .take()
                .expect("chapter-start pages exist"),
        );
        self.stage = BuiltLayoutCleanupStage::Complete;
        true
    }
}

impl Drop for PendingBuiltLayoutCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "built/tests.rs"]
mod tests;
