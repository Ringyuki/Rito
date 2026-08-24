use crate::{
    layout::style_values::{number_style, string_style},
    style::{StyledNode, StyledNodeKind},
};

use super::{
    atomic::{AtomicNodeKind, PendingAtomicNode},
    discard::PendingNodeDiscard,
    frame::{CollectionFrame, InlineExit, NodeFrame, TextSegmentSummary},
    ruby::PendingRubyFrame,
    text::PendingTextSegment,
    ActiveCollection, PendingInlineCandidateCollector,
};

impl PendingInlineCandidateCollector {
    pub(super) fn dispatch_node(&mut self, mut node: StyledNode) {
        match node.node_type {
            StyledNodeKind::Text => self.dispatch_text(node),
            StyledNodeKind::Inline if node.tag.as_deref() == Some("ruby") => {
                let ruby = PendingRubyFrame::new(node, &self.current_node_frame().context);
                self.push_reserved_frame(CollectionFrame::Ruby(ruby));
            }
            StyledNodeKind::Inline => self.push_inline_frame(node),
            StyledNodeKind::Image => {
                self.discard_children(&mut node);
                let frame = self.current_node_frame();
                self.active = Some(ActiveCollection::Atomic(Box::new(PendingAtomicNode {
                    kind: AtomicNodeKind::Image,
                    node,
                    context: frame.context.clone(),
                    image_sizes_enabled: frame.image_sizes_enabled,
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

    fn dispatch_text(&mut self, mut node: StyledNode) {
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
        self.push_reserved_frame(CollectionFrame::Nodes(NodeFrame {
            nodes: std::mem::take(&mut node.children).into_iter(),
            context,
            summary: TextSegmentSummary::default(),
            exit: Some(exit),
            image_sizes_enabled,
        }));
    }
}
