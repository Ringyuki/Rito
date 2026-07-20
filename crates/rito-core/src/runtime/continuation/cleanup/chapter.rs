use std::{collections::btree_set, mem, num::NonZeroUsize};

use crate::layout::{
    runtime_session::PendingRuntimeChapterLayoutSessionCleanup, CleanupProgress,
    PendingRuntimePageVectorCleanup,
};

use super::super::state::RuntimeChapterContinuation;

/// Copy-only remainder of a decomposed active chapter.
#[derive(Debug)]
struct ChapterContinuationShell {
    has_published_pages: bool,
    chapter_complete: bool,
    total_block_count: usize,
}

/// Releases unpublished pages before the active chapter layout session.
///
/// If the nested cursors require `V` and `CH` units and the chapter owns `C`
/// completed idrefs, this cursor requires exactly `V + CH + C + 7`: one source
/// and one retirement boundary per nested owner, then idref and the scalar
/// owner shell.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeChapterContinuationCleanup {
    owner: Option<RuntimeChapterContinuation>,
    unpublished: Option<PendingRuntimePageVectorCleanup>,
    session: Option<PendingRuntimeChapterLayoutSessionCleanup>,
    completed_chapter_idrefs: Option<btree_set::IntoIter<String>>,
    idref: Option<String>,
    shell: Option<ChapterContinuationShell>,
    stage: ChapterContinuationCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChapterContinuationCleanupStage {
    UnpublishedSource,
    Unpublished,
    SessionSource,
    Session,
    CompletedChapterIdrefs,
    Idref,
    Owner,
    Complete,
}

impl PendingRuntimeChapterContinuationCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeChapterContinuation) -> Self {
        Self {
            owner: Some(owner),
            unpublished: None,
            session: None,
            completed_chapter_idrefs: None,
            idref: None,
            shell: None,
            stage: ChapterContinuationCleanupStage::UnpublishedSource,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == ChapterContinuationCleanupStage::Complete
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        match self.stage {
            ChapterContinuationCleanupStage::UnpublishedSource => self.start_unpublished(),
            ChapterContinuationCleanupStage::Unpublished => self.advance_unpublished(),
            ChapterContinuationCleanupStage::SessionSource => self.start_session(),
            ChapterContinuationCleanupStage::Session => self.advance_session(),
            ChapterContinuationCleanupStage::CompletedChapterIdrefs => {
                self.release_next_completed_chapter_idref()
            }
            ChapterContinuationCleanupStage::Idref => self.release_idref(),
            ChapterContinuationCleanupStage::Owner => self.release_owner(),
            ChapterContinuationCleanupStage::Complete => false,
        }
    }

    pub(in crate::runtime) fn advance(&mut self, budget: NonZeroUsize) -> CleanupProgress {
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

    pub(in crate::runtime) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }

    fn start_unpublished(&mut self) -> bool {
        let owner = self
            .owner
            .as_mut()
            .expect("cleanup owns its active chapter");
        self.unpublished = Some(PendingRuntimePageVectorCleanup::new(mem::take(
            &mut owner.unpublished_pages,
        )));
        self.stage = ChapterContinuationCleanupStage::Unpublished;
        true
    }

    fn advance_unpublished(&mut self) -> bool {
        let unpublished = self
            .unpublished
            .as_mut()
            .expect("unpublished-page cleanup exists");
        if unpublished.is_complete() {
            self.unpublished = None;
            self.stage = ChapterContinuationCleanupStage::SessionSource;
            return true;
        }
        let advanced = unpublished.advance_one();
        debug_assert!(advanced, "incomplete unpublished-page cleanup has work");
        true
    }

    fn start_session(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its active chapter");
        let RuntimeChapterContinuation {
            idref,
            session,
            completed_chapter_idrefs,
            unpublished_pages,
            has_published_pages,
            chapter_complete,
            total_block_count,
        } = owner;
        debug_assert!(unpublished_pages.is_empty());
        drop(unpublished_pages);
        self.session = Some(PendingRuntimeChapterLayoutSessionCleanup::new(session));
        self.completed_chapter_idrefs = Some(completed_chapter_idrefs.into_iter());
        self.idref = Some(idref);
        self.shell = Some(ChapterContinuationShell {
            has_published_pages,
            chapter_complete,
            total_block_count,
        });
        self.stage = ChapterContinuationCleanupStage::Session;
        true
    }

    fn advance_session(&mut self) -> bool {
        let session = self
            .session
            .as_mut()
            .expect("chapter-session cleanup exists");
        if session.is_complete() {
            self.session = None;
            self.stage = ChapterContinuationCleanupStage::CompletedChapterIdrefs;
            return true;
        }
        let advanced = session.advance_one();
        debug_assert!(advanced, "incomplete chapter-session cleanup has work");
        true
    }

    fn release_next_completed_chapter_idref(&mut self) -> bool {
        let completed_chapter_idrefs = self
            .completed_chapter_idrefs
            .as_mut()
            .expect("completed-chapter idref source exists");
        if let Some(idref) = completed_chapter_idrefs.next() {
            drop(idref);
            return true;
        }
        self.completed_chapter_idrefs = None;
        self.stage = ChapterContinuationCleanupStage::Idref;
        true
    }

    fn release_idref(&mut self) -> bool {
        drop(self.idref.take().expect("chapter idref exists"));
        self.stage = ChapterContinuationCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("active-chapter shell exists");
        let ChapterContinuationShell {
            has_published_pages,
            chapter_complete,
            total_block_count,
        } = shell;
        let _ = (has_published_pages, chapter_complete, total_block_count);
        self.stage = ChapterContinuationCleanupStage::Complete;
        true
    }
}

impl Drop for PendingRuntimeChapterContinuationCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "chapter/tests.rs"]
mod tests;
