use std::{collections::btree_set::IntoIter, num::NonZeroUsize};

use super::CleanupProgress;
use crate::layout::{BuiltLayout, LayoutSummary, PendingRuntimePageVectorCleanup};

/// Releases a built layout's recursive pages before its diagnostic metadata.
///
/// If the nested page-vector cleanup costs `PV` units and there are `CS`
/// chapter-start pages, this cursor costs exactly `PV + CS + 4` units.
/// `LayoutSummary` retains unbounded vectors and JSON values, so it remains an
/// indivisible destructor residual. This cursor establishes structural stack
/// safety, not a wall-clock cleanup bound.
#[derive(Debug)]
#[allow(dead_code)] // The runtime cleanup queue consumes this through revision retirement next.
pub(crate) struct PendingBuiltLayoutCleanup {
    owner: Option<BuiltLayout>,
    pages: Option<PendingRuntimePageVectorCleanup>,
    summary: Option<LayoutSummary>,
    chapter_start_pages: Option<IntoIter<usize>>,
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
            BuiltLayoutCleanupStage::ChapterStartPages => self.release_next_chapter_start_page(),
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
        self.chapter_start_pages = Some(chapter_start_pages.into_iter());
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

    fn release_next_chapter_start_page(&mut self) -> bool {
        let chapter_start_pages = self
            .chapter_start_pages
            .as_mut()
            .expect("chapter-start page source exists");
        if chapter_start_pages.next().is_some() {
            return true;
        }
        self.chapter_start_pages = None;
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
