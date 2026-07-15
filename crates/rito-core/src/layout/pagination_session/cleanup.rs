use std::{
    collections::{vec_deque, VecDeque},
    num::NonZeroUsize,
    sync::Arc,
    vec,
};

use super::ContinuousLayoutSession;
use crate::{
    layout::{
        cleanup::PendingStyledNodeIterDrop,
        continuous_layout::{ContinuousLayoutCursor, PendingContinuousLayoutCursorCleanup},
        image_size::ImageSizeIndex,
        CleanupProgress, LineBreaking,
    },
    style::StyledNode,
};

type PendingDequeNodes = PendingStyledNodeIterDrop<vec_deque::IntoIter<StyledNode>>;
type PendingVectorNodes = PendingStyledNodeIterDrop<vec::IntoIter<StyledNode>>;

/// Releases a continuous-layout session and its unique active-container chain
/// through one linear, budgeted driver.
#[derive(Debug)]
pub(crate) struct PendingContinuousLayoutSessionCleanup {
    owner: Option<ContinuousLayoutSession>,
    layer: Option<PendingSessionLayerCleanup>,
}

impl PendingContinuousLayoutSessionCleanup {
    pub(crate) fn new(owner: ContinuousLayoutSession) -> Self {
        Self {
            owner: Some(owner),
            layer: None,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.owner.is_none()
            && self
                .layer
                .as_ref()
                .is_none_or(PendingSessionLayerCleanup::is_terminal)
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        loop {
            if self
                .layer
                .as_ref()
                .is_some_and(PendingSessionLayerCleanup::is_complete)
            {
                let mut layer = self.layer.take().expect("completed layer exists");
                self.owner = layer.take_descendant();
                continue;
            }
            if let Some(layer) = self.layer.as_mut() {
                return layer.advance_one();
            }
            let Some(owner) = self.owner.take() else {
                return false;
            };
            self.layer = Some(PendingSessionLayerCleanup::after_pending_source(owner));
            return true;
        }
    }

    pub(crate) fn advance(&mut self, budget: NonZeroUsize) -> CleanupProgress {
        let mut consumed_units = 0;
        while consumed_units < budget.get() && self.advance_one() {
            consumed_units += 1;
        }
        let progress = CleanupProgress {
            consumed_units,
            complete: self.is_complete(),
        };
        debug_assert!(progress.complete || progress.consumed_units == budget.get());
        progress
    }

    pub(crate) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }
}

impl Drop for PendingContinuousLayoutSessionCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

#[derive(Debug)]
struct PendingSessionLayerCleanup {
    pending: Option<PendingDequeNodes>,
    ready_source: Option<VecDeque<StyledNode>>,
    ready: Option<PendingDequeNodes>,
    anonymous_source: Option<Vec<StyledNode>>,
    anonymous: Option<PendingVectorNodes>,
    cursor_source: Option<ContinuousLayoutCursor>,
    cursor: Option<PendingContinuousLayoutCursorCleanup>,
    image_sizes: Option<Arc<ImageSizeIndex>>,
    descendant: Option<ContinuousLayoutSession>,
    shell: Option<SessionShell>,
    stage: SessionLayerCleanupStage,
}

#[derive(Debug)]
struct SessionShell {
    content_width: f64,
    content_height: f64,
    line_breaking: LineBreaking,
    total_top_level_nodes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionLayerCleanupStage {
    Pending,
    ReadySource,
    Ready,
    AnonymousSource,
    Anonymous,
    CursorSource,
    Cursor,
    ImageSizes,
    Owner,
    Complete,
}

impl PendingSessionLayerCleanup {
    fn after_pending_source(owner: ContinuousLayoutSession) -> Self {
        let ContinuousLayoutSession {
            pending_nodes,
            ready_nodes,
            anonymous_inline_run,
            cursor,
            content_width,
            content_height,
            image_sizes,
            line_breaking,
            total_top_level_nodes,
        } = owner;
        Self {
            pending: Some(PendingStyledNodeIterDrop::new(pending_nodes.into_iter())),
            ready_source: Some(ready_nodes),
            ready: None,
            anonymous_source: Some(anonymous_inline_run),
            anonymous: None,
            cursor_source: Some(cursor),
            cursor: None,
            image_sizes: Some(image_sizes),
            descendant: None,
            shell: Some(SessionShell {
                content_width,
                content_height,
                line_breaking,
                total_top_level_nodes,
            }),
            stage: SessionLayerCleanupStage::Pending,
        }
    }

