use std::{
    collections::{btree_map, btree_set},
    num::NonZeroUsize,
};

use crate::{
    interaction::FootnoteEntry, runtime::cleanup::CleanupProgress,
    runtime::frame::RuntimeRevisionInteractions,
};

type FootnoteSource = btree_map::IntoIter<String, FootnoteEntry>;
type CompletedChapterSource = btree_set::IntoIter<String>;

/// Incrementally releases the persistent semantic payload of one revision.
///
/// With `F` footnotes and `C` completed chapter idrefs, cleanup costs exactly
/// `F + C + 3` units. Standard-library B-tree iteration retains logarithmic
/// internal work.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeRevisionInteractionsCleanup {
    owner: Option<RuntimeRevisionInteractions>,
    footnotes: Option<FootnoteSource>,
    completed_chapter_idrefs: Option<CompletedChapterSource>,
    stage: RuntimeRevisionInteractionsCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeRevisionInteractionsCleanupStage {
    Source,
    Footnotes,
    CompletedChapterIdrefs,
    Complete,
}

impl PendingRuntimeRevisionInteractionsCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeRevisionInteractions) -> Self {
        Self {
            owner: Some(owner),
            footnotes: None,
            completed_chapter_idrefs: None,
            stage: RuntimeRevisionInteractionsCleanupStage::Source,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == RuntimeRevisionInteractionsCleanupStage::Complete
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        match self.stage {
            RuntimeRevisionInteractionsCleanupStage::Source => self.start_sources(),
            RuntimeRevisionInteractionsCleanupStage::Footnotes => self.release_next_footnote(),
            RuntimeRevisionInteractionsCleanupStage::CompletedChapterIdrefs => {
                self.release_next_completed_chapter_idref()
            }
            RuntimeRevisionInteractionsCleanupStage::Complete => false,
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

    fn start_sources(&mut self) -> bool {
        let owner = self
            .owner
            .take()
            .expect("cleanup owns its revision interactions");
        let RuntimeRevisionInteractions {
            publication_footnotes: _,
            footnotes,
            pending_footnote_keys: _,
            footnote_index_complete: _,
            completed_chapter_idrefs,
        } = owner;
        self.footnotes = Some(footnotes.into_iter());
        self.completed_chapter_idrefs = Some(completed_chapter_idrefs.into_iter());
        self.stage = RuntimeRevisionInteractionsCleanupStage::Footnotes;
        true
    }

    fn release_next_footnote(&mut self) -> bool {
        let footnotes = self.footnotes.as_mut().expect("footnote source exists");
        if let Some(entry) = footnotes.next() {
            drop(entry);
            return true;
        }
        self.footnotes = None;
        self.stage = RuntimeRevisionInteractionsCleanupStage::CompletedChapterIdrefs;
        true
    }

    fn release_next_completed_chapter_idref(&mut self) -> bool {
        let completed = self
            .completed_chapter_idrefs
            .as_mut()
            .expect("completed-chapter source exists");
        if let Some(idref) = completed.next() {
            drop(idref);
            return true;
        }
        self.completed_chapter_idrefs = None;
        self.stage = RuntimeRevisionInteractionsCleanupStage::Complete;
        true
    }
}

impl Drop for PendingRuntimeRevisionInteractionsCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "interactions/tests.rs"]
mod tests;
