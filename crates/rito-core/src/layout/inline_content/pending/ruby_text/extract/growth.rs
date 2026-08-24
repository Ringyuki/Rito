use crate::{
    layout::text_work::{TextWorkMeter, TextWorkYield},
    style::{StyledNode, StyledNodeKind},
};

use super::{super::admit_inline_collection, PendingRubyAnnotation};

impl PendingRubyAnnotation {
    pub(super) fn frame_slot_available(&self) -> bool {
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
            .expect("ruby annotation frame depth must fit in usize");
        admit_inline_collection(work, expected_depth)?;
        self.frames.reserve(1);
        assert!(
            self.frame_slot_available(),
            "a paid annotation frame reserve must provide a slot"
        );
        Ok(())
    }

    pub(super) fn push_reserved_frame(&mut self, frame: std::vec::IntoIter<StyledNode>) {
        assert!(
            self.frame_slot_available(),
            "annotation frames must reserve before pushing"
        );
        let capacity = self.frames.capacity();
        self.frames.push(frame);
        assert_eq!(
            self.frames.capacity(),
            capacity,
            "a paid annotation frame push must not grow the stack"
        );
    }

    pub(super) fn next_node_requires_frame(&self) -> bool {
        self.frames
            .last()
            .and_then(|frame| frame.as_slice().first())
            .is_some_and(|node| node.node_type != StyledNodeKind::Text)
    }

    pub(super) fn part_slot_available(&self) -> bool {
        self.parts.len() < self.parts.capacity()
    }

    pub(super) fn ensure_part_slot(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if self.part_slot_available() {
            return Ok(());
        }
        let expected_count = checked_post_part_count(self.parts.len())
            .expect("ruby annotation part count must fit in usize");
        admit_inline_collection(work, expected_count)?;
        self.parts.reserve(1);
        assert!(
            self.part_slot_available(),
            "a paid annotation part reserve must provide a slot"
        );
        Ok(())
    }

    pub(super) fn push_reserved_part(&mut self, part: String) {
        assert!(
            self.part_slot_available(),
            "annotation parts must reserve before pushing"
        );
        let capacity = self.parts.capacity();
        self.parts.push(part);
        assert_eq!(
            self.parts.capacity(),
            capacity,
            "a paid annotation part push must not grow the buffer"
        );
    }
}

pub(super) const fn checked_post_frame_depth(depth: usize) -> Option<usize> {
    depth.checked_add(1)
}

pub(super) const fn checked_post_part_count(count: usize) -> Option<usize> {
    count.checked_add(1)
}
