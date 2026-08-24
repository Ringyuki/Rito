use std::{collections::btree_set, vec};

use crate::{
    layout::PendingRuntimePageVectorCleanup,
    runtime::cleanup::PendingRuntimeRevisionInteractionsVectorCleanup,
};

use super::super::state::{RuntimeChapterPageBatch, RuntimeContinuationWork};

type RuntimeChapterPageBatchSource = vec::IntoIter<RuntimeChapterPageBatch>;
type CompletedChapterIdrefSource = btree_set::IntoIter<String>;

/// Copy-only remainder of a decomposed orphan continuation work owner.
#[derive(Debug)]
struct ContinuationWorkShell {
    processed_top_level_nodes: usize,
    complete: bool,
}

/// Copy-only remainder of the active page batch.
#[derive(Debug)]
struct ChapterPageBatchShell {
    block_count: usize,
}

/// Incrementally releases a complete orphan continuation-work result.
///
/// If page-vector `b` costs `P_b`, the completed-idref set contains `C`
/// entries and a non-empty interactions vector costs `I`, this cursor costs
/// exactly `4 + sum(P_b + 3) + C + (I + 1)`. The interactions term is omitted
/// when that vector is empty. Page owners are released before interaction
/// indices because their block trees carry the recursive-drop risk.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeContinuationWorkCleanup {
    owner: Option<RuntimeContinuationWork>,
    batches: Option<RuntimeChapterPageBatchSource>,
    active_pages: Option<PendingRuntimePageVectorCleanup>,
    batch_idref: Option<String>,
    batch_shell: Option<ChapterPageBatchShell>,
    interactions: Option<PendingRuntimeRevisionInteractionsVectorCleanup>,
    completed_chapter_idrefs: Option<CompletedChapterIdrefSource>,
    shell: Option<ContinuationWorkShell>,
    stage: ContinuationWorkCleanupStage,
    batch_stage: ChapterPageBatchCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContinuationWorkCleanupStage {
    Source,
    Batches,
    Interactions,
    CompletedChapterIdrefs,
    Owner,
    Complete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChapterPageBatchCleanupStage {
    Source,
    Pages,
    Idref,
    Owner,
}

impl PendingRuntimeContinuationWorkCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeContinuationWork) -> Self {
        Self {
            owner: Some(owner),
            batches: None,
            active_pages: None,
            batch_idref: None,
            batch_shell: None,
            interactions: None,
            completed_chapter_idrefs: None,
            shell: None,
            stage: ContinuationWorkCleanupStage::Source,
            batch_stage: ChapterPageBatchCleanupStage::Source,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == ContinuationWorkCleanupStage::Complete
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        match self.stage {
            ContinuationWorkCleanupStage::Source => self.start_source(),
            ContinuationWorkCleanupStage::Batches => self.advance_batches(),
            ContinuationWorkCleanupStage::Interactions => self.advance_interactions(),
            ContinuationWorkCleanupStage::CompletedChapterIdrefs => {
                self.release_next_completed_chapter_idref()
            }
            ContinuationWorkCleanupStage::Owner => self.release_owner(),
            ContinuationWorkCleanupStage::Complete => false,
        }
    }

    fn start_source(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns continuation work");
        let RuntimeContinuationWork {
            batches,
            // Style tables are small interned records; drop them in place
            // instead of scheduling incremental cleanup.
            chapter_style_tables: _,
            available_interactions,
            completed_chapter_idrefs,
            processed_top_level_nodes,
            complete,
        } = owner;
        self.batches = Some(batches.into_iter());
        if !available_interactions.is_empty() {
            self.interactions = Some(PendingRuntimeRevisionInteractionsVectorCleanup::new(
                available_interactions,
            ));
        }
        self.completed_chapter_idrefs = Some(completed_chapter_idrefs.into_iter());
        self.shell = Some(ContinuationWorkShell {
            processed_top_level_nodes,
            complete,
        });
        self.stage = ContinuationWorkCleanupStage::Batches;
        true
    }

    fn advance_batches(&mut self) -> bool {
        match self.batch_stage {
            ChapterPageBatchCleanupStage::Source => self.start_next_batch(),
            ChapterPageBatchCleanupStage::Pages => self.advance_batch_pages(),
            ChapterPageBatchCleanupStage::Idref => self.release_batch_idref(),
            ChapterPageBatchCleanupStage::Owner => self.release_batch_owner(),
        }
    }

    fn start_next_batch(&mut self) -> bool {
        let batches = self.batches.as_mut().expect("page-batch source exists");
        let Some(batch) = batches.next() else {
            self.batches = None;
            self.stage = if self.interactions.is_some() {
                ContinuationWorkCleanupStage::Interactions
            } else {
                ContinuationWorkCleanupStage::CompletedChapterIdrefs
            };
            return true;
        };
        let RuntimeChapterPageBatch {
            idref,
            block_count,
            pages,
        } = batch;
        let mut pages = PendingRuntimePageVectorCleanup::new(pages);
        let advanced = pages.advance_one();
        debug_assert!(advanced, "new page-vector cleanup has source work");
        self.active_pages = Some(pages);
        self.batch_idref = Some(idref);
        self.batch_shell = Some(ChapterPageBatchShell { block_count });
        self.batch_stage = ChapterPageBatchCleanupStage::Pages;
        true
    }

    fn advance_batch_pages(&mut self) -> bool {
        let pages = self
            .active_pages
            .as_mut()
            .expect("active page-vector cleanup exists");
        if pages.is_complete() {
            self.active_pages = None;
            self.batch_stage = ChapterPageBatchCleanupStage::Idref;
            return true;
        }
        let advanced = pages.advance_one();
        debug_assert!(advanced, "incomplete page-vector cleanup has work");
        true
    }

    fn release_batch_idref(&mut self) -> bool {
        drop(self.batch_idref.take().expect("page-batch idref exists"));
        self.batch_stage = ChapterPageBatchCleanupStage::Owner;
        true
    }

    fn release_batch_owner(&mut self) -> bool {
        let shell = self.batch_shell.take().expect("page-batch shell exists");
        let ChapterPageBatchShell { block_count } = shell;
        let _ = block_count;
        self.batch_stage = ChapterPageBatchCleanupStage::Source;
        true
    }

    fn advance_interactions(&mut self) -> bool {
        let interactions = self
            .interactions
            .as_mut()
            .expect("interactions-vector cleanup exists");
        if interactions.is_complete() {
            self.interactions = None;
            self.stage = ContinuationWorkCleanupStage::CompletedChapterIdrefs;
            return true;
        }
        let advanced = interactions.advance_one();
        debug_assert!(advanced, "incomplete interactions-vector cleanup has work");
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
        self.stage = ContinuationWorkCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("continuation-work shell exists");
        let ContinuationWorkShell {
            processed_top_level_nodes,
            complete,
        } = shell;
        let _ = (processed_top_level_nodes, complete);
        self.stage = ContinuationWorkCleanupStage::Complete;
        true
    }

    fn drain(&mut self) {
        while self.advance_one() {}
    }
}

impl Drop for PendingRuntimeContinuationWorkCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "work/tests.rs"]
mod tests;
