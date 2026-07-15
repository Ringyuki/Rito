use std::num::NonZeroUsize;

use super::{ContinuousPaginationSession, PreviousBlockGeometry};
use crate::layout::{
    CleanupProgress, PendingLayoutConfigCleanup, PendingRuntimePageAccumulatorCleanup,
};

/// Copy-only remainder of a decomposed pagination session.
#[derive(Debug)]
struct PaginationSessionShell {
    previous_block: Option<PreviousBlockGeometry>,
    content_height: f64,
    pagination_disabled: bool,
    finished: bool,
}

/// Releases pagination state before its budgeted layout policy and scalar owner
/// shell.
#[derive(Debug)]
#[allow(dead_code)] // Chapter-session retirement consumes this cursor next.
pub(crate) struct PendingContinuousPaginationSessionCleanup {
    owner: Option<ContinuousPaginationSession>,
    state: Option<PendingRuntimePageAccumulatorCleanup>,
    layout_config: Option<PendingLayoutConfigCleanup>,
    shell: Option<PaginationSessionShell>,
    stage: PaginationSessionCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PaginationSessionCleanupStage {
    StateSource,
    State,
    LayoutConfig,
    Owner,
    Complete,
}

#[allow(dead_code)] // Direct tests precede chapter-session retirement wiring.
impl PendingContinuousPaginationSessionCleanup {
    pub(crate) fn new(owner: ContinuousPaginationSession) -> Self {
        Self {
            owner: Some(owner),
            state: None,
            layout_config: None,
            shell: None,
            stage: PaginationSessionCleanupStage::StateSource,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == PaginationSessionCleanupStage::Complete
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            PaginationSessionCleanupStage::StateSource => self.start_state(),
            PaginationSessionCleanupStage::State => self.advance_state(),
            PaginationSessionCleanupStage::LayoutConfig => self.advance_layout_config(),
            PaginationSessionCleanupStage::Owner => self.release_owner(),
            PaginationSessionCleanupStage::Complete => false,
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

    fn start_state(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its session");
        let ContinuousPaginationSession {
            state,
            previous_block,
            layout_config,
            content_height,
            pagination_disabled,
            finished,
        } = owner;
        self.state = Some(PendingRuntimePageAccumulatorCleanup::new(state));
        self.layout_config = Some(PendingLayoutConfigCleanup::new(layout_config));
        self.shell = Some(PaginationSessionShell {
            previous_block,
            content_height,
            pagination_disabled,
            finished,
        });
        self.stage = PaginationSessionCleanupStage::State;
        true
    }

    fn advance_state(&mut self) -> bool {
        let state = self.state.as_mut().expect("accumulator cleanup exists");
        if state.is_complete() {
            self.state = None;
            self.stage = PaginationSessionCleanupStage::LayoutConfig;
            return true;
        }
        let advanced = state.advance_one();
        debug_assert!(advanced, "incomplete accumulator cleanup has work");
        true
    }

    fn advance_layout_config(&mut self) -> bool {
        let layout_config = self
            .layout_config
            .as_mut()
            .expect("layout-config cleanup exists");
        if layout_config.is_complete() {
            self.layout_config = None;
            self.stage = PaginationSessionCleanupStage::Owner;
            return true;
        }
        let advanced = layout_config.advance_one();
        debug_assert!(advanced, "incomplete layout-config cleanup has work");
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("cleanup owns its session shell");
        let PaginationSessionShell {
            previous_block,
            content_height,
            pagination_disabled,
            finished,
        } = shell;
        let _ = (
            previous_block,
            content_height,
            pagination_disabled,
            finished,
        );
        self.stage = PaginationSessionCleanupStage::Complete;
        true
    }

    #[cfg(test)]
    fn layout_config(&self) -> Option<&crate::layout::LayoutConfig> {
        self.layout_config
            .as_ref()
            .and_then(PendingLayoutConfigCleanup::source)
    }
}

impl Drop for PendingContinuousPaginationSessionCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "cleanup/tests.rs"]
mod tests;