    fn is_complete(&self) -> bool {
        self.stage == SessionLayerCleanupStage::Complete
    }

    fn is_terminal(&self) -> bool {
        self.is_complete() && self.descendant.is_none()
    }

    fn advance_one(&mut self) -> bool {
        match self.stage {
            SessionLayerCleanupStage::Pending => self.advance_pending(),
            SessionLayerCleanupStage::ReadySource => self.start_ready(),
            SessionLayerCleanupStage::Ready => self.advance_ready(),
            SessionLayerCleanupStage::AnonymousSource => self.start_anonymous(),
            SessionLayerCleanupStage::Anonymous => self.advance_anonymous(),
            SessionLayerCleanupStage::CursorSource => self.start_cursor(),
            SessionLayerCleanupStage::Cursor => self.advance_cursor(),
            SessionLayerCleanupStage::ImageSizes => self.release_image_sizes(),
            SessionLayerCleanupStage::Owner => self.release_owner(),
            SessionLayerCleanupStage::Complete => false,
        }
    }

    fn take_descendant(&mut self) -> Option<ContinuousLayoutSession> {
        debug_assert!(self.is_complete());
        self.descendant.take()
    }

    fn advance_pending(&mut self) -> bool {
        let pending = self.pending.as_mut().expect("pending-node cleanup exists");
        if pending.is_complete() {
            self.pending = None;
            self.stage = SessionLayerCleanupStage::ReadySource;
            return true;
        }
        pending.advance_one()
    }

    fn start_ready(&mut self) -> bool {
        let ready = self.ready_source.take().expect("ready-node source exists");
        self.ready = Some(PendingStyledNodeIterDrop::new(ready.into_iter()));
        self.stage = SessionLayerCleanupStage::Ready;
        true
    }

    fn advance_ready(&mut self) -> bool {
        let ready = self.ready.as_mut().expect("ready-node cleanup exists");
        if ready.is_complete() {
            self.ready = None;
            self.stage = SessionLayerCleanupStage::AnonymousSource;
            return true;
        }
        ready.advance_one()
    }

    fn start_anonymous(&mut self) -> bool {
        let nodes = self
            .anonymous_source
            .take()
            .expect("anonymous-node source exists");
        self.anonymous = Some(PendingStyledNodeIterDrop::new(nodes.into_iter()));
        self.stage = SessionLayerCleanupStage::Anonymous;
        true
    }

    fn advance_anonymous(&mut self) -> bool {
        let nodes = self
            .anonymous
            .as_mut()
            .expect("anonymous-node cleanup exists");
        if nodes.is_complete() {
            self.anonymous = None;
            self.stage = SessionLayerCleanupStage::CursorSource;
            return true;
        }
        nodes.advance_one()
    }

    fn start_cursor(&mut self) -> bool {
        let cursor = self.cursor_source.take().expect("cursor source exists");
        self.cursor = Some(PendingContinuousLayoutCursorCleanup::new(cursor));
        self.stage = SessionLayerCleanupStage::Cursor;
        true
    }

    fn advance_cursor(&mut self) -> bool {
        let cursor = self.cursor.as_mut().expect("cursor cleanup exists");
        if cursor.is_complete() {
            self.descendant = cursor.take_descendant();
            self.cursor = None;
            self.stage = SessionLayerCleanupStage::ImageSizes;
            return true;
        }
        cursor.advance_one()
    }

    fn release_image_sizes(&mut self) -> bool {
        drop(self.image_sizes.take().expect("image-size index exists"));
        self.stage = SessionLayerCleanupStage::Owner;
        true
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("session shell exists");
        let SessionShell {
            content_width,
            content_height,
            line_breaking,
            total_top_level_nodes,
        } = shell;
        let _ = (
            content_width,
            content_height,
            line_breaking,
            total_top_level_nodes,
        );
        self.stage = SessionLayerCleanupStage::Complete;
        true
    }
}

#[cfg(test)]
#[path = "cleanup/tests.rs"]
mod tests;
