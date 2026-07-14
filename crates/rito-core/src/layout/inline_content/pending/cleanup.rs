use crate::style::StyledNode;

use super::{ActiveCollection, PendingInlineCandidateCollector};

impl Drop for PendingInlineCandidateCollector {
    fn drop(&mut self) {
        let mut nodes = Vec::new();
        for frame in self.frames.drain(..) {
            nodes.extend(frame.nodes);
        }
        if let Some(discard) = self.discard.as_mut() {
            discard.drain_remaining_into(&mut nodes);
        }
        if let Some(ActiveCollection::Atomic(atomic)) = self.active.take() {
            nodes.push(atomic.node);
        }
        drop_nodes_iteratively(nodes);
    }
}

fn drop_nodes_iteratively(mut nodes: Vec<StyledNode>) {
    while let Some(mut node) = nodes.pop() {
        nodes.append(&mut node.children);
    }
}
