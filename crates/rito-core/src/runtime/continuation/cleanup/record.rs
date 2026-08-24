use std::num::NonZeroUsize;

use crate::{
    layout::{CleanupProgress, LineBreaking, PendingLayoutConfigCleanup},
    runtime::RuntimeSourceLocator,
};

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
    local_page_cap: Option<usize>,
}

/// Releases an active chapter before the record's flat ownership fields.
///
/// If layout-configuration cleanup costs `LC`, a record without an active
/// chapter costs exactly `LC + 5` units. An active chapter adds its nested
/// cleanup units plus one retirement boundary, so a populated record costs
/// exactly `CC + LC + 6` units.
/// A chapter-local record adds one unit for its exact canonical target.
///
/// The layout configuration's unbounded font-measurement maps are delegated to
/// their own budgeted cursor.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeContinuationRecordCleanup {
    owner: Option<RuntimeContinuationRecord>,
    current: Option<PendingRuntimeChapterContinuationCleanup>,
    chapter_local_target: Option<RuntimeSourceLocator>,
    layout_config: Option<PendingLayoutConfigCleanup>,
    layout_key: Option<String>,
    revision_id: Option<String>,
    shell: Option<ContinuationRecordShell>,
    stage: ContinuationRecordCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContinuationRecordCleanupStage {
    CurrentSource,
    Current,
    ChapterLocalTarget,
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
            chapter_local_target: None,
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
            ContinuationRecordCleanupStage::ChapterLocalTarget => {
                self.release_chapter_local_target()
            }
            ContinuationRecordCleanupStage::LayoutConfig => self.advance_layout_config(),
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
            local_page_cap,
            chapter_local_target,
        } = owner;
        self.current = current.map(PendingRuntimeChapterContinuationCleanup::new);
        self.chapter_local_target = chapter_local_target;
        self.layout_config = Some(PendingLayoutConfigCleanup::new(layout_config));
        self.layout_key = Some(layout_key);
        self.revision_id = Some(revision_id);
        self.shell = Some(ContinuationRecordShell {
            revision_version,
            line_breaking,
            next_chapter_index,
            chapter_count,
            published_page_count,
            local_page_cap,
        });
        self.stage = if self.current.is_some() {
            ContinuationRecordCleanupStage::Current
        } else {
            self.stage_after_current()
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
            self.stage = self.stage_after_current();
            return true;
        }
        let advanced = current.advance_one();
        debug_assert!(advanced, "incomplete active-chapter cleanup has work");
        true
    }

    fn stage_after_current(&self) -> ContinuationRecordCleanupStage {
        if self.chapter_local_target.is_some() {
            ContinuationRecordCleanupStage::ChapterLocalTarget
        } else {
            ContinuationRecordCleanupStage::LayoutConfig
        }
    }

    fn release_chapter_local_target(&mut self) -> bool {
        drop(
            self.chapter_local_target
                .take()
                .expect("chapter-local continuation target exists"),
        );
        self.stage = ContinuationRecordCleanupStage::LayoutConfig;
        true
    }

    fn advance_layout_config(&mut self) -> bool {
        let layout_config = self
            .layout_config
            .as_mut()
            .expect("layout-config cleanup exists");
        if layout_config.is_complete() {
            self.layout_config = None;
            self.stage = ContinuationRecordCleanupStage::LayoutKey;
            return true;
        }
        let advanced = layout_config.advance_one();
        debug_assert!(advanced, "incomplete layout-config cleanup has work");
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
            local_page_cap,
        } = shell;
        let _ = (
            revision_version,
            line_breaking,
            next_chapter_index,
            chapter_count,
            published_page_count,
            local_page_cap,
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
