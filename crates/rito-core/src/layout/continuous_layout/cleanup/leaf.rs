use super::super::{
    ContinuousLeafLayoutSession, ContinuousLeafTextState, HorizontalMetrics, TextBlockMetrics,
};
use crate::layout::{
    cleanup::PendingStyledNodeDrop, content::PendingRuntimeChildVectorCleanup,
    inline_content::PendingInlineCandidateCleanup,
};

#[derive(Debug)]
pub(super) struct PendingContinuousLeafCleanup {
    children: Option<PendingRuntimeChildVectorCleanup>,
    text_source: Option<ContinuousLeafTextState>,
    text: Option<PendingLeafTextCleanup>,
    node: Option<PendingStyledNodeDrop>,
    shell: Option<LeafSessionShell>,
    stage: LeafCleanupStage,
}

#[derive(Debug)]
#[allow(clippy::large_enum_variant)] // Avoid cleanup-only boxing and allocation.
enum PendingLeafTextCleanup {
    Candidate(PendingInlineCandidateCleanup),
    Atomic(ContinuousLeafTextState),
}

#[derive(Debug)]
struct LeafSessionShell {
    container_width: f64,
    block_width: f64,
    y: f64,
    horizontal: HorizontalMetrics,
    extra_left: f64,
    metrics: TextBlockMetrics,
    line_width: f64,
    font_profile_id: u64,
    child_bottom: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LeafCleanupStage {
    Children,
    TextSource,
    Text,
    Node,
    Owner,
    Complete,
}

impl PendingContinuousLeafCleanup {
    pub(super) fn new(owner: Box<ContinuousLeafLayoutSession>) -> Self {
        let ContinuousLeafLayoutSession {
            node,
            container_width,
            block_width,
            y,
            horizontal,
            extra_left,
            metrics,
            line_width,
            font_profile_id,
            text_state,
            completed_children,
            child_bottom,
        } = *owner;
        Self {
            children: Some(PendingRuntimeChildVectorCleanup::new(completed_children)),
            text_source: text_state,
            text: None,
            node: Some(PendingStyledNodeDrop::from_node(node)),
            shell: Some(LeafSessionShell {
                container_width,
                block_width,
                y,
                horizontal,
                extra_left,
                metrics,
                line_width,
                font_profile_id,
                child_bottom,
            }),
            stage: LeafCleanupStage::Children,
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        self.stage == LeafCleanupStage::Complete
    }

    pub(super) fn advance_one(&mut self) -> bool {
        loop {
            match self.stage {
                LeafCleanupStage::Children => {
                    let children = self.children.as_mut().expect("child cleanup exists");
                    if children.is_complete() {
                        self.children = None;
                        self.stage = LeafCleanupStage::TextSource;
                        continue;
                    }
                    return children.advance_one();
                }
                LeafCleanupStage::TextSource => return self.start_text(),
                LeafCleanupStage::Text => return self.advance_text(),
                LeafCleanupStage::Node => {
                    let node = self.node.as_mut().expect("node cleanup exists");
                    if node.is_complete() {
                        self.node = None;
                        self.stage = LeafCleanupStage::Owner;
                        continue;
                    }
                    return node.advance_one();
                }
                LeafCleanupStage::Owner => return self.release_owner(),
                LeafCleanupStage::Complete => return false,
            }
        }
    }

    fn start_text(&mut self) -> bool {
        if let Some(text) = self.text_source.take() {
            self.text = Some(match text {
                ContinuousLeafTextState::Collecting(collector) => {
                    PendingLeafTextCleanup::Candidate(PendingInlineCandidateCleanup::new(
                        *collector,
                    ))
                }
                atomic => PendingLeafTextCleanup::Atomic(atomic),
            });
            self.stage = LeafCleanupStage::Text;
        } else {
            self.stage = LeafCleanupStage::Node;
        }
        true
    }

    fn advance_text(&mut self) -> bool {
        match self.text.as_mut().expect("text cleanup exists") {
            PendingLeafTextCleanup::Candidate(candidate) => {
                if candidate.is_complete() {
                    self.text = None;
                    self.stage = LeafCleanupStage::Node;
                    return true;
                }
                let advanced = candidate.advance_one();
                debug_assert!(advanced, "incomplete candidate cleanup has work");
                true
            }
            PendingLeafTextCleanup::Atomic(_) => {
                let PendingLeafTextCleanup::Atomic(text) =
                    self.text.take().expect("atomic text cleanup exists")
                else {
                    unreachable!("the checked text cleanup is atomic")
                };
                drop(text);
                self.stage = LeafCleanupStage::Node;
                true
            }
        }
    }

    fn release_owner(&mut self) -> bool {
        let shell = self.shell.take().expect("leaf shell exists");
        let LeafSessionShell {
            container_width,
            block_width,
            y,
            horizontal,
            extra_left,
            metrics,
            line_width,
            font_profile_id,
            child_bottom,
        } = shell;
        let _ = (
            container_width,
            block_width,
            y,
            horizontal,
            extra_left,
            metrics,
            line_width,
            font_profile_id,
            child_bottom,
        );
        self.stage = LeafCleanupStage::Complete;
        true
    }
}

#[cfg(test)]
#[path = "leaf/tests.rs"]
mod tests;
