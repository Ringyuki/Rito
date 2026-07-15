use std::{collections::btree_map::IntoIter, collections::VecDeque, num::NonZeroUsize};

use crate::layout::CleanupProgress;

use super::super::frame::{RuntimeCachedFrame, RuntimeFrameCacheOwner};

/// Releases one generated cached frame as an explicit scheduling unit.
///
/// The frame's optional legacy JSON commands and packed tables remain one
/// indivisible destructor residual. This guard exists so LRU eviction can
/// transfer the owner without allocating a singleton map or synchronously
/// dropping it. Packed-only and JSON-materialized entries have the same
/// structural cost because they remain one cache owner either way.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeCachedFrameCleanup {
    owner: Option<RuntimeCachedFrame>,
}

impl PendingRuntimeCachedFrameCleanup {
    pub(in crate::runtime) fn new(owner: RuntimeCachedFrame) -> Self {
        Self { owner: Some(owner) }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.owner.is_none()
    }

    pub(in crate::runtime) fn pending_frame_owner_count(&self) -> usize {
        usize::from(self.owner.is_some())
    }

    pub(in crate::runtime) fn advance_one(&mut self) -> bool {
        let Some(owner) = self.owner.take() else {
            return false;
        };
        drop(owner);
        true
    }

    pub(in crate::runtime) fn advance(&mut self, _budget: NonZeroUsize) -> CleanupProgress {
        let consumed_units = usize::from(self.advance_one());
        CleanupProgress {
            consumed_units,
            complete: self.is_complete(),
        }
    }

    pub(in crate::runtime) fn drain(&mut self) {
        let progress = self.advance(NonZeroUsize::MIN);
        debug_assert!(progress.complete);
    }
}

impl Drop for PendingRuntimeCachedFrameCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

/// Releases cached frame owners one at a time in spread-index order.
///
/// A cache with `F` entries costs exactly `F + 3` units. Each generated frame
/// remains an indivisible residual: its optional command JSON and packed string
/// tables have engine-controlled depth but unbounded length. The runtime queue
/// can therefore interleave cache entries, but this cursor alone is not a
/// wall-clock bound for one unusually large frame.
#[derive(Debug)]
pub(in crate::runtime) struct PendingRuntimeFrameCacheCleanup {
    owner: Option<RuntimeFrameCacheOwner>,
    frames: Option<IntoIter<usize, RuntimeCachedFrame>>,
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
            order: None,
            stage: FrameCacheCleanupStage::FramesSource,
        }
    }

    pub(in crate::runtime) fn is_complete(&self) -> bool {
        self.stage == FrameCacheCleanupStage::Complete
    }

    pub(in crate::runtime) fn pending_frame_owner_count(&self) -> usize {
        self.owner.as_ref().map_or_else(
            || self.frames.as_ref().map_or(0, ExactSizeIterator::len),
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
        let frames = self.frames.as_mut().expect("frame source exists");
        if let Some((_spread_index, frame)) = frames.next() {
            let mut frame = PendingRuntimeCachedFrameCleanup::new(frame);
            let advanced = frame.advance_one();
            debug_assert!(advanced, "new cached-frame cleanup has work");
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
