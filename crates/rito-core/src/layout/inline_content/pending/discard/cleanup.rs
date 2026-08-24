use std::num::NonZeroUsize;

use super::{super::cleanup::CleanupProgress, PendingNodeDiscard};
use crate::layout::inline_content::pending::cleanup::PendingStyledNodeIterDrop;

/// Owns an in-flight discard while releasing it under a structural budget.
///
/// Source transitions and the final release of the discard owner are explicit
/// units in addition to the structural units consumed by each node source.
#[derive(Debug)]
pub(in crate::layout::inline_content::pending) struct PendingNodeDiscardCleanup {
    owner: Option<PendingNodeDiscard>,
    active: Option<PendingStyledNodeIterDrop>,
}

impl PendingNodeDiscardCleanup {
    /// Takes ownership without walking or reshaping the discard's sources.
    pub(in crate::layout::inline_content::pending) fn new(owner: PendingNodeDiscard) -> Self {
        Self {
            owner: Some(owner),
            active: None,
        }
    }

    pub(in crate::layout::inline_content::pending) fn is_complete(&self) -> bool {
        self.owner.is_none()
    }

    /// Performs one source transition, one node structural step, or the final
    /// release of the now-empty discard owner.
    pub(in crate::layout::inline_content::pending) fn advance_one(&mut self) -> bool {
        if self.is_complete() {
            return false;
        }

        if self.active_has_work() {
            return self
                .active
                .as_mut()
                .expect("an active discard source exists")
                .advance_one();
        }

        if let Some(source) = self.take_next_source() {
            drop(self.active.take());
            self.active = Some(PendingStyledNodeIterDrop::new(source));
            return true;
        }

        self.release_owner()
    }

    pub(in crate::layout::inline_content::pending) fn advance(
        &mut self,
        budget: NonZeroUsize,
    ) -> CleanupProgress {
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

    pub(in crate::layout::inline_content::pending) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }

    fn active_has_work(&self) -> bool {
        self.active
            .as_ref()
            .is_some_and(|active| !active.is_complete())
    }

    fn take_next_source(&mut self) -> Option<std::vec::IntoIter<crate::style::StyledNode>> {
        let owner = self
            .owner
            .as_mut()
            .expect("an incomplete discard cleanup owns its discard");
        if owner.initial_frame.is_some() {
            return owner.initial_frame.take();
        }
        owner.frames.pop()
    }

    fn release_owner(&mut self) -> bool {
        drop(self.active.take());
        let owner = self
            .owner
            .take()
            .expect("an incomplete discard cleanup owns its discard");
        drop(owner);
        true
    }
}

impl Drop for PendingNodeDiscardCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
#[path = "cleanup_tests.rs"]
mod tests;
