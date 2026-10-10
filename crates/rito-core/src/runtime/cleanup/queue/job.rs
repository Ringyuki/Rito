use crate::runtime::frame::RuntimeRevision;

use super::super::PendingRuntimeRevisionCleanup;
#[cfg(test)]
use super::probe::RuntimeCleanupProbe;

#[derive(Debug)]
pub(super) struct RuntimeCleanupJob {
    cursor: Option<RuntimeCleanupCursor>,
}

#[derive(Debug)]
enum RuntimeCleanupCursor {
    Revision(Box<PendingRuntimeRevisionCleanup>),
    #[cfg(test)]
    Probe(RuntimeCleanupProbe),
}

impl RuntimeCleanupJob {
    pub(super) fn revision(owner: RuntimeRevision) -> Self {
        Self::new(RuntimeCleanupCursor::Revision(Box::new(
            PendingRuntimeRevisionCleanup::new(owner),
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
            #[cfg(test)]
            RuntimeCleanupCursor::Probe(cleanup) => cleanup.advance_one(),
        }
    }

    pub(super) fn drain(&mut self) {
        while self.advance_one() {}
        debug_assert!(self.is_complete());
    }
}
