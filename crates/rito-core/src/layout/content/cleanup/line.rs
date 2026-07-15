use std::{mem, vec::IntoIter};

use crate::layout::line::{LineBox, LineRun};

#[derive(Debug)]
pub(super) struct PendingLineBoxCleanup {
    owner: Option<LineBox>,
    runs: Option<IntoIter<LineRun>>,
    stage: LineCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineCleanupStage {
    RunsSource,
    Runs,
    Owner,
    Complete,
}

impl PendingLineBoxCleanup {
    pub(super) fn new(owner: LineBox) -> Self {
        Self {
            owner: Some(owner),
            runs: None,
            stage: LineCleanupStage::RunsSource,
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        self.stage == LineCleanupStage::Complete
    }

    pub(super) fn advance_one(&mut self) -> bool {
        match self.stage {
            LineCleanupStage::RunsSource => self.start_runs(),
            LineCleanupStage::Runs => self.advance_runs(),
            LineCleanupStage::Owner => self.release_owner(),
            LineCleanupStage::Complete => false,
        }
    }

    fn start_runs(&mut self) -> bool {
        let owner = self.owner.as_mut().expect("cleanup owns its line");
        self.runs = Some(mem::take(&mut owner.runs).into_iter());
        self.stage = LineCleanupStage::Runs;
        true
    }

    fn advance_runs(&mut self) -> bool {
        let runs = self.runs.as_mut().expect("run source exists");
        if let Some(run) = runs.next() {
            drop(run);
            return true;
        }
        self.runs = None;
        self.stage = LineCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its line");
        debug_assert!(owner.runs.is_empty());
        drop(owner);
        self.stage = LineCleanupStage::Complete;
        true
    }

    fn drain(&mut self) {
        while self.advance_one() {}
    }
}

impl Drop for PendingLineBoxCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}
