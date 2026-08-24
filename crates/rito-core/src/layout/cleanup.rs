mod built;
mod config;
mod styled_node;
mod summary;

pub(crate) use built::PendingBuiltLayoutCleanup;
pub(crate) use config::PendingLayoutConfigCleanup;
pub(crate) use styled_node::{
    PendingStyledNodeDrop, PendingStyledNodeIterDrop, StyledNodeIterSource,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CleanupProgress {
    pub(crate) consumed_units: usize,
    pub(crate) complete: bool,
}
