use std::sync::Arc;

use super::{InlineSegment, WhitespaceCollapseState};
use crate::{
    layout::{
        image_size::ImageSizeIndex,
        text_work::{TextWorkMeter, TextWorkYield},
    },
    style::StyledNode,
};

mod atomic;
mod cleanup;
mod commit;
#[cfg(test)]
mod commit_tests;
mod context;
mod discard;
mod dispatch;
mod frame;
mod frame_growth;
#[cfg(test)]
mod frame_tests;
mod ruby;
mod ruby_text;
mod source;
mod text;
mod transform;

pub(crate) use cleanup::{CleanupProgress, PendingInlineCandidateCleanup};

use atomic::PendingAtomicNode;
use commit::PendingSegmentCommit;
use discard::PendingNodeDiscard;
use frame::{apply_inline_exit, CollectionFrame, NodeFrame};
use ruby::RubyAction;
use text::PendingTextSegment;

#[derive(Debug)]
enum ActiveCollection {
    Text(Box<PendingTextSegment>),
    Atomic(Box<PendingAtomicNode>),
}

/// Owns ordinary inline-tree traversal and never publishes partial segments.
#[derive(Debug)]
pub(crate) struct PendingInlineCandidateCollector {
    initial_root: Option<NodeFrame>,
    frames: Vec<CollectionFrame>,
    active: Option<ActiveCollection>,
    pending_commit: Option<PendingSegmentCommit>,
    discard: Option<PendingNodeDiscard>,
    output: Vec<InlineSegment>,
    whitespace: WhitespaceCollapseState,
    image_sizes: Option<Arc<ImageSizeIndex>>,
}

impl PendingInlineCandidateCollector {
    pub(crate) fn new(
        nodes: Vec<StyledNode>,
        image_sizes: Option<Arc<ImageSizeIndex>>,
        href: Option<String>,
    ) -> Self {
        Self {
            initial_root: Some(NodeFrame::root(nodes, href)),
            frames: Vec::new(),
            active: None,
            pending_commit: None,
            discard: None,
            output: Vec::new(),
            whitespace: WhitespaceCollapseState::default(),
            image_sizes,
        }
    }

    pub(crate) fn advance(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<Vec<InlineSegment>, TextWorkYield> {
        loop {
            if self.initial_root.is_some() {
                self.ensure_frame_slot(work)?;
                let root = self
                    .initial_root
                    .take()
                    .expect("a checked initial node frame exists");
                self.push_reserved_frame(CollectionFrame::Nodes(root));
                continue;
            }
            if self.pending_commit.is_some() {
                self.advance_pending_commit(work)?;
                continue;
            }
            if let Some(active) = self.active.take() {
                self.advance_active(active, work)?;
                continue;
            }
            if let Some(discard) = self.discard.as_mut() {
                if discard.advance(work)? {
                    self.discard = None;
                }
                continue;
            }
            match self.frames.last() {
                Some(CollectionFrame::Nodes(frame)) if frame.nodes.as_slice().is_empty() => {
                    if let Some(output) = self.finish_node_frame(work)? {
                        return Ok(output);
                    }
                }
                Some(CollectionFrame::Nodes(_)) => {
                    if self.next_node_requires_frame() {
                        self.ensure_frame_slot(work)?;
                    }
                    require_unit(work)?;
                    let node = self
                        .current_node_frame_mut()
                        .nodes
                        .next()
                        .expect("a paid frame node exists");
                    self.dispatch_node(node);
                }
                Some(CollectionFrame::Ruby(_)) => {
                    let frame_slot_available = self.frame_slot_available();
                    let action = {
                        let frame = self
                            .frames
                            .last_mut()
                            .and_then(|frame| match frame {
                                CollectionFrame::Ruby(frame) => Some(frame),
                                CollectionFrame::Nodes(_) => None,
                            })
                            .expect("the active collection frame is ruby");
                        let output_len = self.output.len();
                        frame.advance(&mut self.output, output_len, frame_slot_available, work)?
                    };
                    match action {
                        RubyAction::NeedBaseFrameCapacity => self.ensure_frame_slot(work)?,
                        RubyAction::PushBase(nodes) => {
                            let context = self
                                .frames
                                .last()
                                .and_then(|frame| match frame {
                                    CollectionFrame::Ruby(frame) => Some(frame.base_context()),
                                    CollectionFrame::Nodes(_) => None,
                                })
                                .expect("a ruby base inherits its ruby frame context")
                                .clone();
                            self.push_reserved_frame(CollectionFrame::Nodes(NodeFrame::ruby_base(
                                nodes, context,
                            )));
                        }
                        RubyAction::Complete => self.finish_ruby_frame(work)?,
                    }
                }
                None => unreachable!("an unfinished collector owns a frame"),
            }
        }
    }

    fn advance_active(
        &mut self,
        active: ActiveCollection,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        match active {
            ActiveCollection::Text(mut text) => match text.advance(work) {
                Ok(true) => {
                    self.pending_commit = Some(PendingSegmentCommit::new(InlineSegment::Text(
                        (*text).finish(),
                    )))
                }
                Ok(false) => self.active = Some(ActiveCollection::Text(text)),
                Err(error) => {
                    self.active = Some(ActiveCollection::Text(text));
                    return Err(error);
                }
            },
            ActiveCollection::Atomic(atomic) => self.advance_atomic(atomic, work)?,
        }
        Ok(())
    }

    fn advance_pending_commit(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        let text_index = self
            .pending_commit
            .as_mut()
            .expect("a checked pending segment commit exists")
            .advance(&mut self.output, work)?;
        self.pending_commit = None;
        if let Some(index) = text_index {
            self.current_node_frame_mut().summary.include(index);
        }
        Ok(())
    }

    fn finish_node_frame(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<Option<Vec<InlineSegment>>, TextWorkYield> {
        require_unit(work)?;
        let CollectionFrame::Nodes(frame) =
            self.frames.pop().expect("a finished node frame exists")
        else {
            unreachable!("only node frames finish through the node path")
        };
        if let Some(exit) = frame.exit {
            apply_inline_exit(&mut self.output, &frame.summary, exit);
        }
        match self.frames.last_mut() {
            Some(CollectionFrame::Nodes(parent)) => {
                parent.summary.merge(&frame.summary);
                Ok(None)
            }
            Some(CollectionFrame::Ruby(parent)) => {
                parent.finish_base(frame.summary, self.output.len());
                Ok(None)
            }
            None => Ok(Some(std::mem::take(&mut self.output))),
        }
    }

    fn finish_ruby_frame(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        require_unit(work)?;
        let CollectionFrame::Ruby(frame) =
            self.frames.pop().expect("a completed ruby frame exists")
        else {
            unreachable!("only ruby frames finish through the ruby path")
        };
        let summary = frame.into_summary();
        let Some(CollectionFrame::Nodes(parent)) = self.frames.last_mut() else {
            unreachable!("ruby frames are dispatched from node frames")
        };
        parent.summary.merge(&summary);
        Ok(())
    }
}

pub(super) fn require_unit(work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
    (work.take_utf16_units(1) == 1)
        .then_some(())
        .ok_or(TextWorkYield)
}
