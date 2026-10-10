use std::{collections::VecDeque, num::NonZeroUsize};

mod job;
#[cfg(test)]
mod probe;
#[cfg(test)]
use probe::RuntimeCleanupProbe;

use crate::runtime::cleanup::CleanupProgress;

use super::super::frame::RuntimeRevision;
use job::RuntimeCleanupJob;

pub(in crate::runtime) const RUNTIME_CLEANUP_QUANTUM: usize = 64;

/// Retired revisions waiting to be released, a bounded number of units at
/// a time. Jobs take turns one unit each, so a large revision does not hold
/// back the ones queued behind it.
#[derive(Debug, Default)]
pub(in crate::runtime) struct RuntimeCleanupQueue {
    jobs: VecDeque<RuntimeCleanupJob>,
}

impl RuntimeCleanupQueue {
    pub(in crate::runtime) fn enqueue_revision(&mut self, owner: RuntimeRevision) {
        self.jobs.push_back(RuntimeCleanupJob::revision(owner));
    }

    pub(in crate::runtime) fn is_empty(&self) -> bool {
        self.jobs.is_empty()
    }

    pub(in crate::runtime) fn advance(&mut self, budget: NonZeroUsize) -> CleanupProgress {
        let mut consumed_units = 0;
        while consumed_units < budget.get() && self.advance_one() {
            consumed_units += 1;
        }
        CleanupProgress {
            consumed_units,
            complete: self.is_empty(),
        }
    }

    pub(in crate::runtime) fn drain_sync(&mut self) {
        while let Some(mut job) = self.jobs.pop_front() {
            job.drain();
        }
    }

    fn advance_one(&mut self) -> bool {
        let Some(mut job) = self.jobs.pop_front() else {
            return false;
        };
        let advanced = job.advance_one();
        debug_assert!(advanced, "queued cleanup job has work");
        if !job.is_complete() {
            self.jobs.push_back(job);
        }
        true
    }

    #[cfg(test)]
    fn enqueue_probe(&mut self, probe: RuntimeCleanupProbe) {
        self.jobs.push_back(RuntimeCleanupJob::probe(probe));
    }

    #[cfg(test)]
    pub(in crate::runtime) fn job_count(&self) -> usize {
        self.jobs.len()
    }
}

impl Drop for RuntimeCleanupQueue {
    fn drop(&mut self) {
        self.drain_sync();
    }
}

#[cfg(test)]
#[path = "queue/tests.rs"]
mod tests;
