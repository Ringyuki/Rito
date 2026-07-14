use std::mem;

use crate::style::StyledNode;

use super::{frame::CollectionFrame, ActiveCollection, PendingInlineCandidateCollector};

/// Owns a forest while releasing it without recursive `StyledNode` drops.
///
/// Each successful [`Self::advance_one`] call performs one structural
/// transition: it either descends through one internal node or releases one
/// node. Node-owned field destructors still do their own work. A forest with
/// `n` nodes and `i` internal nodes takes exactly `n + i` structural steps,
/// bounded by `2 * n - 1` for a non-empty forest.
#[derive(Debug)]
pub(super) struct PendingStyledNodeDrop {
    current: Option<StyledNode>,
    frame: Vec<StyledNode>,
    depth: usize,
    #[cfg(test)]
    carrier_pushes: usize,
    #[cfg(test)]
    carrier_capacity_growth: usize,
}

impl PendingStyledNodeDrop {
    pub(super) fn from_node(node: StyledNode) -> Self {
        Self::from_parts(Some(node), Vec::new())
    }

    pub(super) fn from_forest(mut nodes: Vec<StyledNode>) -> Self {
        let current = nodes.pop();
        Self::from_parts(current, nodes)
    }

    fn from_parts(current: Option<StyledNode>, frame: Vec<StyledNode>) -> Self {
        Self {
            current,
            frame,
            depth: 0,
            #[cfg(test)]
            carrier_pushes: 0,
            #[cfg(test)]
            carrier_capacity_growth: 0,
        }
    }

    #[cfg(test)]
    fn is_complete(&self) -> bool {
        self.current.is_none()
    }

    /// Performs one structural traversal or release transition.
    ///
    /// Returns `false` only when the forest was already complete.
    pub(super) fn advance_one(&mut self) -> bool {
        let Some(mut node) = self.current.take() else {
            return false;
        };

        let Some(child) = node.children.pop() else {
            drop(node);
            self.resume_after_release();
            return true;
        };

        let outer_frame = mem::take(&mut self.frame);
        let child_frame = mem::replace(&mut node.children, outer_frame);
        self.frame = child_frame;
        self.push_carrier(node);
        self.current = Some(child);
        self.depth = self.depth.saturating_add(1);
        true
    }

    pub(super) fn drain(&mut self) {
        while self.advance_one() {}
    }

    fn resume_after_release(&mut self) {
        if self.depth == 0 {
            self.current = self.frame.pop();
            return;
        }

        let Some(mut carrier) = self.frame.pop() else {
            self.depth = 0;
            return;
        };
        if let Some(sibling) = self.frame.pop() {
            self.push_carrier(carrier);
            self.current = Some(sibling);
            return;
        }

        self.frame = mem::take(&mut carrier.children);
        self.current = Some(carrier);
        self.depth = self.depth.saturating_sub(1);
    }

    fn push_carrier(&mut self, carrier: StyledNode) {
        #[cfg(test)]
        let capacity = self.frame.capacity();
        self.frame.push(carrier);
        #[cfg(test)]
        let capacity_after = self.frame.capacity();
        #[cfg(test)]
        {
            self.carrier_pushes = self.carrier_pushes.saturating_add(1);
            self.carrier_capacity_growth = self
                .carrier_capacity_growth
                .saturating_add(capacity_after.saturating_sub(capacity));
        }
    }

    #[cfg(test)]
    fn carrier_push_stats(&self) -> (usize, usize) {
        (self.carrier_pushes, self.carrier_capacity_growth)
    }
}

impl Drop for PendingStyledNodeDrop {
    fn drop(&mut self) {
        self.drain();
    }
}

pub(super) fn drop_styled_node_iteratively(node: StyledNode) {
    PendingStyledNodeDrop::from_node(node).drain();
}

pub(super) fn drop_styled_nodes_iteratively(nodes: impl IntoIterator<Item = StyledNode>) {
    for node in nodes {
        drop_styled_node_iteratively(node);
    }
}

pub(super) fn drop_styled_node_forest_iteratively(nodes: Vec<StyledNode>) {
    PendingStyledNodeDrop::from_forest(nodes).drain();
}

impl Drop for PendingInlineCandidateCollector {
    fn drop(&mut self) {
        if let Some(root) = self.initial_root.take() {
            drop_styled_nodes_iteratively(root.nodes);
        }
        for frame in self.frames.drain(..) {
            match frame {
                CollectionFrame::Nodes(frame) => drop_styled_nodes_iteratively(frame.nodes),
                CollectionFrame::Ruby(frame) => drop(frame),
            }
        }
        drop(self.discard.take());
        if let Some(ActiveCollection::Atomic(atomic)) = self.active.take() {
            drop_styled_node_iteratively(atomic.node);
        }
    }
}

#[cfg(test)]
mod dropper_tests;
