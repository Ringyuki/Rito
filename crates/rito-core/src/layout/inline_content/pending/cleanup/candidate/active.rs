use crate::layout::inline_content::pending::{atomic::PendingAtomicNode, ActiveCollection};
use crate::{
    layout::inline_content::pending::{atomic::AtomicNodeKind, context::OwnedInlineContext},
    style::StyledNode,
};

use super::super::PendingStyledNodeDrop;

#[derive(Debug)]
#[allow(clippy::large_enum_variant)] // Fixed-size cleanup ownership avoids a cancellation allocation.
pub(super) enum PendingActiveCollectionCleanup {
    Text(Option<Box<super::super::super::text::PendingTextSegment>>),
    Atomic(PendingAtomicNodeCleanup),
}

impl PendingActiveCollectionCleanup {
    pub(super) fn new(active: ActiveCollection) -> Self {
        match active {
            ActiveCollection::Text(text) => Self::Text(Some(text)),
            ActiveCollection::Atomic(atomic) => Self::Atomic(PendingAtomicNodeCleanup::new(atomic)),
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        match self {
            Self::Text(text) => text.is_none(),
            Self::Atomic(cleanup) => cleanup.is_complete(),
        }
    }

    pub(super) fn advance_one(&mut self) -> bool {
        match self {
            Self::Text(text) => {
                let Some(text) = text.take() else {
                    return false;
                };
                drop(text);
                true
            }
            Self::Atomic(cleanup) => cleanup.advance_one(),
        }
    }
}

#[derive(Debug)]
pub(super) struct PendingAtomicNodeCleanup {
    node_owner: Option<StyledNode>,
    context: Option<OwnedInlineContext>,
    kind: Option<AtomicNodeKind>,
    image_sizes_enabled: Option<bool>,
    stage: AtomicCleanupStage,
    node: Option<PendingStyledNodeDrop>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AtomicCleanupStage {
    NodeSource,
    Node,
    Context,
    Kind,
    ImageSizesEnabled,
    Owner,
    Complete,
}

impl PendingAtomicNodeCleanup {
    fn new(owner: Box<PendingAtomicNode>) -> Self {
        let PendingAtomicNode {
            kind,
            node,
            context,
            image_sizes_enabled,
        } = *owner;
        Self {
            node_owner: Some(node),
            context: Some(context),
            kind: Some(kind),
            image_sizes_enabled: Some(image_sizes_enabled),
            stage: AtomicCleanupStage::NodeSource,
            node: None,
        }
    }

    fn is_complete(&self) -> bool {
        self.stage == AtomicCleanupStage::Complete
    }

    fn advance_one(&mut self) -> bool {
        match self.stage {
            AtomicCleanupStage::NodeSource => self.activate_node(),
            AtomicCleanupStage::Node => self.advance_node(),
            AtomicCleanupStage::Context => self.release_context(),
            AtomicCleanupStage::Kind => self.release_kind(),
            AtomicCleanupStage::ImageSizesEnabled => self.release_image_flag(),
            AtomicCleanupStage::Owner => self.release_owner(),
            AtomicCleanupStage::Complete => return false,
        }
        true
    }

    fn activate_node(&mut self) {
        let node = self
            .node_owner
            .take()
            .expect("an atomic cleanup owns its node");
        self.node = Some(PendingStyledNodeDrop::from_node(node));
        self.stage = AtomicCleanupStage::Node;
    }

    fn advance_node(&mut self) {
        let node = self.node.as_mut().expect("atomic node cleanup exists");
        if node.is_complete() {
            self.node = None;
            self.stage = AtomicCleanupStage::Context;
        } else {
            assert!(node.advance_one(), "atomic node cleanup must advance");
        }
    }

    fn release_context(&mut self) {
        let context = self.context.take();
        self.stage = AtomicCleanupStage::Kind;
        drop(context);
    }

    fn release_kind(&mut self) {
        let kind = self.kind.take();
        self.stage = AtomicCleanupStage::ImageSizesEnabled;
        let _ = kind;
    }

    fn release_image_flag(&mut self) {
        let image_sizes_enabled = self.image_sizes_enabled.take();
        self.stage = AtomicCleanupStage::Owner;
        let _ = image_sizes_enabled;
    }

    fn release_owner(&mut self) {
        debug_assert!(self.node_owner.is_none());
        debug_assert!(self.node.is_none());
        debug_assert!(self.context.is_none());
        debug_assert!(self.kind.is_none());
        debug_assert!(self.image_sizes_enabled.is_none());
        self.stage = AtomicCleanupStage::Complete;
    }
}

impl Drop for PendingAtomicNodeCleanup {
    fn drop(&mut self) {
        while self.advance_one() {}
    }
}
