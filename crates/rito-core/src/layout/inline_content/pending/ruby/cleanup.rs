use std::num::NonZeroUsize;

use super::{PendingRubyFrame, RubyState};
use crate::layout::inline_content::pending::cleanup::{CleanupProgress, PendingStyledNodeIterDrop};

mod state;

use state::PendingRubyStateCleanup;

pub(super) fn drop_state_nodes(state: RubyState) {
    state::drop_state_nodes(state);
}

/// Releases every owner retained by one Ruby collection frame under a
/// structural cleanup budget. Creating the cursor only moves the complete
/// frame; all field extraction happens one paid transition at a time.
#[derive(Debug)]
pub(in crate::layout::inline_content::pending) struct PendingRubyFrameCleanup {
    frame: Option<PendingRubyFrame>,
    stage: RubyFrameCleanupStage,
    children: Option<PendingStyledNodeIterDrop>,
    state: Option<PendingRubyStateCleanup>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RubyFrameCleanupStage {
    ChildrenSource,
    Children,
    StateSource,
    State,
    BaseContext,
    Summary,
    Owner,
    Complete,
}

impl PendingRubyFrameCleanup {
    pub(in crate::layout::inline_content::pending) fn new(frame: PendingRubyFrame) -> Self {
        Self {
            frame: Some(frame),
            stage: RubyFrameCleanupStage::ChildrenSource,
            children: None,
            state: None,
        }
    }

    pub(in crate::layout::inline_content::pending) fn advance_one(&mut self) -> bool {
        match self.stage {
            RubyFrameCleanupStage::ChildrenSource => {
                let children =
                    std::mem::replace(&mut self.frame_mut().children, Vec::new().into_iter());
                self.children = Some(PendingStyledNodeIterDrop::new(children));
                self.stage = RubyFrameCleanupStage::Children;
            }
            RubyFrameCleanupStage::Children => {
                let children = self.children.as_mut().expect("ruby child cleanup exists");
                if children.is_complete() {
                    self.children = None;
                    self.stage = RubyFrameCleanupStage::StateSource;
                } else {
                    assert!(children.advance_one(), "ruby child cleanup must advance");
                }
            }
            RubyFrameCleanupStage::StateSource => {
                let state = std::mem::replace(&mut self.frame_mut().state, RubyState::Complete);
                self.state = Some(PendingRubyStateCleanup::new(state));
                self.stage = RubyFrameCleanupStage::State;
            }
            RubyFrameCleanupStage::State => {
                let state = self.state.as_mut().expect("ruby state cleanup exists");
                if state.is_complete() {
                    self.state = None;
                    self.stage = RubyFrameCleanupStage::BaseContext;
                } else {
                    assert!(state.advance_one(), "ruby state cleanup must advance");
                }
            }
            RubyFrameCleanupStage::BaseContext => {
                let _base_context = std::mem::take(&mut self.frame_mut().base_context);
                self.stage = RubyFrameCleanupStage::Summary;
            }
            RubyFrameCleanupStage::Summary => {
                let _summary = std::mem::take(&mut self.frame_mut().summary);
                self.stage = RubyFrameCleanupStage::Owner;
            }
            RubyFrameCleanupStage::Owner => {
                drop(self.frame.take().expect("ruby cleanup owns its frame"));
                self.stage = RubyFrameCleanupStage::Complete;
            }
            RubyFrameCleanupStage::Complete => return false,
        }
        true
    }

    pub(in crate::layout::inline_content::pending) fn is_complete(&self) -> bool {
        self.stage == RubyFrameCleanupStage::Complete
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

    fn frame_mut(&mut self) -> &mut PendingRubyFrame {
        self.frame.as_mut().expect("ruby cleanup owns its frame")
    }
}

impl Drop for PendingRubyFrameCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[cfg(test)]
mod tests;
