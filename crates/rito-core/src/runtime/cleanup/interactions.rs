use std::{
    collections::{btree_map, btree_set},
    num::NonZeroUsize,
};

use crate::{
    interaction::FootnoteEntry, layout::CleanupProgress,
    runtime::frame::RuntimeRevisionInteractions,
};

use self::chapter_text::PendingRuntimeChapterTextIndexSourceCleanup;
pub(in crate::runtime) use self::vector::PendingRuntimeRevisionInteractionsVectorCleanup;

mod chapter_text;
mod vector;

type FootnoteSource = btree_map::IntoIter<String, FootnoteEntry>;
type CompletedChapterSource = btree_set::IntoIter<String>;

/// Incrementally releases the persistent semantic payload of one revision.
///
/// With `F` footnotes and `C` completed chapter idrefs, cleanup costs exactly
/// `F + C + CT + 4` units, where `CT` is the nested chapter-text source cost.
/// Consequently a `FullDocument` source costs `F + C + 5`; a materialized
/// source costs `F + C + 6 + sum(S_i + 6)`, where each index has `S_i` spans.
/// Standard-library B-tree iteration retains logarithmic internal work.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeRevisionInteractionsCleanup {
    owner: Option<RuntimeRevisionInteractions>,
    footnotes: Option<FootnoteSource>,
    chapter_text_indices: Option<PendingRuntimeChapterTextIndexSourceCleanup>,
    completed_chapter_idrefs: Option<CompletedChapterSource>,
    stage: RuntimeRevisionInteractionsCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeRevisionInteractionsCleanupStage {
    Source,
    Footnotes,
    ChapterTextIndices,
    CompletedChapterIdrefs,
    Complete,
}

impl PendingRuntimeRevisionInteractionsCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeRevisionInteractions) -> Self {
        Self {
            owner: Some(owner),
            footnotes: None,
            chapter_text_indices: None,
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
            RuntimeRevisionInteractionsCleanupStage::ChapterTextIndices => {
                self.advance_chapter_text_indices()
            }
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
            chapter_text_indices,
            completed_chapter_idrefs,
        } = owner;
        self.footnotes = Some(footnotes.into_iter());
        self.chapter_text_indices = Some(PendingRuntimeChapterTextIndexSourceCleanup::new(
            chapter_text_indices,
        ));
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
        self.stage = RuntimeRevisionInteractionsCleanupStage::ChapterTextIndices;
        true
    }

    fn advance_chapter_text_indices(&mut self) -> bool {
        let chapter_text_indices = self
            .chapter_text_indices
            .as_mut()
            .expect("chapter-text cleanup exists");
        if chapter_text_indices.is_complete() {
            self.chapter_text_indices = None;
            self.stage = RuntimeRevisionInteractionsCleanupStage::CompletedChapterIdrefs;
            return true;
        }
        let advanced = chapter_text_indices.advance_one();
        debug_assert!(advanced, "incomplete chapter-text cleanup has work");
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
