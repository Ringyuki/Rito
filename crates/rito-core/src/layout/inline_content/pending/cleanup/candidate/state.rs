use crate::layout::inline_content::pending::{
    discard::PendingNodeDiscardCleanup, frame::CollectionFrame, PendingInlineCandidateCollector,
};

use super::{active::PendingActiveCollectionCleanup, frame::PendingCollectionFrameCleanup};

#[derive(Debug)]
pub(super) struct CandidateCleanupState {
    stage: CandidateCleanupStage,
    nested: Option<CandidateNestedCleanup>,
}

#[derive(Debug)]
#[allow(clippy::large_enum_variant)] // Exactly one existing owner is retained; boxing would allocate.
enum CandidateNestedCleanup {
    Frame(PendingCollectionFrameCleanup),
    Discard(PendingNodeDiscardCleanup),
    Active(PendingActiveCollectionCleanup),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CandidateCleanupStage {
    InitialRootSlot,
    InitialRoot,
    FramesSource,
    Frame,
    DiscardSlot,
    Discard,
    ActiveSlot,
    Active,
    PendingCommit,
    OutputSource,
    Output,
    Whitespace,
    ImageSizes,
    Owner,
    Complete,
}

impl Default for CandidateCleanupState {
    fn default() -> Self {
        Self {
            stage: CandidateCleanupStage::InitialRootSlot,
            nested: None,
        }
    }
}

impl CandidateCleanupState {
    pub(super) fn advance_one(&mut self, owner: &mut PendingInlineCandidateCollector) -> bool {
        match self.stage {
            CandidateCleanupStage::InitialRootSlot => self.activate_initial_root(owner),
            CandidateCleanupStage::InitialRoot => {
                self.advance_frame_or_retire(CandidateCleanupStage::FramesSource)
            }
            CandidateCleanupStage::FramesSource => self.activate_next_frame(owner),
            CandidateCleanupStage::Frame => {
                self.advance_frame_or_retire(CandidateCleanupStage::FramesSource)
            }
            CandidateCleanupStage::DiscardSlot => self.activate_discard(owner),
            CandidateCleanupStage::Discard => self.advance_discard_or_retire(),
            CandidateCleanupStage::ActiveSlot => self.activate_active(owner),
            CandidateCleanupStage::Active => self.advance_active_or_retire(),
            CandidateCleanupStage::PendingCommit => self.release_pending_commit(owner),
            CandidateCleanupStage::OutputSource => self.activate_output(),
            CandidateCleanupStage::Output => self.release_output_item(owner),
            CandidateCleanupStage::Whitespace => self.release_whitespace(owner),
            CandidateCleanupStage::ImageSizes => self.release_image_sizes(owner),
            CandidateCleanupStage::Owner => self.complete_cleanup(owner),
            CandidateCleanupStage::Complete => return false,
        }
        true
    }

    pub(super) fn is_complete(&self) -> bool {
        self.stage == CandidateCleanupStage::Complete
    }

    pub(super) fn drain(&mut self, owner: &mut PendingInlineCandidateCollector) {
        while self.advance_one(owner) {}
        debug_assert!(self.is_complete());
    }

    fn activate_initial_root(&mut self, owner: &mut PendingInlineCandidateCollector) {
        self.nested = owner
            .initial_root
            .take()
            .map(CollectionFrame::Nodes)
            .map(PendingCollectionFrameCleanup::new)
            .map(CandidateNestedCleanup::Frame);
        self.stage = if self.nested.is_some() {
            CandidateCleanupStage::InitialRoot
        } else {
            CandidateCleanupStage::FramesSource
        };
    }

    fn activate_next_frame(&mut self, owner: &mut PendingInlineCandidateCollector) {
        self.nested = owner
            .frames
            .pop()
            .map(PendingCollectionFrameCleanup::new)
            .map(CandidateNestedCleanup::Frame);
        self.stage = if self.nested.is_some() {
            CandidateCleanupStage::Frame
        } else {
            CandidateCleanupStage::DiscardSlot
        };
    }

