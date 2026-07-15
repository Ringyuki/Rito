use std::{collections::BTreeSet, num::NonZeroUsize};

use crate::layout::{CleanupProgress, LayoutConfig, LineBreaking};

use super::{
    super::state::RuntimeContinuationRecord, chapter::PendingRuntimeChapterContinuationCleanup,
};

/// Copy-only remainder of a decomposed continuation record.
#[derive(Debug)]
struct ContinuationRecordShell {
    revision_version: u32,
    line_breaking: LineBreaking,
    next_chapter_index: usize,
    chapter_count: usize,
    published_page_count: usize,
}

/// Releases an active chapter before the record's flat ownership fields.
///
/// A record without an active chapter costs exactly six units. An active
/// chapter adds its nested cleanup units plus one retirement boundary, so a
/// populated record costs exactly `CC + 7` units.
///
/// `chapter_start_pages` and `LayoutConfig` contain unbounded B-tree payloads
/// and remain indivisible destructor residuals. This cursor therefore does not
/// establish a wall-clock cleanup bound.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeContinuationRecordCleanup {
    owner: Option<RuntimeContinuationRecord>,
    current: Option<PendingRuntimeChapterContinuationCleanup>,
    chapter_start_pages: Option<BTreeSet<usize>>,
    layout_config: Option<LayoutConfig>,
    layout_key: Option<String>,
    revision_id: Option<String>,
    shell: Option<ContinuationRecordShell>,
    stage: ContinuationRecordCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContinuationRecordCleanupStage {
    CurrentSource,
    Current,
    ChapterStartPages,
    LayoutConfig,
    LayoutKey,
    RevisionId,
    Owner,
    Complete,
}

impl PendingRuntimeContinuationRecordCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeContinuationRecord) -> Self {
        Self {
            owner: Some(owner),
            current: None,
            chapter_start_pages: None,
            layout_config: None,
            layout_key: None,
            revision_id: None,
            shell: None,
            stage: ContinuationRecordCleanupStage::CurrentSource,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == ContinuationRecordCleanupStage::Complete
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        match self.stage {
            ContinuationRecordCleanupStage::CurrentSource => self.start_current(),
            ContinuationRecordCleanupStage::Current => self.advance_current(),
            ContinuationRecordCleanupStage::ChapterStartPages => self.release_chapter_start_pages(),
            ContinuationRecordCleanupStage::LayoutConfig => self.release_layout_config(),
            ContinuationRecordCleanupStage::LayoutKey => self.release_layout_key(),
            ContinuationRecordCleanupStage::RevisionId => self.release_revision_id(),
            ContinuationRecordCleanupStage::Owner => self.release_owner(),
            ContinuationRecordCleanupStage::Complete => false,
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

    fn start_current(&mut self) -> bool {
        let owner = self
            .owner
            .take()
            .expect("cleanup owns its continuation record");
        let RuntimeContinuationRecord {
            revision_id,
            revision_version,
            layout_key,
            layout_config,
            line_breaking,
            next_chapter_index,
            chapter_count,
            current,
            published_page_count,
            chapter_start_pages,
        } = owner;
        self.current = current.map(PendingRuntimeChapterContinuationCleanup::new);
        self.chapter_start_pages = Some(chapter_start_pages);
        self.layout_config = Some(layout_config);
        self.layout_key = Some(layout_key);
        self.revision_id = Some(revision_id);
        self.shell = Some(ContinuationRecordShell {
            revision_version,
            line_breaking,
            next_chapter_index,
            chapter_count,
            published_page_count,
        });
        self.stage = if self.current.is_some() {
            ContinuationRecordCleanupStage::Current
        } else {
            ContinuationRecordCleanupStage::ChapterStartPages
        };
        true
    }

    fn advance_current(&mut self) -> bool {
        let current = self
            .current
            .as_mut()
            .expect("active-chapter cleanup exists");
        if current.is_complete() {
            self.current = None;
            self.stage = ContinuationRecordCleanupStage::ChapterStartPages;
            return true;
        }
        let advanced = current.advance_one();
        debug_assert!(advanced, "incomplete active-chapter cleanup has work");
        true
    }

    fn release_chapter_start_pages(&mut self) -> bool {
        drop(
            self.chapter_start_pages
                .take()
                .expect("chapter-start pages exist"),
        );
        self.stage = ContinuationRecordCleanupStage::LayoutConfig;
        true
    }

    fn release_layout_config(&mut self) -> bool {
        drop(
            self.layout_config
                .take()
                .expect("record layout config exists"),
        );
        self.stage = ContinuationRecordCleanupStage::LayoutKey;
        true
    }

    fn release_layout_key(&mut self) -> bool {
        drop(self.layout_key.take().expect("record layout key exists"));
        self.stage = ContinuationRecordCleanupStage::RevisionId;
        true
    }

    fn release_revision_id(&mut self) -> bool {
        drop(self.revision_id.take().expect("record revision id exists"));
        self.stage = ContinuationRecordCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("continuation-record shell exists");
        let ContinuationRecordShell {
            revision_version,
            line_breaking,
            next_chapter_index,
            chapter_count,
            published_page_count,
        } = shell;
        let _ = (
            revision_version,
            line_breaking,
            next_chapter_index,
            chapter_count,
            published_page_count,
        );
        self.stage = ContinuationRecordCleanupStage::Complete;
        true
    }
}

impl Drop for PendingRuntimeContinuationRecordCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "record/tests.rs"]
mod tests;
