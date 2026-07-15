mod styled_node;

pub(crate) use styled_node::{
    PendingStyledNodeDrop, PendingStyledNodeIterDrop, StyledNodeIterSource,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CleanupProgress {
    pub(crate) consumed_units: usize,
    pub(crate) complete: bool,
}
