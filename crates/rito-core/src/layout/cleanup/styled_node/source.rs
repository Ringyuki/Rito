use std::{collections::vec_deque, num::NonZeroUsize, vec};

use crate::{layout::CleanupProgress, style::StyledNode};

use super::PendingStyledNodeDrop;

mod sealed {
    use std::{collections::vec_deque, vec};

    use crate::style::StyledNode;

    pub trait Sealed {}

    impl Sealed for vec::IntoIter<StyledNode> {}
    impl Sealed for &mut vec::IntoIter<StyledNode> {}
    impl Sealed for vec_deque::IntoIter<StyledNode> {}
}

/// A node source whose `next` and terminal drop cannot hide another tree walk.
///
/// Keep this sealed to owned `Vec` / `VecDeque` iterators and the existing
/// borrowed `Vec` source. Generic adapters may discard or retain hidden nodes
/// inside one apparent step, violating both the structural budget and
/// stack-safety.
pub(crate) trait StyledNodeIterSource: sealed::Sealed {
    fn next_node(&mut self) -> Option<StyledNode>;
    fn is_empty(&self) -> bool;
}

impl StyledNodeIterSource for vec::IntoIter<StyledNode> {
    fn next_node(&mut self) -> Option<StyledNode> {
        self.next()
    }

    fn is_empty(&self) -> bool {
        self.as_slice().is_empty()
    }
}

impl StyledNodeIterSource for &mut vec::IntoIter<StyledNode> {
    fn next_node(&mut self) -> Option<StyledNode> {
        self.next()
    }

    fn is_empty(&self) -> bool {
        self.as_slice().is_empty()
    }
}

impl StyledNodeIterSource for vec_deque::IntoIter<StyledNode> {
    fn next_node(&mut self) -> Option<StyledNode> {
        self.next()
    }

    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Owns a sealed node iterator while releasing each tree under a structural
/// budget. Candidate cleanup uses `Vec`; layout-session cleanup uses
/// `VecDeque` without collecting it into another allocation.
#[derive(Debug)]
pub(crate) struct PendingStyledNodeIterDrop<I = vec::IntoIter<StyledNode>>
where
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
    pub(crate) fn new(nodes: I) -> Self {
        Self {
            nodes,
            active: None,
            #[cfg(test)]
            completed_carrier_pushes: 0,
            #[cfg(test)]
            completed_carrier_capacity_growth: 0,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.active.is_none() && self.nodes.is_empty()
    }

    /// Performs exactly one node traversal or release transition.
    pub(crate) fn advance_one(&mut self) -> bool {
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
    fn carrier_push_stats(&self) -> (usize, usize) {
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
#[path = "source/tests.rs"]
mod tests;
