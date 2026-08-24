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
    /// entry is the node to resume at within its parent's child list. May
    /// be empty when only `pending_floats` remain to lay out.
    pub resume_path: Vec<FormattingNodeId>,
    /// Stage within the final node of `resume_path`.
    pub stage: BreakTokenStage,
    /// Floats the same fragmentainer edge split. Each resumes in its own
    /// float band at the top of the next fragmentainer, side by side,
    /// while in-flow layout resumes at `resume_path` — the way columns
    /// built from floats continue across pages in a browser.
    pub pending_floats: Vec<FloatBreak>,
}

/// One float's resumption across a fragmentainer edge.
#[derive(Clone, Debug, PartialEq)]
pub struct FloatBreak {
    /// The floated child; its side and box derive from its own style.
    pub child: FormattingNodeId,
    /// Resumption inside the float's subtree.
    pub token: BreakToken,
    /// Which container on the resume path owns this float: `0` is the
    /// container receiving the token, `1` the container `resume_path[0]`
    /// names, and so on. Each descent strips a level, so every container
    /// consumes exactly the floats it split.
    pub depth: u32,
}
