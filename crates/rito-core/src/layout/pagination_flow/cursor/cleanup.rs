use std::num::NonZeroUsize;

use super::{ContinuousPaginationSession, PreviousBlockGeometry};
use crate::layout::{CleanupProgress, PaginationPolicy, PendingRuntimePageAccumulatorCleanup};

/// Scalar-only remainder of a decomposed pagination session.
#[derive(Debug)]
struct PaginationSessionShell {
    previous_block: Option<PreviousBlockGeometry>,
    pagination_policy: Option<PaginationPolicy>,
    content_height: f64,
    pagination_disabled: bool,
    finished: bool,
}

/// Releases pagination state before its bounded policy and scalar owner shell.
///
/// If accumulator cleanup costs `S`, this cursor costs exactly `S + 3` units:
/// one source boundary, one nested retirement, and one owner-shell boundary.
#[derive(Debug)]
#[allow(dead_code)] // Chapter-session retirement consumes this cursor next.
pub(crate) struct PendingContinuousPaginationSessionCleanup {
    owner: Option<ContinuousPaginationSession>,
    state: Option<PendingRuntimePageAccumulatorCleanup>,
    shell: Option<PaginationSessionShell>,
    stage: PaginationSessionCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PaginationSessionCleanupStage {
    StateSource,
    State,
    Owner,
    Complete,
}

#[allow(dead_code)] // Direct tests precede chapter-session retirement wiring.
impl PendingContinuousPaginationSessionCleanup {
    pub(crate) fn new(owner: ContinuousPaginationSession) -> Self {
        Self {
            owner: Some(owner),
            state: None,
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
            pagination_policy,
            content_height,
            pagination_disabled,
            finished,
        } = owner;
        self.state = Some(PendingRuntimePageAccumulatorCleanup::new(state));
        self.shell = Some(PaginationSessionShell {
            previous_block,
            pagination_policy,
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
            self.stage = PaginationSessionCleanupStage::Owner;
            return true;
        }
        let advanced = state.advance_one();
        debug_assert!(advanced, "incomplete accumulator cleanup has work");
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("cleanup owns its session shell");
        let PaginationSessionShell {
            previous_block,
            pagination_policy,
            content_height,
            pagination_disabled,
            finished,
        } = shell;
        let _ = (
            previous_block,
            pagination_policy,
            content_height,
            pagination_disabled,
            finished,
        );
        self.stage = PaginationSessionCleanupStage::Complete;
        true
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
