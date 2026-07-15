use std::{mem, num::NonZeroUsize};

use crate::{
    layout::{
        runtime_session::PendingRuntimeChapterLayoutSessionCleanup, CleanupProgress,
        PendingRuntimePageVectorCleanup,
    },
    runtime::frame::RuntimeRevisionInteractions,
};

use super::super::state::RuntimeChapterContinuation;

/// Copy-only remainder of a decomposed active chapter.
#[derive(Debug)]
struct ChapterContinuationShell {
    has_published_pages: bool,
}

/// Releases unpublished pages before the active chapter layout session.
///
/// If the nested cursors require `V` and `CH` units, this cursor requires
/// exactly `V + CH + 7`: one source and one retirement boundary per nested
/// owner, then interactions, idref, and the scalar owner shell.
/// `RuntimeRevisionInteractions` B-tree payloads remain one indivisible
/// destructor residual, so this cursor does not establish a wall-clock bound.
#[derive(Debug)]
pub(in crate::runtime::continuation) struct PendingRuntimeChapterContinuationCleanup {
    owner: Option<RuntimeChapterContinuation>,
    unpublished: Option<PendingRuntimePageVectorCleanup>,
    session: Option<PendingRuntimeChapterLayoutSessionCleanup>,
    interactions: Option<RuntimeRevisionInteractions>,
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
    Interactions,
    Idref,
    Owner,
    Complete,
}

impl PendingRuntimeChapterContinuationCleanup {
    pub(in crate::runtime::continuation) fn new(owner: RuntimeChapterContinuation) -> Self {
        Self {
            owner: Some(owner),
            unpublished: None,
            session: None,
            interactions: None,
            idref: None,
            shell: None,
            stage: ChapterContinuationCleanupStage::UnpublishedSource,
        }
    }

    pub(in crate::runtime::continuation) fn is_complete(&self) -> bool {
        self.stage == ChapterContinuationCleanupStage::Complete
    }

    pub(in crate::runtime::continuation) fn advance_one(&mut self) -> bool {
        match self.stage {
            ChapterContinuationCleanupStage::UnpublishedSource => self.start_unpublished(),
            ChapterContinuationCleanupStage::Unpublished => self.advance_unpublished(),
            ChapterContinuationCleanupStage::SessionSource => self.start_session(),
            ChapterContinuationCleanupStage::Session => self.advance_session(),
            ChapterContinuationCleanupStage::Interactions => self.release_interactions(),
            ChapterContinuationCleanupStage::Idref => self.release_idref(),
            ChapterContinuationCleanupStage::Owner => self.release_owner(),
            ChapterContinuationCleanupStage::Complete => false,
        }
    }

    pub(in crate::runtime::continuation) fn advance(
        &mut self,
        budget: NonZeroUsize,
    ) -> CleanupProgress {
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

    pub(in crate::runtime::continuation) fn drain(&mut self) {
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
            interactions,
            unpublished_pages,
            has_published_pages,
        } = owner;
        debug_assert!(unpublished_pages.is_empty());
        drop(unpublished_pages);
        self.session = Some(PendingRuntimeChapterLayoutSessionCleanup::new(session));
        self.interactions = Some(interactions);
        self.idref = Some(idref);
        self.shell = Some(ChapterContinuationShell {
            has_published_pages,
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
            self.stage = ChapterContinuationCleanupStage::Interactions;
            return true;
        }
        let advanced = session.advance_one();
        debug_assert!(advanced, "incomplete chapter-session cleanup has work");
        true
    }

    fn release_interactions(&mut self) -> bool {
        drop(
            self.interactions
                .take()
                .expect("chapter interactions exist"),
        );
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
        } = shell;
        let _ = has_published_pages;
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
