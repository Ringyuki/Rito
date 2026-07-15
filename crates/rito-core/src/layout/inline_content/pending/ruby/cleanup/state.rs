use super::super::{group::RubyGroupCleanupParts, AfterGroup, RubyState};
use crate::{
    layout::inline_content::pending::{
        cleanup::PendingStyledNodeIterDrop,
        discard::{PendingNodeDiscard, PendingNodeDiscardCleanup},
        ruby_text::{
            PendingAnnotationApply, PendingRubyAnnotation, PendingRubyAnnotationCleanup,
            SharedRubyAnnotation,
        },
    },
    style::StyledNode,
};

#[derive(Debug)]
pub(super) struct PendingRubyStateCleanup {
    stage: RubyStateCleanupStage,
    parts: RubyStateCleanupParts,
    nodes: Option<PendingStyledNodeIterDrop>,
    discard: Option<PendingNodeDiscardCleanup>,
    annotation: Option<PendingRubyAnnotationCleanup>,
    after_nodes: Option<PendingStyledNodeIterDrop>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RubyStateCleanupStage {
    NodesSource,
    Nodes,
    DiscardSource,
    Discard,
    AnnotationSource,
    Annotation,
    SharedAnnotation,
    Apply,
    AfterPayload,
    AfterNodesSource,
    AfterNodes,
    Complete,
}

#[derive(Debug, Default)]
struct RubyStateCleanupParts {
    nodes: Option<Vec<StyledNode>>,
    discard: Option<PendingNodeDiscard>,
    annotation: Option<Box<PendingRubyAnnotation>>,
    shared_annotation: Option<SharedRubyAnnotation>,
    apply: Option<PendingAnnotationApply>,
    after: Option<AfterGroup>,
    after_nodes: Option<Vec<StyledNode>>,
}

impl PendingRubyStateCleanup {
    pub(super) fn new(state: RubyState) -> Self {
        let parts = RubyStateCleanupParts::from_state(state);
        let stage = parts.next_stage();
        Self {
            stage,
            parts,
            nodes: None,
            discard: None,
            annotation: None,
            after_nodes: None,
        }
    }

    pub(super) fn advance_one(&mut self) -> bool {
        match self.stage {
            RubyStateCleanupStage::NodesSource => {
                let nodes = self.parts.nodes.take().expect("ruby state nodes exist");
                self.nodes = Some(PendingStyledNodeIterDrop::new(nodes.into_iter()));
                self.stage = RubyStateCleanupStage::Nodes;
            }
            RubyStateCleanupStage::Nodes => {
                let nodes = self.nodes.as_mut().expect("ruby state node cleanup exists");
                if nodes.is_complete() {
                    self.nodes = None;
                    self.stage = self.parts.next_stage();
                } else {
                    assert!(nodes.advance_one(), "ruby state node cleanup must advance");
                }
            }
            RubyStateCleanupStage::DiscardSource => {
                let discard = self
                    .parts
                    .discard
                    .take()
                    .expect("ruby state discard exists");
                self.discard = Some(PendingNodeDiscardCleanup::new(discard));
                self.stage = RubyStateCleanupStage::Discard;
            }
            RubyStateCleanupStage::Discard => {
                let discard = self
                    .discard
                    .as_mut()
                    .expect("ruby state discard cleanup exists");
                if discard.is_complete() {
                    self.discard = None;
                    self.stage = self.parts.next_stage();
                } else {
                    assert!(
                        discard.advance_one(),
                        "ruby state discard cleanup must advance"
                    );
                }
            }
            RubyStateCleanupStage::AnnotationSource => {
                let annotation = self
                    .parts
                    .annotation
                    .take()
                    .expect("ruby annotation cleanup source exists");
                self.annotation = Some(PendingRubyAnnotationCleanup::new(annotation));
                self.stage = RubyStateCleanupStage::Annotation;
            }
            RubyStateCleanupStage::Annotation => {
                let annotation = self
                    .annotation
                    .as_mut()
                    .expect("ruby annotation cleanup exists");
                if annotation.is_complete() {
                    self.annotation = None;
                    self.stage = self.parts.next_stage();
                } else {
                    assert!(
                        annotation.advance_one(),
                        "ruby annotation cleanup must advance"
                    );
                }
            }
            RubyStateCleanupStage::SharedAnnotation => {
                drop(
                    self.parts
                        .shared_annotation
                        .take()
                        .expect("shared ruby annotation exists"),
                );
                self.stage = self.parts.next_stage();
            }
            RubyStateCleanupStage::Apply => {
                drop(self.parts.apply.take().expect("ruby apply payload exists"));
                self.stage = self.parts.next_stage();
            }
            RubyStateCleanupStage::AfterPayload => {
                match self.parts.after.take().expect("ruby after payload exists") {
                    AfterGroup::NextSeed(nodes) => self.parts.after_nodes = Some(nodes),
                    AfterGroup::Complete => {}
                }
                self.stage = self.parts.next_stage();
            }
            RubyStateCleanupStage::AfterNodesSource => {
                let nodes = self
                    .parts
                    .after_nodes
                    .take()
                    .expect("ruby after nodes exist");
                self.after_nodes = Some(PendingStyledNodeIterDrop::new(nodes.into_iter()));
                self.stage = RubyStateCleanupStage::AfterNodes;
            }
            RubyStateCleanupStage::AfterNodes => {
                let nodes = self
                    .after_nodes
                    .as_mut()
                    .expect("ruby after-node cleanup exists");
                if nodes.is_complete() {
                    self.after_nodes = None;
                    self.stage = self.parts.next_stage();
                } else {
                    assert!(nodes.advance_one(), "ruby after-node cleanup must advance");
                }
            }
            RubyStateCleanupStage::Complete => return false,
        }
        true
    }

