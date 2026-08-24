use std::mem;

use crate::style::StyledNode;

mod source;

pub(crate) use source::{PendingStyledNodeIterDrop, StyledNodeIterSource};

/// Owns a forest while releasing it without recursive `StyledNode` drops.
///
/// Each successful [`Self::advance_one`] call performs one structural
/// transition: it either descends through one internal node or releases one
/// node. Node-owned field destructors still do their own work. A forest with
/// `n` nodes and `i` internal nodes takes exactly `n + i` structural steps,
/// bounded by `2 * n - 1` for a non-empty forest.
#[derive(Debug)]
pub(crate) struct PendingStyledNodeDrop {
    current: Option<StyledNode>,
    frame: Vec<StyledNode>,
    depth: usize,
    #[cfg(test)]
    carrier_pushes: usize,
    #[cfg(test)]
    carrier_capacity_growth: usize,
}

impl PendingStyledNodeDrop {
    pub(crate) fn from_node(node: StyledNode) -> Self {
        Self::from_parts(Some(node), Vec::new())
    }

    #[cfg(test)]
    pub(crate) fn from_forest(mut nodes: Vec<StyledNode>) -> Self {
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

    pub(crate) fn is_complete(&self) -> bool {
        self.current.is_none()
    }

    /// Performs one structural traversal or release transition.
    ///
    /// Returns `false` only when the forest was already complete.
    pub(crate) fn advance_one(&mut self) -> bool {
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

    pub(crate) fn drain(&mut self) {
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
    pub(crate) fn carrier_push_stats(&self) -> (usize, usize) {
        (self.carrier_pushes, self.carrier_capacity_growth)
    }
}

impl Drop for PendingStyledNodeDrop {
    fn drop(&mut self) {
        self.drain();
    }
}
