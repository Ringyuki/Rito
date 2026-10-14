mod interactions;
mod queue;
mod revision;

pub(in crate::runtime) use interactions::PendingRuntimeRevisionInteractionsCleanup;
pub(in crate::runtime) use queue::{RuntimeCleanupQueue, RUNTIME_CLEANUP_QUANTUM};
pub(in crate::runtime) use revision::PendingRuntimeRevisionCleanup;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::runtime) struct CleanupProgress {
    pub(in crate::runtime) consumed_units: usize,
    pub(in crate::runtime) complete: bool,
}
