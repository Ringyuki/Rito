use std::num::NonZeroUsize;

use crate::layout::inline_content::pending::{
    frame::{CollectionFrame, NodeFrame},
    ruby::PendingRubyFrameCleanup,
};

use super::super::PendingStyledNodeIterDrop;

#[derive(Debug)]
#[allow(clippy::large_enum_variant)] // Frames move directly into the one active cleanup slot.
pub(super) enum PendingCollectionFrameCleanup {
    Nodes(PendingNodeFrameCleanup),
    Ruby(PendingRubyFrameCleanup),
}

impl PendingCollectionFrameCleanup {
    pub(super) fn new(frame: CollectionFrame) -> Self {
        match frame {
            CollectionFrame::Nodes(frame) => Self::Nodes(PendingNodeFrameCleanup::new(frame)),
            CollectionFrame::Ruby(frame) => Self::Ruby(PendingRubyFrameCleanup::new(frame)),
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        match self {
            Self::Nodes(cleanup) => cleanup.is_complete(),
            Self::Ruby(cleanup) => cleanup.is_complete(),
        }
    }

    pub(super) fn advance_one(&mut self) -> bool {
        match self {
            Self::Nodes(cleanup) => cleanup.advance_one(),
            Self::Ruby(cleanup) => cleanup.advance_one(),
        }
    }
}

#[derive(Debug)]
pub(super) struct PendingNodeFrameCleanup {
    frame: Option<NodeFrame>,
    stage: NodeFrameCleanupStage,
    nodes: Option<PendingStyledNodeIterDrop>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NodeFrameCleanupStage {
    NodesSource,
    Nodes,
    Context,
    Summary,
    Exit,
    ImageSizesEnabled,
    Owner,
    Complete,
}

impl PendingNodeFrameCleanup {
    fn new(frame: NodeFrame) -> Self {
        Self {
            frame: Some(frame),
            stage: NodeFrameCleanupStage::NodesSource,
            nodes: None,
        }
    }

    fn is_complete(&self) -> bool {
        self.stage == NodeFrameCleanupStage::Complete
    }

    fn advance_one(&mut self) -> bool {
        match self.stage {
            NodeFrameCleanupStage::NodesSource => self.activate_nodes(),
            NodeFrameCleanupStage::Nodes => self.advance_nodes(),
            NodeFrameCleanupStage::Context => self.release_context(),
            NodeFrameCleanupStage::Summary => self.release_summary(),
            NodeFrameCleanupStage::Exit => self.release_exit(),
            NodeFrameCleanupStage::ImageSizesEnabled => self.release_image_flag(),
            NodeFrameCleanupStage::Owner => self.release_owner(),
            NodeFrameCleanupStage::Complete => return false,
        }
        true
    }

    fn activate_nodes(&mut self) {
        let nodes = std::mem::replace(&mut self.frame_mut().nodes, Vec::new().into_iter());
        self.nodes = Some(PendingStyledNodeIterDrop::new(nodes));
        self.stage = NodeFrameCleanupStage::Nodes;
    }

    fn advance_nodes(&mut self) {
        let nodes = self
            .nodes
            .as_mut()
            .expect("node frame cleanup owns its source");
        if nodes.is_complete() {
            self.nodes = None;
            self.stage = NodeFrameCleanupStage::Context;
        } else {
            assert!(nodes.advance_one(), "node frame cleanup must advance");
        }
    }

    fn release_context(&mut self) {
        let context = std::mem::take(&mut self.frame_mut().context);
        self.stage = NodeFrameCleanupStage::Summary;
        drop(context);
    }

    fn release_summary(&mut self) {
        let _summary = std::mem::take(&mut self.frame_mut().summary);
        self.stage = NodeFrameCleanupStage::Exit;
    }

    fn release_exit(&mut self) {
        let _exit = self.frame_mut().exit.take();
        self.stage = NodeFrameCleanupStage::ImageSizesEnabled;
    }

    fn release_image_flag(&mut self) {
        self.frame_mut().image_sizes_enabled = false;
        self.stage = NodeFrameCleanupStage::Owner;
    }

    fn release_owner(&mut self) {
        let frame = self.frame.take().expect("node cleanup owns its frame");
        debug_assert!(frame.nodes.as_slice().is_empty());
        debug_assert!(frame.exit.is_none());
        self.stage = NodeFrameCleanupStage::Complete;
        drop(frame);
    }

    fn frame_mut(&mut self) -> &mut NodeFrame {
        self.frame.as_mut().expect("node cleanup owns its frame")
    }

    fn drain(&mut self) {
        while !self.is_complete() {
            let mut consumed = 0;
            while consumed < NonZeroUsize::MAX.get() && self.advance_one() {
                consumed += 1;
            }
        }
    }
}

impl Drop for PendingNodeFrameCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}
