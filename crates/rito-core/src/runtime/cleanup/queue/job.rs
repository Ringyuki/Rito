use crate::runtime::frame::{RuntimeCachedFrame, RuntimeRevision};

use super::super::{PendingRuntimeCachedFrameCleanup, PendingRuntimeRevisionCleanup};
#[cfg(test)]
use super::probe::RuntimeCleanupProbe;

#[derive(Debug)]
pub(super) struct RuntimeCleanupJob {
    cursor: Option<RuntimeCleanupCursor>,
}

#[derive(Debug)]
enum RuntimeCleanupCursor {
    Revision(Box<PendingRuntimeRevisionCleanup>),
    CachedFrame(Box<PendingRuntimeCachedFrameCleanup>),
    #[cfg(test)]
    Probe(RuntimeCleanupProbe),
}

impl RuntimeCleanupJob {
    pub(super) fn revision(owner: RuntimeRevision) -> Self {
        Self::new(RuntimeCleanupCursor::Revision(Box::new(
            PendingRuntimeRevisionCleanup::new(owner),
        )))
    }

    pub(super) fn cached_frame(owner: RuntimeCachedFrame) -> Self {
        Self::new(RuntimeCleanupCursor::CachedFrame(Box::new(
            PendingRuntimeCachedFrameCleanup::new(owner),
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
            RuntimeCleanupCursor::Revision(cleanup) => cleanup.is_complete(),
            RuntimeCleanupCursor::CachedFrame(cleanup) => cleanup.is_complete(),
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
            RuntimeCleanupCursor::Revision(cleanup) => cleanup.advance_one(),
            RuntimeCleanupCursor::CachedFrame(cleanup) => cleanup.advance_one(),
            #[cfg(test)]
            RuntimeCleanupCursor::Probe(cleanup) => cleanup.advance_one(),
        }
    }

    pub(super) fn pending_frame_owner_count(&self) -> usize {
        let Some(cursor) = self.cursor.as_ref() else {
            return 0;
        };
        match cursor {
            RuntimeCleanupCursor::Revision(cleanup) => cleanup.pending_frame_owner_count(),
            RuntimeCleanupCursor::CachedFrame(cleanup) => cleanup.pending_frame_owner_count(),
            #[cfg(test)]
            RuntimeCleanupCursor::Probe(cleanup) => cleanup.pending_frame_owner_count,
        }
    }

    pub(super) fn drain(&mut self) {
        while self.advance_one() {}
        debug_assert!(self.is_complete());
    }
}
