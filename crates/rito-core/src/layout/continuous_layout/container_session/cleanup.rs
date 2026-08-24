use super::ContinuousContainerLayoutSession;
use crate::layout::{
    cleanup::PendingStyledNodeDrop, content::PendingRuntimeBlockCleanup,
    pagination_session::ContinuousLayoutSession,
};

/// Container-local state. Its descendant must be handed back to the one outer
/// session driver before this value is released.
#[derive(Debug)]
pub(in crate::layout::continuous_layout) struct PendingContinuousContainerCleanup {
    pending_tail: Option<super::ContinuousBlock>,
    tail: Option<PendingRuntimeBlockCleanup>,
    node: Option<PendingStyledNodeDrop>,
    child: Option<Box<ContinuousLayoutSession>>,
    descendant: Option<ContinuousLayoutSession>,
    shell: Option<ContainerSessionShell>,
    stage: ContainerCleanupStage,
}

#[derive(Debug)]
struct ContainerSessionShell {
    padding_bottom: f64,
    total_indent: f64,
    collapsed_margin_bottom: f64,
    borrowed_parent_list_ctx: bool,
    saw_first_block: bool,
    last_block_bottom: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContainerCleanupStage {
    TailSource,
    Tail,
    Node,
    ChildHandoff,
    Owner,
    Complete,
}

impl PendingContinuousContainerCleanup {
    pub(in crate::layout::continuous_layout) fn new(
        owner: Box<ContinuousContainerLayoutSession>,
    ) -> Self {
        let ContinuousContainerLayoutSession {
            node,
            padding_bottom,
            total_indent,
            collapsed_margin_bottom,
            child,
            borrowed_parent_list_ctx,
            pending_tail,
            saw_first_block,
            last_block_bottom,
        } = *owner;
        Self {
            pending_tail,
            tail: None,
            node: Some(PendingStyledNodeDrop::from_node(node)),
            child: Some(child),
            descendant: None,
            shell: Some(ContainerSessionShell {
                padding_bottom,
                total_indent,
                collapsed_margin_bottom,
                borrowed_parent_list_ctx,
                saw_first_block,
                last_block_bottom,
            }),
            stage: ContainerCleanupStage::TailSource,
        }
    }

    pub(in crate::layout::continuous_layout) fn is_complete(&self) -> bool {
        self.stage == ContainerCleanupStage::Complete
    }

    pub(in crate::layout::continuous_layout) fn advance_one(&mut self) -> bool {
        loop {
            match self.stage {
                ContainerCleanupStage::TailSource => return self.start_tail(),
                ContainerCleanupStage::Tail => return self.advance_tail(),
                ContainerCleanupStage::Node => {
                    let node = self.node.as_mut().expect("node cleanup exists");
                    if node.is_complete() {
                        self.node = None;
                        self.stage = ContainerCleanupStage::ChildHandoff;
                        continue;
                    }
                    return node.advance_one();
                }
                ContainerCleanupStage::ChildHandoff => return self.handoff_child(),
                ContainerCleanupStage::Owner => return self.release_owner(),
                ContainerCleanupStage::Complete => return false,
            }
        }
    }

    pub(in crate::layout::continuous_layout) fn take_descendant(
        &mut self,
    ) -> Option<ContinuousLayoutSession> {
        debug_assert!(self.is_complete());
        self.descendant.take()
    }

    fn start_tail(&mut self) -> bool {
        if let Some(tail) = self.pending_tail.take() {
            self.tail = Some(PendingRuntimeBlockCleanup::new(tail));
            self.stage = ContainerCleanupStage::Tail;
        } else {
            self.stage = ContainerCleanupStage::Node;
        }
        true
    }

    fn advance_tail(&mut self) -> bool {
        let tail = self.tail.as_mut().expect("tail cleanup exists");
        if tail.is_complete() {
            self.tail = None;
            self.stage = ContainerCleanupStage::Node;
            return true;
        }
        let advanced = tail.advance_one();
        debug_assert!(advanced, "incomplete tail cleanup has work");
        true
    }

    fn handoff_child(&mut self) -> bool {
        let child = self.child.take().expect("container cleanup owns its child");
        self.descendant = Some(*child);
        self.stage = ContainerCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("container shell exists");
        let ContainerSessionShell {
            padding_bottom,
            total_indent,
            collapsed_margin_bottom,
            borrowed_parent_list_ctx,
            saw_first_block,
            last_block_bottom,
        } = shell;
        let _ = (
            padding_bottom,
            total_indent,
            collapsed_margin_bottom,
            borrowed_parent_list_ctx,
            saw_first_block,
            last_block_bottom,
        );
        self.stage = ContainerCleanupStage::Complete;
        true
    }
}