    pub(super) fn is_complete(&self) -> bool {
        self.stage == RubyStateCleanupStage::Complete
    }
}

impl RubyStateCleanupParts {
    fn from_state(state: RubyState) -> Self {
        match state {
            RubyState::Planning(mut plan) => Self::from_group(plan.take_cleanup_parts()),
            RubyState::Reserving(mut spec) => Self::from_group(spec.take_cleanup_parts()),
            RubyState::Gathering(mut build) => Self::from_group(build.take_cleanup_parts()),
            RubyState::AtBoundary(mut boundary) => Self::from_group(boundary.take_cleanup_parts()),
            RubyState::Extracting(mut pending) => Self {
                nodes: Some(std::mem::take(&mut pending.nodes)),
                annotation: Some(pending.extraction),
                ..Self::default()
            },
            RubyState::ReadyGroup(mut group) => Self {
                nodes: Some(std::mem::take(&mut group.nodes)),
                shared_annotation: group.annotation.take(),
                after: Some(group.after),
                ..Self::default()
            },
            RubyState::WaitingGroup(mut waiting) => Self {
                shared_annotation: waiting.annotation.take(),
                after: Some(waiting.after),
                ..Self::default()
            },
            RubyState::Applying(apply, after) => Self {
                apply: Some(apply),
                after: Some(after),
                ..Self::default()
            },
            RubyState::Complete | RubyState::Transition => Self::default(),
        }
    }

    fn from_group(parts: RubyGroupCleanupParts) -> Self {
        Self {
            nodes: Some(parts.nodes),
            discard: parts.discard,
            ..Self::default()
        }
    }

    fn next_stage(&self) -> RubyStateCleanupStage {
        if self.nodes.is_some() {
            RubyStateCleanupStage::NodesSource
        } else if self.discard.is_some() {
            RubyStateCleanupStage::DiscardSource
        } else if self.annotation.is_some() {
            RubyStateCleanupStage::AnnotationSource
        } else if self.shared_annotation.is_some() {
            RubyStateCleanupStage::SharedAnnotation
        } else if self.apply.is_some() {
            RubyStateCleanupStage::Apply
        } else if self.after.is_some() {
            RubyStateCleanupStage::AfterPayload
        } else if self.after_nodes.is_some() {
            RubyStateCleanupStage::AfterNodesSource
        } else {
            RubyStateCleanupStage::Complete
        }
    }
}

pub(super) fn drop_state_nodes(state: RubyState) {
    match state {
        RubyState::Planning(mut plan) => plan.drop_owned_nodes(),
        RubyState::Reserving(mut spec) => spec.drop_owned_nodes(),
        RubyState::Gathering(mut build) => build.drop_owned_nodes(),
        RubyState::AtBoundary(mut boundary) => boundary.drop_owned_nodes(),
        RubyState::Extracting(mut pending) => {
            super::super::super::cleanup::drop_styled_node_forest_iteratively(std::mem::take(
                &mut pending.nodes,
            ));
            drop(pending.extraction);
        }
        RubyState::ReadyGroup(mut group) => {
            super::super::super::cleanup::drop_styled_node_forest_iteratively(std::mem::take(
                &mut group.nodes,
            ));
            drop_after_nodes(group.after);
        }
        RubyState::WaitingGroup(waiting) => drop_after_nodes(waiting.after),
        RubyState::Applying(_, after) => drop_after_nodes(after),
        RubyState::Complete | RubyState::Transition => {}
    }
}

fn drop_after_nodes(after: AfterGroup) {
    if let AfterGroup::NextSeed(nodes) = after {
        super::super::super::cleanup::drop_styled_node_forest_iteratively(nodes);
    }
}