    fn advance_frame_or_retire(&mut self, next: CandidateCleanupStage) {
        let CandidateNestedCleanup::Frame(frame) = self.nested_mut() else {
            unreachable!("the active nested cleanup is a frame")
        };
        if frame.is_complete() {
            self.nested = None;
            self.stage = next;
        } else {
            assert!(frame.advance_one(), "frame cleanup must advance");
        }
    }

    fn activate_discard(&mut self, owner: &mut PendingInlineCandidateCollector) {
        self.nested = owner
            .discard
            .take()
            .map(PendingNodeDiscardCleanup::new)
            .map(CandidateNestedCleanup::Discard);
        self.stage = if self.nested.is_some() {
            CandidateCleanupStage::Discard
        } else {
            CandidateCleanupStage::ActiveSlot
        };
    }

    fn advance_discard_or_retire(&mut self) {
        let CandidateNestedCleanup::Discard(discard) = self.nested_mut() else {
            unreachable!("the active nested cleanup is a discard")
        };
        if discard.is_complete() {
            self.nested = None;
            self.stage = CandidateCleanupStage::ActiveSlot;
        } else {
            assert!(discard.advance_one(), "discard cleanup must advance");
        }
    }

    fn activate_active(&mut self, owner: &mut PendingInlineCandidateCollector) {
        self.nested = owner
            .active
            .take()
            .map(PendingActiveCollectionCleanup::new)
            .map(CandidateNestedCleanup::Active);
        self.stage = if self.nested.is_some() {
            CandidateCleanupStage::Active
        } else {
            CandidateCleanupStage::PendingCommit
        };
    }

    fn advance_active_or_retire(&mut self) {
        let CandidateNestedCleanup::Active(active) = self.nested_mut() else {
            unreachable!("the active nested cleanup is an active collection")
        };
        if active.is_complete() {
            self.nested = None;
            self.stage = CandidateCleanupStage::PendingCommit;
        } else {
            assert!(active.advance_one(), "active cleanup must advance");
        }
    }

    fn release_pending_commit(&mut self, owner: &mut PendingInlineCandidateCollector) {
        let commit = owner.pending_commit.take();
        self.stage = CandidateCleanupStage::OutputSource;
        drop(commit);
    }

    fn activate_output(&mut self) {
        self.stage = CandidateCleanupStage::Output;
    }

    fn release_output_item(&mut self, owner: &mut PendingInlineCandidateCollector) {
        let Some(segment) = owner.output.pop() else {
            self.stage = CandidateCleanupStage::Whitespace;
            return;
        };
        drop(segment);
    }

    fn release_whitespace(&mut self, owner: &mut PendingInlineCandidateCollector) {
        let _whitespace = std::mem::take(&mut owner.whitespace);
        self.stage = CandidateCleanupStage::ImageSizes;
    }

    fn release_image_sizes(&mut self, owner: &mut PendingInlineCandidateCollector) {
        let image_sizes = owner.image_sizes.take();
        self.stage = CandidateCleanupStage::Owner;
        drop(image_sizes);
    }

    fn complete_cleanup(&mut self, owner: &PendingInlineCandidateCollector) {
        debug_assert!(owner.cleanup_fields_are_empty());
        debug_assert!(self.nested.is_none());
        self.stage = CandidateCleanupStage::Complete;
    }

    fn nested_mut(&mut self) -> &mut CandidateNestedCleanup {
        self.nested.as_mut().expect("nested cleanup exists")
    }
}

impl PendingInlineCandidateCollector {
    pub(in crate::layout::inline_content::pending::cleanup) fn cleanup_fields_are_empty(
        &self,
    ) -> bool {
        self.initial_root.is_none()
            && self.frames.is_empty()
            && self.active.is_none()
            && self.pending_commit.is_none()
            && self.discard.is_none()
            && self.output.is_empty()
            && self.image_sizes.is_none()
    }
}
