use std::num::NonZeroUsize;

use super::RuntimeChapterLayoutSession;
use crate::layout::{
    pagination_flow::cursor::PendingContinuousPaginationSessionCleanup,
    pagination_session::{ContinuousLayoutSession, PendingContinuousLayoutSessionCleanup},
    CleanupProgress,
};

/// Copy-only remainder of a decomposed chapter session.
#[derive(Debug)]
struct ChapterSessionShell {
    total_block_count: usize,
    finished: bool,
}

/// Releases a chapter paginator before its continuous-layout state.
///
/// If the nested cursors require `PAG` and `LAY` units, this cursor requires
/// exactly `PAG + LAY + 5`: one source and one retirement boundary per nested
/// owner, followed by one scalar-owner boundary.
#[derive(Debug)]
pub(crate) struct PendingRuntimeChapterLayoutSessionCleanup {
    owner: Option<RuntimeChapterLayoutSession>,
    pagination: Option<PendingContinuousPaginationSessionCleanup>,
    layout_source: Option<ContinuousLayoutSession>,
    layout: Option<PendingContinuousLayoutSessionCleanup>,
    shell: Option<ChapterSessionShell>,
    stage: ChapterSessionCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChapterSessionCleanupStage {
    PaginationSource,
    Pagination,
    LayoutSource,
    Layout,
    Owner,
    Complete,
}

impl PendingRuntimeChapterLayoutSessionCleanup {
    pub(crate) fn new(owner: RuntimeChapterLayoutSession) -> Self {
        Self {
            owner: Some(owner),
            pagination: None,
            layout_source: None,
            layout: None,
            shell: None,
            stage: ChapterSessionCleanupStage::PaginationSource,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == ChapterSessionCleanupStage::Complete
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            ChapterSessionCleanupStage::PaginationSource => self.start_pagination(),
            ChapterSessionCleanupStage::Pagination => self.advance_pagination(),
            ChapterSessionCleanupStage::LayoutSource => self.start_layout(),
            ChapterSessionCleanupStage::Layout => self.advance_layout(),
            ChapterSessionCleanupStage::Owner => self.release_owner(),
            ChapterSessionCleanupStage::Complete => false,
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

    fn start_pagination(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its chapter session");
        let RuntimeChapterLayoutSession {
            layout,
            pagination,
            total_block_count,
            finished,
        } = owner;
        self.pagination = Some(PendingContinuousPaginationSessionCleanup::new(pagination));
        self.layout_source = Some(layout);
        self.shell = Some(ChapterSessionShell {
            total_block_count,
            finished,
        });
        self.stage = ChapterSessionCleanupStage::Pagination;
        true
    }

    fn advance_pagination(&mut self) -> bool {
        let pagination = self.pagination.as_mut().expect("pagination cleanup exists");
        if pagination.is_complete() {
            self.pagination = None;
            self.stage = ChapterSessionCleanupStage::LayoutSource;
            return true;
        }
        let advanced = pagination.advance_one();
        debug_assert!(advanced, "incomplete pagination cleanup has work");
        true
    }

    fn start_layout(&mut self) -> bool {
        let layout = self
            .layout_source
            .take()
            .expect("layout-session source exists");
        self.layout = Some(PendingContinuousLayoutSessionCleanup::new(layout));
        self.stage = ChapterSessionCleanupStage::Layout;
        true
    }

    fn advance_layout(&mut self) -> bool {
        let layout = self.layout.as_mut().expect("layout cleanup exists");
        if layout.is_complete() {
            self.layout = None;
            self.stage = ChapterSessionCleanupStage::Owner;
            return true;
        }
        let advanced = layout.advance_one();
        debug_assert!(advanced, "incomplete layout cleanup has work");
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("chapter-session shell exists");
        let ChapterSessionShell {
            total_block_count,
            finished,
        } = shell;
        let _ = (total_block_count, finished);
        self.stage = ChapterSessionCleanupStage::Complete;
        true
    }
}

impl Drop for PendingRuntimeChapterLayoutSessionCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "cleanup/tests.rs"]
mod tests;
