use std::sync::Arc;

use super::{reset_whitespace_after_atom, InlineSegment, WhitespaceCollapseState};
use crate::{
    layout::{
        image_size::ImageSizeIndex,
        inline_atoms::{create_owned_image_atom, create_owned_inline_block_atom},
        inline_ruby::collect_ruby_segments,
        style_values::{number_style, string_style},
        text_work::{AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield},
    },
    style::{StyledNode, StyledNodeKind},
};

mod cleanup;
mod context;
mod discard;
mod frame;
mod source;
mod text;
mod transform;

use context::OwnedInlineContext;
use discard::PendingNodeDiscard;
use frame::{apply_inline_exit, InlineExit, NodeFrame, TextSegmentSummary};
use text::PendingTextSegment;

#[derive(Debug, Clone, Copy)]
enum AtomicNodeKind {
    Image,
    InlineBlock,
    Ruby,
}

#[derive(Debug)]
struct PendingAtomicNode {
    kind: AtomicNodeKind,
    node: StyledNode,
    context: OwnedInlineContext,
}

#[derive(Debug)]
enum ActiveCollection {
    Text(Box<PendingTextSegment>),
    Atomic(Box<PendingAtomicNode>),
    Committing(std::vec::IntoIter<InlineSegment>),
}

/// Owns ordinary inline-tree traversal and never publishes partial segments.
#[derive(Debug)]
pub(crate) struct PendingInlineCandidateCollector {
    frames: Vec<NodeFrame>,
    active: Option<ActiveCollection>,
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
            frames: vec![NodeFrame::root(nodes, href)],
            active: None,
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
            if self
                .frames
                .last()
                .is_some_and(|frame| frame.nodes.as_slice().is_empty())
            {
                if let Some(output) = self.finish_frame(work)? {
                    return Ok(output);
                }
                continue;
            }
            require_unit(work)?;
            let node = self
                .frames
                .last_mut()
                .and_then(|frame| frame.nodes.next())
                .expect("a paid frame node exists");
            self.dispatch_node(node);
        }
    }

    fn advance_active(
        &mut self,
        active: ActiveCollection,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        match active {
            ActiveCollection::Text(mut text) => match text.advance(work) {
                Ok(true) => self.active = Some(committing(InlineSegment::Text((*text).finish()))),
                Ok(false) => self.active = Some(ActiveCollection::Text(text)),
                Err(error) => {
                    self.active = Some(ActiveCollection::Text(text));
                    return Err(error);
                }
            },
            ActiveCollection::Atomic(atomic) => self.advance_atomic(atomic, work)?,
            ActiveCollection::Committing(mut segments) => {
                if segments.as_slice().is_empty() {
                    return Ok(());
                }
                if let Err(error) = require_unit(work) {
                    self.active = Some(ActiveCollection::Committing(segments));
                    return Err(error);
                }
                let segment = segments.next().expect("a paid segment exists");
                self.commit_segment(segment);
                if !segments.as_slice().is_empty() {
                    self.active = Some(ActiveCollection::Committing(segments));
                }
            }
        }
        Ok(())
    }

    fn advance_atomic(
        &mut self,
        atomic: Box<PendingAtomicNode>,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if matches!(
            work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
            TextWorkPermitResult::Yield
        ) {
            self.active = Some(ActiveCollection::Atomic(atomic));
            return Err(TextWorkYield);
        }
        let PendingAtomicNode {
            kind,
            node,
            context,
        } = *atomic;
        let mut segments = Vec::new();
        match kind {
            AtomicNodeKind::Image => {
                let atom = create_owned_image_atom(node, self.image_sizes.as_deref());
                segments.push(InlineSegment::Atom(context.finish_image_atom(atom)));
                reset_whitespace_after_atom(&mut self.whitespace);
            }
            AtomicNodeKind::InlineBlock => {
                segments.push(InlineSegment::Atom(create_owned_inline_block_atom(node)));
                reset_whitespace_after_atom(&mut self.whitespace);
            }
            // Ruby retains the legacy recursive collector as one explicitly
            // paid atomic residual until ruby extraction itself is resumable.
            AtomicNodeKind::Ruby => {
                let borrowed = context.as_borrowed(self.image_sizes.as_deref());
                collect_ruby_segments(&node, &mut segments, &borrowed, &mut self.whitespace);
            }
        }
        self.active = Some(ActiveCollection::Committing(segments.into_iter()));
        Ok(())
    }

    fn dispatch_node(&mut self, mut node: StyledNode) {
        match node.node_type {
            StyledNodeKind::Text => {
                self.discard_children(&mut node);
                let context = &self.frames.last().expect("a dispatch frame exists").context;
                if let Some(text) = PendingTextSegment::new(node, context, &mut self.whitespace) {
                    self.active = Some(ActiveCollection::Text(Box::new(text)));
                }
            }
            StyledNodeKind::Inline if node.tag.as_deref() == Some("ruby") => {
                let context = self.current_context().clone();
                self.active = Some(ActiveCollection::Atomic(Box::new(PendingAtomicNode {
                    kind: AtomicNodeKind::Ruby,
                    node,
                    context,
                })));
            }
            StyledNodeKind::Inline => self.push_inline_frame(node),
            StyledNodeKind::Image => {
                self.discard_children(&mut node);
                let context = self.current_context().clone();
                self.active = Some(ActiveCollection::Atomic(Box::new(PendingAtomicNode {
                    kind: AtomicNodeKind::Image,
                    node,
                    context,
                })));
            }
            StyledNodeKind::Block
                if string_style(&node.style, "display").as_deref() == Some("inline-block") =>
            {
                self.discard_children(&mut node);
                let context = self.current_context().clone();
                self.active = Some(ActiveCollection::Atomic(Box::new(PendingAtomicNode {
                    kind: AtomicNodeKind::InlineBlock,
                    node,
                    context,
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
        let (context, has_own_borders) = self.current_context().child(&node);
        let exit = InlineExit {
            has_own_borders,
            margin_left: number_style(&node.style, "marginLeft").unwrap_or(0.0),
            margin_right: number_style(&node.style, "marginRight").unwrap_or(0.0),
        };
        self.frames.push(NodeFrame {
            nodes: std::mem::take(&mut node.children).into_iter(),
            context,
            summary: TextSegmentSummary::default(),
            exit: Some(exit),
        });
    }

    fn current_context(&self) -> &OwnedInlineContext {
        &self
            .frames
            .last()
            .expect("a collection frame exists")
            .context
    }

    fn finish_frame(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<Option<Vec<InlineSegment>>, TextWorkYield> {
        require_unit(work)?;
        let frame = self.frames.pop().expect("a finished frame exists");
        if let Some(exit) = frame.exit {
            apply_inline_exit(&mut self.output, &frame.summary, exit);
        }
        if let Some(parent) = self.frames.last_mut() {
            parent.summary.merge(&frame.summary);
            Ok(None)
        } else {
            Ok(Some(std::mem::take(&mut self.output)))
        }
    }

    fn commit_segment(&mut self, segment: InlineSegment) {
        let is_text = !segment.is_atom();
        let index = self.output.len();
        self.output.push(segment);
        if is_text {
            self.frames
                .last_mut()
                .expect("segments commit inside a frame")
                .summary
                .include(index);
        }
    }
}

fn committing(segment: InlineSegment) -> ActiveCollection {
    ActiveCollection::Committing(vec![segment].into_iter())
}

pub(super) fn require_unit(work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
    (work.take_utf16_units(1) == 1)
        .then_some(())
        .ok_or(TextWorkYield)
}
