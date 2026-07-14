use std::sync::Arc;

use super::{InlineSegment, WhitespaceCollapseState};
use crate::{
    layout::{
        image_size::ImageSizeIndex,
        style_values::{number_style, string_style},
        text_work::{TextWorkMeter, TextWorkYield},
    },
    style::{StyledNode, StyledNodeKind},
};

mod atomic;
mod cleanup;
mod commit;
#[cfg(test)]
mod commit_tests;
mod context;
mod discard;
mod frame;
mod ruby;
mod ruby_text;
mod source;
mod text;
mod transform;

use atomic::{AtomicNodeKind, PendingAtomicNode};
use commit::PendingSegmentCommit;
use discard::PendingNodeDiscard;
use frame::{apply_inline_exit, CollectionFrame, InlineExit, NodeFrame, TextSegmentSummary};
use ruby::{PendingRubyFrame, RubyAction};
use text::PendingTextSegment;

#[derive(Debug)]
enum ActiveCollection {
    Text(Box<PendingTextSegment>),
    Atomic(Box<PendingAtomicNode>),
}

/// Owns ordinary inline-tree traversal and never publishes partial segments.
#[derive(Debug)]
pub(crate) struct PendingInlineCandidateCollector {
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
            frames: vec![CollectionFrame::Nodes(NodeFrame::root(nodes, href))],
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
                    require_unit(work)?;
                    let node = self
                        .current_node_frame_mut()
                        .nodes
                        .next()
                        .expect("a paid frame node exists");
                    self.dispatch_node(node);
                }
                Some(CollectionFrame::Ruby(_)) => {
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
                        frame.advance(&mut self.output, output_len, work)?
                    };
                    match action {
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
                            self.frames
                                .push(CollectionFrame::Nodes(NodeFrame::ruby_base(nodes, context)));
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

    fn dispatch_node(&mut self, mut node: StyledNode) {
        match node.node_type {
            StyledNodeKind::Text => {
                self.discard_children(&mut node);
                let context = match self.frames.last() {
                    Some(CollectionFrame::Nodes(frame)) => &frame.context,
                    Some(CollectionFrame::Ruby(_)) | None => {
                        unreachable!("text dispatch requires a node frame")
                    }
                };
                if let Some(text) = PendingTextSegment::new(node, context, &mut self.whitespace) {
                    self.active = Some(ActiveCollection::Text(Box::new(text)));
                }
            }
            StyledNodeKind::Inline if node.tag.as_deref() == Some("ruby") => {
                let ruby = PendingRubyFrame::new(node, &self.current_node_frame().context);
                self.frames.push(CollectionFrame::Ruby(ruby));
            }
            StyledNodeKind::Inline => self.push_inline_frame(node),
            StyledNodeKind::Image => {
                self.discard_children(&mut node);
                let frame = self.current_node_frame();
                let context = frame.context.clone();
                let image_sizes_enabled = frame.image_sizes_enabled;
                self.active = Some(ActiveCollection::Atomic(Box::new(PendingAtomicNode {
                    kind: AtomicNodeKind::Image,
                    node,
                    context,
                    image_sizes_enabled,
                })));
            }
            StyledNodeKind::Block
                if string_style(&node.style, "display").as_deref() == Some("inline-block") =>
            {
                self.discard_children(&mut node);
                let frame = self.current_node_frame();
                self.active = Some(ActiveCollection::Atomic(Box::new(PendingAtomicNode {
                    kind: AtomicNodeKind::InlineBlock,
                    node,
                    context: frame.context.clone(),
                    image_sizes_enabled: frame.image_sizes_enabled,
                })));
            }
            StyledNodeKind::Block => self.discard_children(&mut node),
        }
    }

    fn discard_children(&mut self, node: &mut StyledNode) {
        if node.children.is_empty() {
            return;
        }
        debug_assert!(self.discard.is_none());
        self.discard = Some(PendingNodeDiscard::new(std::mem::take(&mut node.children)));
    }

    fn push_inline_frame(&mut self, mut node: StyledNode) {
        let inherited = self.current_node_frame();
        let image_sizes_enabled = inherited.image_sizes_enabled;
        let (context, has_own_borders) = inherited.context.child(&node);
        let exit = InlineExit {
            has_own_borders,
            margin_left: number_style(&node.style, "marginLeft").unwrap_or(0.0),
            margin_right: number_style(&node.style, "marginRight").unwrap_or(0.0),
        };
        self.frames.push(CollectionFrame::Nodes(NodeFrame {
            nodes: std::mem::take(&mut node.children).into_iter(),
            context,
            summary: TextSegmentSummary::default(),
            exit: Some(exit),
            image_sizes_enabled,
        }));
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
