use std::{mem, num::NonZeroUsize};

use super::{RuntimeBlock, RuntimeChild};
use crate::layout::{line::LineBox, CleanupProgress};

type LayoutBlock = RuntimeBlock<LineBox>;
type LayoutChild = RuntimeChild<LineBox>;

mod forest;
mod line;
mod vector;

use forest::PendingRuntimeChildForestCleanup;
pub(crate) use vector::PendingRuntimeBlockVectorCleanup;

/// Owns one paint-ready block while releasing its recursive child tree under
/// an explicit structural and payload budget.
///
/// Each line run is released separately. A block's JSON paint and an individual
/// run payload remain indivisible destructor residuals, so this cursor does not
/// by itself establish a wall-clock hard bound.
#[derive(Debug)]
#[allow(dead_code)] // Runtime revision retirement consumes this cursor next.
pub(crate) struct PendingRuntimeBlockCleanup {
    owner: Option<LayoutBlock>,
    children: Option<PendingRuntimeChildForestCleanup>,
    stage: RootCleanupStage,
    #[cfg(test)]
    completed_carrier_pushes: usize,
    #[cfg(test)]
    completed_carrier_capacity_growth: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RootCleanupStage {
    ChildrenSource,
    Children,
    Owner,
    Complete,
}

#[allow(dead_code)] // Direct tests precede runtime revision retirement wiring.
impl PendingRuntimeBlockCleanup {
    pub(crate) fn new(owner: LayoutBlock) -> Self {
        Self {
            owner: Some(owner),
            children: None,
            stage: RootCleanupStage::ChildrenSource,
            #[cfg(test)]
            completed_carrier_pushes: 0,
            #[cfg(test)]
            completed_carrier_capacity_growth: 0,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == RootCleanupStage::Complete
    }

    /// Performs at most one explicit ownership or structural transition.
    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            RootCleanupStage::ChildrenSource => self.start_children(),
            RootCleanupStage::Children => self.advance_children(),
            RootCleanupStage::Owner => self.release_owner(),
            RootCleanupStage::Complete => false,
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
        let owner = self.owner.as_mut().expect("cleanup owns its root block");
        self.children = Some(PendingRuntimeChildForestCleanup::new(mem::take(
            &mut owner.children,
        )));
        self.stage = RootCleanupStage::Children;
        true
    }

    fn advance_children(&mut self) -> bool {
        let children = self.children.as_mut().expect("child cleanup exists");
        if children.is_complete() {
            #[cfg(test)]
            {
                let (pushes, growth) = children.carrier_push_stats();
                self.completed_carrier_pushes = pushes;
                self.completed_carrier_capacity_growth = growth;
            }
            self.children = None;
            self.stage = RootCleanupStage::Owner;
            return true;
        }
        let advanced = children.advance_one();
        debug_assert!(advanced, "incomplete child cleanup has work");
        true
    }

    fn release_owner(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its root block");
        debug_assert!(owner.children.is_empty());
        drop(owner);
        self.stage = RootCleanupStage::Complete;
        true
    }

    #[cfg(test)]
    fn carrier_push_stats(&self) -> (usize, usize) {
        let (active_pushes, active_growth) = self
            .children
            .as_ref()
            .map_or((0, 0), PendingRuntimeChildForestCleanup::carrier_push_stats);
        (
            self.completed_carrier_pushes + active_pushes,
            self.completed_carrier_capacity_growth + active_growth,
        )
    }
}

impl Drop for PendingRuntimeBlockCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "cleanup/tests.rs"]
mod tests;
