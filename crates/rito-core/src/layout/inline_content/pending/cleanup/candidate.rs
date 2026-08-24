use std::num::NonZeroUsize;

use super::CleanupProgress;
use crate::layout::inline_content::pending::PendingInlineCandidateCollector;

mod active;
mod frame;
mod state;

use state::CandidateCleanupState;

/// Owns a suspended inline candidate collector and releases every retained
/// payload under an explicit ownership/structural budget.
#[derive(Debug)]
#[allow(dead_code)] // The runtime cancellation layer consumes this cursor next.
pub(crate) struct PendingInlineCandidateCleanup {
    owner: Option<PendingInlineCandidateCollector>,
    state: CandidateCleanupState,
}

#[allow(dead_code)] // Direct Drop shares the state engine before runtime scheduling lands.
impl PendingInlineCandidateCleanup {
    pub(crate) fn new(owner: PendingInlineCandidateCollector) -> Self {
        Self {
            owner: Some(owner),
            state: CandidateCleanupState::default(),
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.owner.is_none()
    }

    /// Performs at most one explicit ownership or nested structural unit.
    pub(crate) fn advance_one(&mut self) -> bool {
        let Some(owner) = self.owner.as_mut() else {
            return false;
        };
        let advanced = self.state.advance_one(owner);
        debug_assert!(advanced || self.state.is_complete());
        if advanced && self.state.is_complete() {
            let owner = self
                .owner
                .take()
                .expect("a completed cleanup owns its collector");
            debug_assert!(owner.cleanup_fields_are_empty());
            drop(owner);
        }
        advanced
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

    #[cfg(test)]
    fn owner(&self) -> &PendingInlineCandidateCollector {
        self.owner.as_ref().expect("cleanup owns its collector")
    }
}

impl Drop for PendingInlineCandidateCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

pub(super) fn drain_candidate_collector(owner: &mut PendingInlineCandidateCollector) {
    CandidateCleanupState::default().drain(owner);
}

#[cfg(test)]
#[path = "candidate/tests.rs"]
mod tests;
