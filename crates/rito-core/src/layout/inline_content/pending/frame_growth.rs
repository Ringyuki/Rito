use crate::{
    layout::text_work::{
        AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield,
    },
    style::StyledNodeKind,
};

use super::{frame::CollectionFrame, PendingInlineCandidateCollector};

impl PendingInlineCandidateCollector {
    pub(super) const fn frame_slot_available(&self) -> bool {
        self.frames.len() < self.frames.capacity()
    }

    pub(super) fn ensure_frame_slot(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if self.frame_slot_available() {
            return Ok(());
        }

        let expected_depth = checked_post_frame_depth(self.frames.len())
            .expect("inline collection frame depth must fit in usize");
        if matches!(
            work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, expected_depth,),
            TextWorkPermitResult::Yield
        ) {
            return Err(TextWorkYield);
        }
        self.frames.reserve(1);
        assert!(
            self.frame_slot_available(),
            "a paid frame reserve must provide an append slot"
        );
        Ok(())
    }

    pub(super) fn push_reserved_frame(&mut self, frame: CollectionFrame) {
        assert!(
            self.frame_slot_available(),
            "collection frames must reserve capacity before pushing"
        );
        let capacity = self.frames.capacity();
        self.frames.push(frame);
        assert_eq!(
            self.frames.capacity(),
            capacity,
            "a paid collection frame push must not grow the stack"
        );
    }

    pub(super) fn next_node_requires_frame(&self) -> bool {
        self.current_node_frame()
            .nodes
            .as_slice()
            .first()
            .is_some_and(|node| node.node_type == StyledNodeKind::Inline)
    }
}

pub(super) const fn checked_post_frame_depth(depth: usize) -> Option<usize> {
    depth.checked_add(1)
}
