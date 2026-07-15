use std::{collections::VecDeque, num::NonZeroUsize};

#[cfg(test)]
mod probe;
#[cfg(test)]
use probe::RuntimeCleanupProbe;

use crate::layout::{CleanupProgress, LayoutConfig, PendingLayoutConfigCleanup};

use super::{
    super::{
        continuation::{PendingRuntimeContinuationRecordCleanup, RuntimeContinuationRecord},
        frame::{RuntimeCachedFrame, RuntimeFrameCacheOwner, RuntimeRevision},
    },
    PendingRuntimeCachedFrameCleanup, PendingRuntimeFrameCacheCleanup,
    PendingRuntimeRevisionCleanup,
};

pub(in crate::runtime) const RUNTIME_CLEANUP_QUANTUM: usize = 64;
const FRAME_BACKLOG_HIGH_WATER: usize = 24;
const FRAME_PRIORITY_BURST: usize = 8;

#[derive(Debug)]
struct RuntimeCleanupJob {
    cursor: Option<RuntimeCleanupCursor>,
}

#[derive(Debug)]
enum RuntimeCleanupCursor {
    Continuation(Box<PendingRuntimeContinuationRecordCleanup>),
    Revision(Box<PendingRuntimeRevisionCleanup>),
    FrameCache(Box<PendingRuntimeFrameCacheCleanup>),
    CachedFrame(Box<PendingRuntimeCachedFrameCleanup>),
    LayoutConfig(Box<PendingLayoutConfigCleanup>),
    #[cfg(test)]
    Probe(RuntimeCleanupProbe),
}

impl RuntimeCleanupJob {
    fn new(cursor: RuntimeCleanupCursor) -> Self {
        Self {
            cursor: Some(cursor),
        }
    }

    fn is_complete(&self) -> bool {
        self.cursor.is_none()
    }

    fn cursor_is_complete(&self) -> bool {
        match self.cursor.as_ref().expect("active cleanup cursor exists") {
            RuntimeCleanupCursor::Continuation(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::Revision(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::FrameCache(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::CachedFrame(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::LayoutConfig(cleanup) => cleanup.is_complete(),
            #[cfg(test)]
            RuntimeCleanupCursor::Probe(cleanup) => cleanup.is_complete(),
        }
    }

    fn advance_one(&mut self) -> bool {
        if self.is_complete() {
            return false;
        }
        if self.cursor_is_complete() {
            self.cursor = None;
            return true;
        }
        match self.cursor.as_mut().expect("active cleanup cursor exists") {
            RuntimeCleanupCursor::Continuation(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::Revision(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::FrameCache(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::CachedFrame(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::LayoutConfig(cleanup) => cleanup.advance_one(),
            #[cfg(test)]
            RuntimeCleanupCursor::Probe(cleanup) => cleanup.advance_one(),
        }
    }

    fn pending_frame_owner_count(&self) -> usize {
        let Some(cursor) = self.cursor.as_ref() else {
            return 0;
        };
        match cursor {
            RuntimeCleanupCursor::Continuation(_) => 0,
            RuntimeCleanupCursor::Revision(cleanup) => cleanup.pending_frame_owner_count(),
            RuntimeCleanupCursor::FrameCache(cleanup) => cleanup.pending_frame_owner_count(),
            RuntimeCleanupCursor::CachedFrame(cleanup) => cleanup.pending_frame_owner_count(),
            RuntimeCleanupCursor::LayoutConfig(_) => 0,
            #[cfg(test)]
            RuntimeCleanupCursor::Probe(cleanup) => cleanup.pending_frame_owner_count,
        }
    }

    fn drain(&mut self) {
        while self.advance_one() {}
        debug_assert!(self.is_complete());
    }
}

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
        self.enqueue(RuntimeCleanupJob::new(RuntimeCleanupCursor::Continuation(
            Box::new(PendingRuntimeContinuationRecordCleanup::new(owner)),
        )));
    }

    pub(in crate::runtime) fn enqueue_revision(&mut self, owner: RuntimeRevision) {
        self.enqueue(RuntimeCleanupJob::new(RuntimeCleanupCursor::Revision(
            Box::new(PendingRuntimeRevisionCleanup::new(owner)),
        )));
    }

    pub(in crate::runtime) fn enqueue_frame_cache(&mut self, owner: RuntimeFrameCacheOwner) {
        self.enqueue(RuntimeCleanupJob::new(RuntimeCleanupCursor::FrameCache(
            Box::new(PendingRuntimeFrameCacheCleanup::new(owner)),
        )));
    }

    pub(in crate::runtime) fn enqueue_cached_frame(&mut self, owner: RuntimeCachedFrame) {
        self.enqueue(RuntimeCleanupJob::new(RuntimeCleanupCursor::CachedFrame(
            Box::new(PendingRuntimeCachedFrameCleanup::new(owner)),
        )));
    }

    pub(in crate::runtime) fn enqueue_layout_config(&mut self, owner: LayoutConfig) {
        self.enqueue(RuntimeCleanupJob::new(RuntimeCleanupCursor::LayoutConfig(
            Box::new(PendingLayoutConfigCleanup::new(owner)),
        )));
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
        self.enqueue(RuntimeCleanupJob::new(RuntimeCleanupCursor::Probe(probe)));
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
