use crate::{
    layout::text_work::{
        AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield,
    },
    style::StyledNode,
};

#[derive(Debug)]
pub(super) struct PendingNodeDiscard {
    initial_frame: Option<std::vec::IntoIter<StyledNode>>,
    frames: Vec<std::vec::IntoIter<StyledNode>>,
}

impl PendingNodeDiscard {
    pub(super) fn new(nodes: Vec<StyledNode>) -> Self {
        Self {
            initial_frame: Some(nodes.into_iter()),
            frames: Vec::new(),
        }
    }

    pub(super) fn advance(&mut self, work: &mut TextWorkMeter) -> Result<bool, TextWorkYield> {
        if self.initial_frame.is_some() {
            self.ensure_frame_slot(work)?;
            let frame = self
                .initial_frame
                .take()
                .expect("a checked initial discard frame exists");
            self.push_reserved_frame(frame);
        }

        if self
            .frames
            .last()
            .is_some_and(|frame| frame.as_slice().is_empty())
        {
            super::require_unit(work)?;
            self.frames.pop();
            return Ok(self.frames.is_empty());
        }

        if self.next_node_requires_frame() {
            self.ensure_frame_slot(work)?;
        }
        super::require_unit(work)?;
        let mut node = self
            .frames
            .last_mut()
            .and_then(Iterator::next)
            .expect("a paid discarded node exists");
        if !node.children.is_empty() {
            self.push_reserved_frame(std::mem::take(&mut node.children).into_iter());
        }
        Ok(false)
    }

    pub(super) fn drain_remaining_into(&mut self, output: &mut Vec<StyledNode>) {
        if let Some(frame) = self.initial_frame.take() {
            output.extend(frame);
        }
        for frame in self.frames.drain(..) {
            output.extend(frame);
        }
    }

    fn frame_slot_available(&self) -> bool {
        self.frames.len() < self.frames.capacity()
    }

    fn ensure_frame_slot(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        if self.frame_slot_available() {
            return Ok(());
        }

        let expected_depth = checked_post_frame_depth(self.frames.len())
            .expect("discard frame depth must fit in usize");
        if matches!(
            work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, expected_depth),
            TextWorkPermitResult::Yield
        ) {
            return Err(TextWorkYield);
        }
        self.frames.reserve(1);
        assert!(
            self.frame_slot_available(),
            "a paid discard frame reserve must provide an append slot"
        );
        Ok(())
    }

    fn push_reserved_frame(&mut self, frame: std::vec::IntoIter<StyledNode>) {
        assert!(
            self.frame_slot_available(),
            "discard frames must reserve capacity before pushing"
        );
        let capacity = self.frames.capacity();
        self.frames.push(frame);
        assert_eq!(
            self.frames.capacity(),
            capacity,
            "a paid discard frame push must not grow the stack"
        );
    }

    fn next_node_requires_frame(&self) -> bool {
        self.frames
            .last()
            .and_then(|frame| frame.as_slice().first())
            .is_some_and(|node| !node.children.is_empty())
    }
}

const fn checked_post_frame_depth(depth: usize) -> Option<usize> {
    depth.checked_add(1)
}

#[cfg(test)]
#[path = "discard_tests.rs"]
mod tests;
