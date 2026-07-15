use crate::style::StyledNode;

use super::PendingInlineCandidateCollector;

mod candidate;

pub(super) use crate::layout::cleanup::{
    PendingStyledNodeDrop, PendingStyledNodeIterDrop, StyledNodeIterSource,
};
pub(crate) use crate::layout::CleanupProgress;
pub(crate) use candidate::PendingInlineCandidateCleanup;

#[cfg(test)]
pub(super) fn drop_styled_node_iteratively(node: StyledNode) {
    PendingStyledNodeDrop::from_node(node).drain();
}

pub(super) fn drop_styled_nodes_iteratively<T>(nodes: T)
where
    T: IntoIterator<Item = StyledNode>,
    T::IntoIter: StyledNodeIterSource,
{
    PendingStyledNodeIterDrop::new(nodes.into_iter()).drain();
}

pub(super) fn drop_styled_node_forest_iteratively(nodes: Vec<StyledNode>) {
    drop_styled_nodes_iteratively(nodes);
}

impl Drop for PendingInlineCandidateCollector {
    fn drop(&mut self) {
        if !self.cleanup_fields_are_empty() {
            candidate::drain_candidate_collector(self);
        }
    }
}

#[cfg(test)]
mod dropper_tests;
