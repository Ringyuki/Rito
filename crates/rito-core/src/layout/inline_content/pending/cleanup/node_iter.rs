use std::{num::NonZeroUsize, vec::IntoIter};

use crate::style::StyledNode;

use super::PendingStyledNodeDrop;

mod sealed {
    use std::vec::IntoIter;

    use crate::style::StyledNode;

    pub trait Sealed {}

    impl Sealed for IntoIter<StyledNode> {}
    impl Sealed for &mut IntoIter<StyledNode> {}
}

/// A node source whose `next` and terminal drop cannot hide another tree walk.
///
/// Keep this sealed to the owned `Vec` iterator and its mutable borrow. Generic
/// iterator adapters may discard or retain hidden nodes inside one apparent
/// step, which would violate both the structural budget and stack-safety.
pub(in crate::layout::inline_content::pending) trait StyledNodeIterSource:
    sealed::Sealed
{
    fn next_node(&mut self) -> Option<StyledNode>;
    fn is_empty(&self) -> bool;
}

impl StyledNodeIterSource for IntoIter<StyledNode> {
    fn next_node(&mut self) -> Option<StyledNode> {
        self.next()
    }

    fn is_empty(&self) -> bool {
        self.as_slice().is_empty()
    }
}

impl StyledNodeIterSource for &mut IntoIter<StyledNode> {
    fn next_node(&mut self) -> Option<StyledNode> {
        self.next()
    }

    fn is_empty(&self) -> bool {
        self.as_slice().is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CleanupProgress {
    pub(crate) consumed_units: usize,
    pub(crate) complete: bool,
}

/// Owns a sealed `Vec` node iterator source while releasing each tree under a
/// structural budget. Candidate cleanup uses the default owned iterator;
/// synchronous helpers may instead hold its mutable borrow without collecting.
#[derive(Debug)]
pub(in crate::layout::inline_content::pending) struct PendingStyledNodeIterDrop<
    I = IntoIter<StyledNode>,
> where
    I: StyledNodeIterSource,
{
    nodes: I,
    active: Option<PendingStyledNodeDrop>,
    #[cfg(test)]
    completed_carrier_pushes: usize,
    #[cfg(test)]
    completed_carrier_capacity_growth: usize,
}

impl<I> PendingStyledNodeIterDrop<I>
where
    I: StyledNodeIterSource,
{
    pub(in crate::layout::inline_content::pending) fn new(nodes: I) -> Self {
        Self {
            nodes,
            active: None,
            #[cfg(test)]
            completed_carrier_pushes: 0,
            #[cfg(test)]
            completed_carrier_capacity_growth: 0,
        }
    }

    pub(in crate::layout::inline_content::pending) fn is_complete(&self) -> bool {
        self.active.is_none() && self.nodes.is_empty()
    }

    /// Performs exactly one node traversal or release transition.
    pub(in crate::layout::inline_content::pending) fn advance_one(&mut self) -> bool {
        if !self.ensure_active() {
            return false;
        }
        let advanced = self
            .active
            .as_mut()
            .expect("an active node drop exists")
            .advance_one();
        debug_assert!(advanced, "an active node drop must have work");
        self.clear_completed_active();
        true
    }

    pub(in crate::layout::inline_content::pending) fn advance(
        &mut self,
        budget: NonZeroUsize,
    ) -> CleanupProgress {
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

    pub(in crate::layout::inline_content::pending) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }

    fn ensure_active(&mut self) -> bool {
        if self.active.is_none() {
            self.active = self.nodes.next_node().map(PendingStyledNodeDrop::from_node);
        }
        self.active.is_some()
    }

    fn clear_completed_active(&mut self) {
        if !self
            .active
            .as_ref()
            .is_some_and(PendingStyledNodeDrop::is_complete)
        {
            return;
        }
        #[cfg(test)]
        self.record_completed_carrier_stats();
        self.active = None;
    }

    #[cfg(test)]
    fn record_completed_carrier_stats(&mut self) {
        let (pushes, growth) = self
            .active
            .as_ref()
            .expect("a completed node drop exists")
            .carrier_push_stats();
        self.completed_carrier_pushes += pushes;
        self.completed_carrier_capacity_growth += growth;
    }

    #[cfg(test)]
    pub(super) fn carrier_push_stats(&self) -> (usize, usize) {
        let (active_pushes, active_growth) = self
            .active
            .as_ref()
            .map_or((0, 0), PendingStyledNodeDrop::carrier_push_stats);
        (
            self.completed_carrier_pushes + active_pushes,
            self.completed_carrier_capacity_growth + active_growth,
        )
    }
}

impl<I> Drop for PendingStyledNodeIterDrop<I>
where
    I: StyledNodeIterSource,
{
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "node_iter_tests.rs"]
mod tests;
