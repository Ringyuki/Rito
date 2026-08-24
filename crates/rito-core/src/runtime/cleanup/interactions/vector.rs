use std::vec;

use crate::runtime::frame::RuntimeRevisionInteractions;

use super::PendingRuntimeRevisionInteractionsCleanup;

type RuntimeRevisionInteractionsSource = vec::IntoIter<RuntimeRevisionInteractions>;

/// Incrementally releases a batch of orphaned revision-interaction owners.
///
/// If nested owner `i` costs `R_i` units, this cursor costs exactly
/// `2 + sum(R_i + 1)`: one vector-source unit, one retirement unit per nested
/// cursor and one exhausted-source unit. The first nested unit is consumed in
/// the same step that activates that owner, matching the other cleanup-vector
/// cursors.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeRevisionInteractionsVectorCleanup {
    owner: Option<Vec<RuntimeRevisionInteractions>>,
    interactions: Option<RuntimeRevisionInteractionsSource>,
    active: Option<PendingRuntimeRevisionInteractionsCleanup>,
    stage: RuntimeRevisionInteractionsVectorCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeRevisionInteractionsVectorCleanupStage {
    Source,
    Interactions,
    Complete,
}

impl PendingRuntimeRevisionInteractionsVectorCleanup {
    pub(in crate::runtime) fn new(owner: Vec<RuntimeRevisionInteractions>) -> Self {
        Self {
            owner: Some(owner),
            interactions: None,
            active: None,
            stage: RuntimeRevisionInteractionsVectorCleanupStage::Source,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == RuntimeRevisionInteractionsVectorCleanupStage::Complete
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        match self.stage {
            RuntimeRevisionInteractionsVectorCleanupStage::Source => self.start_source(),
            RuntimeRevisionInteractionsVectorCleanupStage::Interactions => {
                self.advance_interactions()
            }
            RuntimeRevisionInteractionsVectorCleanupStage::Complete => false,
        }
    }

    fn start_source(&mut self) -> bool {
        let owner = self
            .owner
            .take()
            .expect("cleanup owns its interactions vector");
        self.interactions = Some(owner.into_iter());
        self.stage = RuntimeRevisionInteractionsVectorCleanupStage::Interactions;
        true
    }

    fn advance_interactions(&mut self) -> bool {
        if self
            .active
            .as_ref()
            .is_some_and(PendingRuntimeRevisionInteractionsCleanup::is_complete)
        {
            self.active = None;
            return true;
        }
        if let Some(active) = self.active.as_mut() {
            return active.advance_one();
        }
        let interactions = self
            .interactions
            .as_mut()
            .expect("interactions source exists");
        if let Some(interactions) = interactions.next() {
            let mut active = PendingRuntimeRevisionInteractionsCleanup::new(interactions);
            let advanced = active.advance_one();
            debug_assert!(advanced, "new interactions cleanup has source work");
            self.active = Some(active);
            return true;
        }
        self.interactions = None;
        self.stage = RuntimeRevisionInteractionsVectorCleanupStage::Complete;
        true
    }

    fn drain(&mut self) {
        while self.advance_one() {}
    }
}

impl Drop for PendingRuntimeRevisionInteractionsVectorCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "vector/tests.rs"]
mod tests;
