use crate::formatting_tree::FormattingNodeId;

/// Resumption stage inside one node when a fragmentainer boundary split it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BreakTokenStage {
    /// Resume before laying out this node at all (the break landed exactly at
    /// its leading edge).
    Before,
    /// Resume inside the node with the given amount of its block size already
    /// consumed by earlier fragments. CSS px.
    Inside {
        /// Block-axis extent already produced for this node.
        consumed_block_size: f64,
    },
}

/// Opaque resumption point between fragmentainers.
///
/// A break token names the node where layout stopped and how much of it was
/// consumed, plus the child chain leading there. It is a pure value: resuming
/// the same tree with the same token and space is deterministic, and tokens
/// never borrow engine internals, so they can be retained, cached, or shipped
/// across the runtime protocol as data.
#[derive(Clone, Debug, PartialEq)]
pub struct BreakToken {
    /// Path from the context root to the node where layout resumes; each
    /// entry is the node to resume at within its parent's child list.
    pub resume_path: Vec<FormattingNodeId>,
    /// Stage within the final node of `resume_path`.
    pub stage: BreakTokenStage,
}
