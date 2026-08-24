use crate::{
    layout::{LayoutConfig, PendingLayoutConfigCleanup},
    runtime::{
        continuation::{
            PendingRuntimeChapterContinuationCleanup, PendingRuntimeContinuationRecordCleanup,
            PendingRuntimeContinuationWorkCleanup, RuntimeChapterContinuation,
            RuntimeContinuationRecord, RuntimeContinuationWork,
        },
        frame::{RuntimeCachedFrame, RuntimeFrameCacheOwner, RuntimeRevision},
    },
};

use super::super::{
    PendingRuntimeCachedFrameCleanup, PendingRuntimeFrameCacheCleanup,
    PendingRuntimeRevisionCleanup,
};
#[cfg(test)]
use super::probe::RuntimeCleanupProbe;

#[derive(Debug)]
pub(super) struct RuntimeCleanupJob {
    cursor: Option<RuntimeCleanupCursor>,
}

#[derive(Debug)]
enum RuntimeCleanupCursor {
    Continuation(Box<PendingRuntimeContinuationRecordCleanup>),
    CompletedChapter(Box<PendingRuntimeChapterContinuationCleanup>),
    ContinuationWork(Box<PendingRuntimeContinuationWorkCleanup>),
    Revision(Box<PendingRuntimeRevisionCleanup>),
    FrameCache(Box<PendingRuntimeFrameCacheCleanup>),
    CachedFrame(Box<PendingRuntimeCachedFrameCleanup>),
    LayoutConfig(Box<PendingLayoutConfigCleanup>),
    #[cfg(test)]
    Probe(RuntimeCleanupProbe),
}

impl RuntimeCleanupJob {
    pub(super) fn continuation(owner: RuntimeContinuationRecord) -> Self {
        Self::new(RuntimeCleanupCursor::Continuation(Box::new(
            PendingRuntimeContinuationRecordCleanup::new(owner),
        )))
    }

    pub(super) fn completed_chapter(owner: RuntimeChapterContinuation) -> Self {
        Self::new(RuntimeCleanupCursor::CompletedChapter(Box::new(
            PendingRuntimeChapterContinuationCleanup::new(owner),
        )))
    }

    pub(super) fn continuation_work(owner: RuntimeContinuationWork) -> Self {
        Self::new(RuntimeCleanupCursor::ContinuationWork(Box::new(
            PendingRuntimeContinuationWorkCleanup::new(owner),
        )))
    }

    pub(super) fn revision(owner: RuntimeRevision) -> Self {
        Self::new(RuntimeCleanupCursor::Revision(Box::new(
            PendingRuntimeRevisionCleanup::new(owner),
        )))
    }

    pub(super) fn frame_cache(owner: RuntimeFrameCacheOwner) -> Self {
        Self::new(RuntimeCleanupCursor::FrameCache(Box::new(
            PendingRuntimeFrameCacheCleanup::new(owner),
        )))
    }

    pub(super) fn cached_frame(owner: RuntimeCachedFrame) -> Self {
        Self::new(RuntimeCleanupCursor::CachedFrame(Box::new(
            PendingRuntimeCachedFrameCleanup::new(owner),
        )))
    }

    pub(super) fn layout_config(owner: LayoutConfig) -> Self {
        Self::new(RuntimeCleanupCursor::LayoutConfig(Box::new(
            PendingLayoutConfigCleanup::new(owner),
        )))
    }

    #[cfg(test)]
    pub(super) fn probe(owner: RuntimeCleanupProbe) -> Self {
        Self::new(RuntimeCleanupCursor::Probe(owner))
    }

    fn new(cursor: RuntimeCleanupCursor) -> Self {
        Self {
            cursor: Some(cursor),
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        self.cursor.is_none()
    }

    fn cursor_is_complete(&self) -> bool {
        match self.cursor.as_ref().expect("active cleanup cursor exists") {
            RuntimeCleanupCursor::Continuation(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::CompletedChapter(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::ContinuationWork(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::Revision(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::FrameCache(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::CachedFrame(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::LayoutConfig(cleanup) => cleanup.is_complete(),
            #[cfg(test)]
            RuntimeCleanupCursor::Probe(cleanup) => cleanup.is_complete(),
        }
    }

    pub(super) fn advance_one(&mut self) -> bool {
        if self.is_complete() {
            return false;
        }
        if self.cursor_is_complete() {
            self.cursor = None;
            return true;
        }
        match self.cursor.as_mut().expect("active cleanup cursor exists") {
            RuntimeCleanupCursor::Continuation(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::CompletedChapter(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::ContinuationWork(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::Revision(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::FrameCache(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::CachedFrame(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::LayoutConfig(cleanup) => cleanup.advance_one(),
            #[cfg(test)]
            RuntimeCleanupCursor::Probe(cleanup) => cleanup.advance_one(),
        }
    }

    pub(super) fn pending_frame_owner_count(&self) -> usize {
        let Some(cursor) = self.cursor.as_ref() else {
            return 0;
        };
        match cursor {
            RuntimeCleanupCursor::Continuation(_) => 0,
            RuntimeCleanupCursor::CompletedChapter(_) => 0,
            RuntimeCleanupCursor::ContinuationWork(_) => 0,
            RuntimeCleanupCursor::Revision(cleanup) => cleanup.pending_frame_owner_count(),
            RuntimeCleanupCursor::FrameCache(cleanup) => cleanup.pending_frame_owner_count(),
            RuntimeCleanupCursor::CachedFrame(cleanup) => cleanup.pending_frame_owner_count(),
            RuntimeCleanupCursor::LayoutConfig(_) => 0,
            #[cfg(test)]
            RuntimeCleanupCursor::Probe(cleanup) => cleanup.pending_frame_owner_count,
        }
    }

    pub(super) fn drain(&mut self) {
        while self.advance_one() {}
        debug_assert!(self.is_complete());
    }
}
