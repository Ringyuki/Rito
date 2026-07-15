use std::{collections::btree_map::IntoIter, collections::VecDeque, num::NonZeroUsize};

use crate::layout::CleanupProgress;

use super::super::frame::{RuntimeCachedFrame, RuntimeFrameCacheOwner};

mod cached;

pub(in crate::runtime) use cached::PendingRuntimeCachedFrameCleanup;

/// Releases cached frame owners one at a time in spread-index order.
///
/// If nested cached frame `i` costs `F_i`, a cache costs exactly
/// `3 + sum(F_i + 1)` units. The extra unit retires each completed nested
/// cursor before the map source advances. Frame payload owners remain visible
/// to the frame lane until their last nested unit is released.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeFrameCacheCleanup {
    owner: Option<RuntimeFrameCacheOwner>,
    frames: Option<IntoIter<usize, RuntimeCachedFrame>>,
    frame: Option<PendingRuntimeCachedFrameCleanup>,
    order: Option<VecDeque<usize>>,
    stage: FrameCacheCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FrameCacheCleanupStage {
    FramesSource,
    Frames,
    Order,
    Complete,
}

impl PendingRuntimeFrameCacheCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeFrameCacheOwner) -> Self {
        Self {
            owner: Some(owner),
            frames: None,
            frame: None,
            order: None,
            stage: FrameCacheCleanupStage::FramesSource,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == FrameCacheCleanupStage::Complete
    }

    pub(in crate::runtime) fn pending_frame_owner_count(&self) -> usize {
        self.owner.as_ref().map_or_else(
            || {
                self.frames.as_ref().map_or(0, ExactSizeIterator::len)
                    + self.frame.as_ref().map_or(
                        0,
                        PendingRuntimeCachedFrameCleanup::pending_frame_owner_count,
                    )
            },
            |owner| owner.frames.len(),
        )
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        match self.stage {
            FrameCacheCleanupStage::FramesSource => self.start_frames(),
            FrameCacheCleanupStage::Frames => self.release_next_frame(),
            FrameCacheCleanupStage::Order => self.release_order(),
            FrameCacheCleanupStage::Complete => false,
        }
    }

    pub(in crate::runtime) fn advance(&mut self, budget: NonZeroUsize) -> CleanupProgress {
        let mut consumed_units = 0;
        while consumed_units < budget.get() && self.advance_one() {
            consumed_units += 1;
        }
        let progress = CleanupProgress {
            consumed_units,
            complete: self.is_complete(),
        };
        debug_assert!(progress.complete || progress.consumed_units == budget.get());
        progress
    }

    pub(in crate::runtime) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }

    fn start_frames(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its frame cache");
        self.frames = Some(owner.frames.into_iter());
        self.order = Some(owner.order);
        self.stage = FrameCacheCleanupStage::Frames;
        true
    }

    fn release_next_frame(&mut self) -> bool {
        if self
            .frame
            .as_ref()
            .is_some_and(PendingRuntimeCachedFrameCleanup::is_complete)
        {
            self.frame = None;
            return true;
        }
        if let Some(frame) = self.frame.as_mut() {
            let advanced = frame.advance_one();
            debug_assert!(advanced, "incomplete cached-frame cleanup has work");
            return true;
        }
        let frames = self.frames.as_mut().expect("frame source exists");
        if let Some((_spread_index, frame)) = frames.next() {
            let mut frame = PendingRuntimeCachedFrameCleanup::new(frame);
            let advanced = frame.advance_one();
            debug_assert!(advanced, "new cached-frame cleanup has work");
            self.frame = Some(frame);
            return true;
        }
        self.frames = None;
        self.stage = FrameCacheCleanupStage::Order;
        true
    }

    fn release_order(&mut self) -> bool {
        drop(self.order.take().expect("frame-cache order exists"));
        self.stage = FrameCacheCleanupStage::Complete;
        true
    }
}

impl Drop for PendingRuntimeFrameCacheCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "frame_cache/tests.rs"]
mod tests;
