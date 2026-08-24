use std::num::NonZeroUsize;

use super::{CleanupProgress, LayoutChild, PendingRuntimeChildForestCleanup};

/// Releases a paint-ready child vector under an explicit structural and
/// payload budget.
///
/// The source handoff and completed-cursor retirement each consume one unit;
/// the nested forest accounts for blocks, lines, runs, images, and rules.
#[derive(Debug)]
#[allow(dead_code)] // Continuous leaf-session retirement consumes this next.
pub(crate) struct PendingRuntimeChildVectorCleanup {
    owner: Option<Vec<LayoutChild>>,
    children: Option<PendingRuntimeChildForestCleanup>,
    stage: ChildVectorCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChildVectorCleanupStage {
    ChildrenSource,
    Children,
    Complete,
}

#[allow(dead_code)] // Direct tests precede continuous-session retirement wiring.
impl PendingRuntimeChildVectorCleanup {
    pub(crate) fn new(owner: Vec<LayoutChild>) -> Self {
        Self {
            owner: Some(owner),
            children: None,
            stage: ChildVectorCleanupStage::ChildrenSource,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == ChildVectorCleanupStage::Complete
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            ChildVectorCleanupStage::ChildrenSource => self.start_children(),
            ChildVectorCleanupStage::Children => self.advance_children(),
            ChildVectorCleanupStage::Complete => false,
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

    fn start_children(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its child vector");
        self.children = Some(PendingRuntimeChildForestCleanup::new(owner));
        self.stage = ChildVectorCleanupStage::Children;
        true
    }

    fn advance_children(&mut self) -> bool {
        let children = self.children.as_mut().expect("child cleanup exists");
        if children.is_complete() {
            self.children = None;
            self.stage = ChildVectorCleanupStage::Complete;
            return true;
        }
        let advanced = children.advance_one();
        debug_assert!(advanced, "incomplete child cleanup has work");
        true
    }
}

impl Drop for PendingRuntimeChildVectorCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "child_vector/tests.rs"]
mod tests;
