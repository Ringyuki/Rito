use super::{
    container_session::PendingContinuousContainerCleanup, ContinuousActiveLayout,
    ContinuousLayoutCursor,
};
use crate::layout::{
    continuous_float::ContinuousFloatContext, continuous_list::ContinuousListContext,
    pagination_session::ContinuousLayoutSession,
};

mod leaf;

use leaf::PendingContinuousLeafCleanup;

/// Cursor-local cleanup state. The outer session cleanup is its sole driver
/// and must take any descendant before releasing this value.
#[derive(Debug)]
pub(in crate::layout) struct PendingContinuousLayoutCursorCleanup {
    active_source: Option<ContinuousActiveLayout>,
    active: Option<PendingActiveLayoutCleanup>,
    floats: Option<ContinuousFloatContext>,
    list_ctx: Option<ContinuousListContext>,
    descendant: Option<ContinuousLayoutSession>,
    shell: Option<CursorShell>,
    stage: CursorCleanupStage,
}

#[derive(Debug)]
#[allow(clippy::large_enum_variant)] // Avoid cleanup-only boxing and allocation.
enum PendingActiveLayoutCleanup {
    Leaf(PendingContinuousLeafCleanup),
    Container(PendingContinuousContainerCleanup),
}

#[derive(Debug)]
struct CursorShell {
    y: f64,
    previous_margin_bottom: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CursorCleanupStage {
    ActiveSource,
    Active,
    Floats,
    ListContext,
    Owner,
    Complete,
}

impl PendingContinuousLayoutCursorCleanup {
    pub(in crate::layout) fn new(owner: ContinuousLayoutCursor) -> Self {
        let ContinuousLayoutCursor {
            floats,
            y,
            previous_margin_bottom,
            list_ctx,
            active,
        } = owner;
        Self {
            active_source: active,
            active: None,
            floats: Some(floats),
            list_ctx,
            descendant: None,
            shell: Some(CursorShell {
                y,
                previous_margin_bottom,
            }),
            stage: CursorCleanupStage::ActiveSource,
        }
    }

    pub(in crate::layout) fn is_complete(&self) -> bool {
        self.stage == CursorCleanupStage::Complete
    }

    pub(in crate::layout) fn advance_one(&mut self) -> bool {
        match self.stage {
            CursorCleanupStage::ActiveSource => self.start_active(),
            CursorCleanupStage::Active => self.advance_active(),
            CursorCleanupStage::Floats => self.release_floats(),
            CursorCleanupStage::ListContext => self.release_list_context(),
            CursorCleanupStage::Owner => self.release_owner(),
            CursorCleanupStage::Complete => false,
        }
    }

    pub(in crate::layout) fn take_descendant(&mut self) -> Option<ContinuousLayoutSession> {
        debug_assert!(self.is_complete());
        self.descendant.take()
    }

    fn start_active(&mut self) -> bool {
        if let Some(active) = self.active_source.take() {
            self.active = Some(match active {
                ContinuousActiveLayout::Leaf(leaf) => {
                    PendingActiveLayoutCleanup::Leaf(PendingContinuousLeafCleanup::new(leaf))
                }
                ContinuousActiveLayout::Container(container) => {
                    PendingActiveLayoutCleanup::Container(PendingContinuousContainerCleanup::new(
                        container,
                    ))
                }
            });
            self.stage = CursorCleanupStage::Active;
        } else {
            self.stage = CursorCleanupStage::Floats;
        }
        true
    }

    fn advance_active(&mut self) -> bool {
        let active = self.active.as_mut().expect("active cleanup exists");
        let complete = match active {
            PendingActiveLayoutCleanup::Leaf(leaf) => leaf.is_complete(),
            PendingActiveLayoutCleanup::Container(container) => container.is_complete(),
        };
        if complete {
            if let PendingActiveLayoutCleanup::Container(container) = active {
                self.descendant = container.take_descendant();
            }
            self.active = None;
            self.stage = CursorCleanupStage::Floats;
            return true;
        }
        match active {
            PendingActiveLayoutCleanup::Leaf(leaf) => leaf.advance_one(),
            PendingActiveLayoutCleanup::Container(container) => container.advance_one(),
        }
    }

    fn release_floats(&mut self) -> bool {
        drop(self.floats.take().expect("float context exists"));
        self.stage = CursorCleanupStage::ListContext;
        true
    }

    fn release_list_context(&mut self) -> bool {
        drop(self.list_ctx.take());
        self.stage = CursorCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("cursor shell exists");
        let CursorShell {
            y,
            previous_margin_bottom,
        } = shell;
        let _ = (y, previous_margin_bottom);
        self.stage = CursorCleanupStage::Complete;
        true
    }
}

#[cfg(test)]
pub(in crate::layout) fn test_container_cursor(
    child: ContinuousLayoutSession,
    pending_tail: Option<super::ContinuousBlock>,
    node: crate::style::StyledNode,
) -> ContinuousLayoutCursor {
    let container = super::container_session::test_container_session(node, child, pending_tail);
    ContinuousLayoutCursor {
        active: Some(ContinuousActiveLayout::Container(Box::new(container))),
        ..ContinuousLayoutCursor::default()
    }
}

#[cfg(test)]
pub(in crate::layout) fn test_empty_leaf_cursor(
    node: crate::style::StyledNode,
) -> ContinuousLayoutCursor {
    let leaf = super::ContinuousLeafLayoutSession {
        node,
        container_width: 100.0,
        block_width: 100.0,
        y: 0.0,
        horizontal: super::HorizontalMetrics {
            margin_left: 0.0,
            margin_right: 0.0,
            target_width: 100.0,
        },
        extra_left: 0.0,
        metrics: super::TextBlockMetrics {
            padding_top: 0.0,
            padding_bottom: 0.0,
            padding_left: 0.0,
            border_top: 0.0,
            border_bottom: 0.0,
            border_left: 0.0,
            inner_width: 100.0,
        },
        line_width: 100.0,
        font_profile_id: 0,
        text_state: None,
        completed_children: Vec::new(),
        child_bottom: 0.0,
    };
    ContinuousLayoutCursor {
        active: Some(ContinuousActiveLayout::Leaf(Box::new(leaf))),
        ..ContinuousLayoutCursor::default()
    }
}
