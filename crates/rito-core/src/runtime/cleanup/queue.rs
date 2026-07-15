use std::{collections::VecDeque, num::NonZeroUsize};

mod job;
#[cfg(test)]
mod probe;
#[cfg(test)]
use probe::RuntimeCleanupProbe;

use crate::layout::{CleanupProgress, LayoutConfig};

use super::super::{
    continuation::{RuntimeChapterContinuation, RuntimeContinuationRecord},
    frame::{
        RuntimeCachedFrame, RuntimeFrameCacheOwner, RuntimeRevision, RuntimeRevisionInteractions,
    },
};
use job::RuntimeCleanupJob;

pub(in crate::runtime) const RUNTIME_CLEANUP_QUANTUM: usize = 64;
const FRAME_BACKLOG_HIGH_WATER: usize = 24;
const FRAME_PRIORITY_BURST: usize = 8;

#[derive(Debug)]
pub(in crate::runtime) struct RuntimeCleanupQueue {
    frame_jobs: VecDeque<RuntimeCleanupJob>,
    regular_jobs: VecDeque<RuntimeCleanupJob>,
    pending_frame_owners: usize,
    prefer_frame: bool,
    frame_priority_streak: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CleanupClass {
    Frame,
    Regular,
}

impl Default for RuntimeCleanupQueue {
    fn default() -> Self {
        Self {
            frame_jobs: VecDeque::new(),
            regular_jobs: VecDeque::new(),
            pending_frame_owners: 0,
            prefer_frame: true,
            frame_priority_streak: 0,
        }
    }
}

impl RuntimeCleanupQueue {
    pub(in crate::runtime) fn enqueue_continuation(&mut self, owner: RuntimeContinuationRecord) {
        self.enqueue(RuntimeCleanupJob::continuation(owner));
    }

    pub(in crate::runtime) fn enqueue_completed_chapter(
        &mut self,
        owner: RuntimeChapterContinuation,
    ) {
        self.enqueue(RuntimeCleanupJob::completed_chapter(owner));
    }

    pub(in crate::runtime) fn enqueue_revision(&mut self, owner: RuntimeRevision) {
        self.enqueue(RuntimeCleanupJob::revision(owner));
    }

    pub(in crate::runtime) fn enqueue_revision_interactions(
        &mut self,
        owner: Vec<RuntimeRevisionInteractions>,
    ) {
        if owner.is_empty() {
            return;
        }
        self.enqueue(RuntimeCleanupJob::revision_interactions(owner));
    }

    pub(in crate::runtime) fn enqueue_frame_cache(&mut self, owner: RuntimeFrameCacheOwner) {
        self.enqueue(RuntimeCleanupJob::frame_cache(owner));
    }

    pub(in crate::runtime) fn enqueue_cached_frame(&mut self, owner: RuntimeCachedFrame) {
        self.enqueue(RuntimeCleanupJob::cached_frame(owner));
    }

    pub(in crate::runtime) fn enqueue_layout_config(&mut self, owner: LayoutConfig) {
        self.enqueue(RuntimeCleanupJob::layout_config(owner));
    }

    pub(in crate::runtime) fn is_empty(&self) -> bool {
        self.frame_jobs.is_empty() && self.regular_jobs.is_empty()
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
        while let Some(mut job) = self.frame_jobs.pop_front() {
            job.drain();
        }
        while let Some(mut job) = self.regular_jobs.pop_front() {
            job.drain();
        }
        self.pending_frame_owners = 0;
        debug_assert!(self.is_empty());
    }

    fn enqueue(&mut self, job: RuntimeCleanupJob) {
        self.pending_frame_owners = self
            .pending_frame_owners
            .checked_add(job.pending_frame_owner_count())
            .expect("pending frame-owner count must not overflow");
        self.requeue(job);
    }

    fn advance_one(&mut self) -> bool {
        let Some(class) = self.next_class() else {
            return false;
        };
        let mut job = self.pop(class);
        let before = job.pending_frame_owner_count();
        let advanced = job.advance_one();
        debug_assert!(advanced, "queued cleanup job has work");
        let after = job.pending_frame_owner_count();
        debug_assert!(after <= before, "cleanup cannot create frame owners");
        self.pending_frame_owners -= before - after;
        self.note_service(class);
        if !job.is_complete() {
            self.requeue(job);
        }
        true
    }

    fn next_class(&self) -> Option<CleanupClass> {
        match (self.frame_jobs.is_empty(), self.regular_jobs.is_empty()) {
            (true, true) => None,
            (false, true) => Some(CleanupClass::Frame),
            (true, false) => Some(CleanupClass::Regular),
            (false, false)
                if self.pending_frame_owners >= FRAME_BACKLOG_HIGH_WATER
                    && self.frame_priority_streak < FRAME_PRIORITY_BURST =>
            {
                Some(CleanupClass::Frame)
            }
            (false, false) if self.pending_frame_owners >= FRAME_BACKLOG_HIGH_WATER => {
                Some(CleanupClass::Regular)
            }
            (false, false) if self.prefer_frame => Some(CleanupClass::Frame),
            (false, false) => Some(CleanupClass::Regular),
        }
    }

    fn pop(&mut self, class: CleanupClass) -> RuntimeCleanupJob {
        match class {
            CleanupClass::Frame => self.frame_jobs.pop_front(),
            CleanupClass::Regular => self.regular_jobs.pop_front(),
        }
        .expect("selected cleanup class is non-empty")
    }

    fn requeue(&mut self, job: RuntimeCleanupJob) {
        if job.pending_frame_owner_count() > 0 {
            self.frame_jobs.push_back(job);
        } else {
            self.regular_jobs.push_back(job);
        }
    }

    fn note_service(&mut self, class: CleanupClass) {
        match class {
            CleanupClass::Frame => {
                self.prefer_frame = false;
                if self.pending_frame_owners >= FRAME_BACKLOG_HIGH_WATER {
                    self.frame_priority_streak = self
                        .frame_priority_streak
                        .saturating_add(1)
                        .min(FRAME_PRIORITY_BURST);
                } else {
                    self.frame_priority_streak = 0;
                }
            }
            CleanupClass::Regular => {
                self.prefer_frame = true;
                self.frame_priority_streak = 0;
            }
        }
    }

    #[cfg(test)]
    fn enqueue_probe(&mut self, probe: RuntimeCleanupProbe) {
        self.enqueue(RuntimeCleanupJob::probe(probe));
    }

    pub(in crate::runtime) fn pending_frame_owner_count(&self) -> usize {
        self.pending_frame_owners
    }

    #[cfg(test)]
    pub(in crate::runtime) fn job_count(&self) -> usize {
        self.frame_jobs.len() + self.regular_jobs.len()
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

#[cfg(test)]
#[path = "queue/revision_interactions_vector_tests.rs"]
mod revision_interactions_vector_tests;
