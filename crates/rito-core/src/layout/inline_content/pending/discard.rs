use crate::{
    layout::text_work::{TextWorkMeter, TextWorkYield},
    style::StyledNode,
};

#[derive(Debug)]
pub(super) struct PendingNodeDiscard {
    frames: Vec<std::vec::IntoIter<StyledNode>>,
}

impl PendingNodeDiscard {
    pub(super) fn new(nodes: Vec<StyledNode>) -> Self {
        Self {
            frames: vec![nodes.into_iter()],
        }
    }

    pub(super) fn advance(&mut self, work: &mut TextWorkMeter) -> Result<bool, TextWorkYield> {
        if self
            .frames
            .last()
            .is_some_and(|frame| frame.as_slice().is_empty())
        {
            super::require_unit(work)?;
            self.frames.pop();
            return Ok(self.frames.is_empty());
        }

        super::require_unit(work)?;
        let mut node = self
            .frames
            .last_mut()
            .and_then(Iterator::next)
            .expect("a paid discarded node exists");
        if !node.children.is_empty() {
            self.frames
                .push(std::mem::take(&mut node.children).into_iter());
        }
        Ok(false)
    }

    pub(super) fn drain_remaining_into(&mut self, output: &mut Vec<StyledNode>) {
        for frame in self.frames.drain(..) {
            output.extend(frame);
        }
    }
}
