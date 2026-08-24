use std::num::NonZeroUsize;

use crate::layout::inline_content::pending::{
    cleanup::{CleanupProgress, PendingStyledNodeIterDrop},
    discard::PendingNodeDiscardCleanup,
};

use super::PendingRubyAnnotation;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CleanupPhase {
    InitialFrame,
    Frames,
    Discard,
    ActiveText,
    Parts,
    Output,
    Completed,
    Scalar,
    Owner,
    Complete,
}

/// Owns an annotation extraction while releasing it under an explicit cleanup
/// budget. Construction only takes over the boxed owner; fields are detached
/// one at a time as cleanup advances.
#[derive(Debug)]
pub(in crate::layout::inline_content::pending) struct PendingRubyAnnotationCleanup {
    owner: Option<Box<PendingRubyAnnotation>>,
    phase: CleanupPhase,
    nodes: Option<PendingStyledNodeIterDrop>,
    discard: Option<PendingNodeDiscardCleanup>,
}

impl PendingRubyAnnotationCleanup {
    pub(in crate::layout::inline_content::pending) fn new(
        owner: Box<PendingRubyAnnotation>,
    ) -> Self {
        Self {
            owner: Some(owner),
            phase: CleanupPhase::InitialFrame,
            nodes: None,
            discard: None,
        }
    }

    pub(in crate::layout::inline_content::pending) fn is_complete(&self) -> bool {
        self.phase == CleanupPhase::Complete
    }

    /// Performs exactly one source transition, nested structural step, or
    /// owned-field release. Returns `false` only after cleanup is complete.
    pub(in crate::layout::inline_content::pending) fn advance_one(&mut self) -> bool {
        loop {
            if self.advance_nested() {
                return true;
            }

            match self.phase {
                CleanupPhase::InitialFrame => self.take_initial_frame(),
                CleanupPhase::Frames => {
                    if self.take_frame() {
                        return true;
                    }
                    self.phase = CleanupPhase::Discard;
                    continue;
                }
                CleanupPhase::Discard => self.take_discard(),
                CleanupPhase::ActiveText => self.drop_active_text(),
                CleanupPhase::Parts => {
                    if self.drop_part() {
                        return true;
                    }
                    self.phase = CleanupPhase::Output;
                    continue;
                }
                CleanupPhase::Output => self.drop_output(),
                CleanupPhase::Completed => self.drop_completed(),
                CleanupPhase::Scalar => self.drop_scalar(),
                CleanupPhase::Owner => self.drop_owner(),
                CleanupPhase::Complete => return false,
            }
            return true;
        }
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

    fn advance_nested(&mut self) -> bool {
        if let Some(nodes) = self.nodes.as_mut() {
            if nodes.advance_one() {
                if nodes.is_complete() {
                    self.nodes = None;
                }
                return true;
            }
            self.nodes = None;
        }

        if let Some(discard) = self.discard.as_mut() {
            if discard.advance_one() {
                if discard.is_complete() {
                    self.discard = None;
                }
                return true;
            }
            self.discard = None;
        }
        false
    }

    fn take_initial_frame(&mut self) {
        let frame = self.owner_mut().initial_frame.take();
        self.nodes = frame.map(PendingStyledNodeIterDrop::new);
        self.phase = CleanupPhase::Frames;
    }

    fn take_frame(&mut self) -> bool {
        let Some(frame) = self.owner_mut().frames.pop() else {
            return false;
        };
        self.nodes = Some(PendingStyledNodeIterDrop::new(frame));
        true
    }

    fn take_discard(&mut self) {
        let discard = self.owner_mut().discard.take();
        self.discard = discard.map(PendingNodeDiscardCleanup::new);
        self.phase = CleanupPhase::ActiveText;
    }

    fn drop_active_text(&mut self) {
        drop(self.owner_mut().active_text.take());
        self.phase = CleanupPhase::Parts;
    }

    fn drop_part(&mut self) -> bool {
        let Some(part) = self.owner_mut().parts.pop() else {
            return false;
        };
        drop(part);
        true
    }

    fn drop_output(&mut self) {
        drop(self.owner_mut().output.take());
        self.phase = CleanupPhase::Completed;
    }

    fn drop_completed(&mut self) {
        drop(self.owner_mut().completed.take());
        self.phase = CleanupPhase::Scalar;
    }

    fn drop_scalar(&mut self) {
        let _scalar = self.owner_mut().scalar.take();
        self.phase = CleanupPhase::Owner;
    }

    fn drop_owner(&mut self) {
        self.phase = CleanupPhase::Complete;
        drop(
            self.owner
                .take()
                .expect("an annotation cleanup owner exists"),
        );
    }

    fn owner_mut(&mut self) -> &mut PendingRubyAnnotation {
        self.owner
            .as_deref_mut()
            .expect("an incomplete annotation cleanup owns its extraction")
    }
}

impl Drop for PendingRubyAnnotationCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
mod tests;
