use crate::{
    layout::{
        inline_segment::InlineSegment,
        text_work::{TextWorkMeter, TextWorkYield},
    },
    style::StyledNode,
};

use super::{
    context::OwnedInlineContext,
    frame::TextSegmentSummary,
    require_unit,
    ruby_text::{PendingAnnotationApply, PendingRubyAnnotation, SharedRubyAnnotation},
};
use cleanup::drain_state_nodes;
use group::{
    PendingRubyBoundary, PendingRubyGroupBuild, PendingRubyGroupPlan, RubyGroupBoundaryKind,
    RubyGroupSpec,
};

mod cleanup;
mod group;

#[derive(Debug)]
pub(super) struct PendingRubyFrame {
    children: std::vec::IntoIter<StyledNode>,
    base_context: OwnedInlineContext,
    summary: TextSegmentSummary,
    state: RubyState,
}

#[derive(Debug)]
enum RubyState {
    Planning(PendingRubyGroupPlan),
    Reserving(RubyGroupSpec),
    Gathering(PendingRubyGroupBuild),
    AtBoundary(PendingRubyBoundary),
    Extracting(PendingAnnotatedGroup),
    ReadyGroup(RubyGroup),
    WaitingGroup(WaitingGroup),
    Applying(PendingAnnotationApply, AfterGroup),
    Complete,
    Transition,
}

#[derive(Debug)]
struct PendingAnnotatedGroup {
    nodes: Vec<StyledNode>,
    extraction: Box<PendingRubyAnnotation>,
}

#[derive(Debug)]
struct RubyGroup {
    nodes: Vec<StyledNode>,
    annotation: Option<SharedRubyAnnotation>,
    after: AfterGroup,
}

#[derive(Debug)]
struct WaitingGroup {
    output_start: usize,
    annotation: Option<SharedRubyAnnotation>,
    after: AfterGroup,
}

#[derive(Debug)]
enum AfterGroup {
    NextSeed(Vec<StyledNode>),
    Complete,
}

#[derive(Debug)]
pub(super) enum RubyAction {
    PushBase(Vec<StyledNode>),
    Complete,
}

impl PendingRubyFrame {
    pub(super) fn new(mut node: StyledNode, inherited: &OwnedInlineContext) -> Self {
        Self {
            children: std::mem::take(&mut node.children).into_iter(),
            base_context: inherited.ruby_base(),
            summary: TextSegmentSummary::default(),
            state: RubyState::Planning(PendingRubyGroupPlan::new(Vec::new())),
        }
    }

    pub(super) fn advance(
        &mut self,
        output: &mut [InlineSegment],
        output_len: usize,
        work: &mut TextWorkMeter,
    ) -> Result<RubyAction, TextWorkYield> {
        loop {
            let state = std::mem::replace(&mut self.state, RubyState::Transition);
            match state {
                RubyState::Planning(mut plan) => {
                    let spec = match plan.advance(self.children.as_slice(), work) {
                        Ok(spec) => spec,
                        Err(error) => {
                            self.state = RubyState::Planning(plan);
                            return Err(error);
                        }
                    };
                    self.start_group_build(spec, work)?;
                }
                RubyState::Reserving(spec) => self.start_group_build(spec, work)?,
                RubyState::Gathering(mut build) => match build.advance(&mut self.children, work) {
                    Ok(boundary) => self.state = RubyState::AtBoundary(boundary),
                    Err(error) => {
                        self.state = RubyState::Gathering(build);
                        return Err(error);
                    }
                },
                RubyState::AtBoundary(boundary) => self.advance_boundary(boundary, work)?,
                RubyState::Extracting(mut pending) => match pending.extraction.advance(work) {
                    Ok(annotation) => self.finish_annotation(pending.nodes, annotation),
                    Err(error) => {
                        self.state = RubyState::Extracting(pending);
                        return Err(error);
                    }
                },
                RubyState::ReadyGroup(group) => {
                    if let Err(error) = require_unit(work) {
                        self.state = RubyState::ReadyGroup(group);
                        return Err(error);
                    }
                    let nodes = group.nodes;
                    self.state = RubyState::WaitingGroup(WaitingGroup {
                        output_start: output_len,
                        annotation: group.annotation,
                        after: group.after,
                    });
                    return Ok(RubyAction::PushBase(nodes));
                }
                RubyState::WaitingGroup(waiting) => {
                    self.state = RubyState::WaitingGroup(waiting);
                    unreachable!("a waiting ruby group resumes only after its base frame")
                }
                RubyState::Applying(mut apply, after) => match apply.advance(output, work) {
                    Ok(true) => self.apply_after(after),
                    Ok(false) => self.state = RubyState::Applying(apply, after),
                    Err(error) => {
                        self.state = RubyState::Applying(apply, after);
                        return Err(error);
                    }
                },
                RubyState::Complete => {
                    self.state = RubyState::Complete;
                    return Ok(RubyAction::Complete);
                }
                RubyState::Transition => unreachable!("ruby state transitions are synchronous"),
            }
        }
    }

    pub(super) fn finish_base(&mut self, summary: TextSegmentSummary, output_end: usize) {
        self.summary.merge(&summary);
        let RubyState::WaitingGroup(waiting) =
            std::mem::replace(&mut self.state, RubyState::Transition)
        else {
            unreachable!("only a waiting ruby frame owns a completed base frame")
        };
        if let Some(annotation) = waiting.annotation {
            if waiting.output_start < output_end {
                self.state = RubyState::Applying(
                    PendingAnnotationApply::new(annotation, waiting.output_start, output_end),
                    waiting.after,
                );
                return;
            }
        }
        self.apply_after(waiting.after);
    }

    pub(super) fn base_context(&self) -> &OwnedInlineContext {
        &self.base_context
    }

    pub(super) fn into_summary(self) -> TextSegmentSummary {
        debug_assert!(matches!(self.state, RubyState::Complete));
        self.summary
    }

    pub(super) fn drain_nodes_into(&mut self, output: &mut Vec<StyledNode>) {
        output.extend(self.children.by_ref());
        let state = std::mem::replace(&mut self.state, RubyState::Complete);
        drain_state_nodes(state, output);
    }

    fn start_group_build(
        &mut self,
        spec: RubyGroupSpec,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        match spec.reserve(work) {
            Ok(build) => {
                self.state = RubyState::Gathering(build);
                Ok(())
            }
            Err((spec, error)) => {
                self.state = RubyState::Reserving(spec);
                Err(error)
            }
        }
    }

    fn advance_boundary(
        &mut self,
        boundary: PendingRubyBoundary,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        let mut node = match boundary.consume_node(&mut self.children, work) {
            Ok(node) => node,
            Err(error) => {
                self.state = RubyState::AtBoundary(boundary);
                return Err(error);
            }
        };
        match boundary.kind {
            RubyGroupBoundaryKind::Annotation => {
                let node = node.as_mut().expect("an annotation boundary node exists");
                self.state = RubyState::Extracting(PendingAnnotatedGroup {
                    nodes: boundary.nodes,
                    extraction: Box::new(PendingRubyAnnotation::new(std::mem::take(
                        &mut node.children,
                    ))),
                });
            }
            RubyGroupBoundaryKind::Replacement => {
                let node = node.as_mut().expect("a replacement boundary node exists");
                let seed = std::mem::take(&mut node.children);
                if boundary.nodes.is_empty() {
                    self.state = RubyState::Planning(PendingRubyGroupPlan::new(seed));
                } else {
                    self.prepare_group(boundary.nodes, None, AfterGroup::NextSeed(seed));
                }
            }
            RubyGroupBoundaryKind::End => {
                debug_assert!(node.is_none());
                if boundary.nodes.is_empty() {
                    self.state = RubyState::Complete;
                } else {
                    self.prepare_group(boundary.nodes, None, AfterGroup::Complete);
                }
            }
        }
        Ok(())
    }

    fn finish_annotation(
        &mut self,
        nodes: Vec<StyledNode>,
        annotation: Option<SharedRubyAnnotation>,
    ) {
        if nodes.is_empty() {
            self.state = RubyState::Planning(PendingRubyGroupPlan::new(Vec::new()));
        } else {
            self.prepare_group(nodes, annotation, AfterGroup::NextSeed(Vec::new()));
        }
    }

    fn prepare_group(
        &mut self,
        nodes: Vec<StyledNode>,
        annotation: Option<SharedRubyAnnotation>,
        after: AfterGroup,
    ) {
        self.state = RubyState::ReadyGroup(RubyGroup {
            nodes,
            annotation,
            after,
        });
    }

    fn apply_after(&mut self, after: AfterGroup) {
        match after {
            AfterGroup::NextSeed(seed) => {
                self.state = RubyState::Planning(PendingRubyGroupPlan::new(seed));
            }
            AfterGroup::Complete => self.state = RubyState::Complete,
        }
    }
}

#[cfg(test)]
#[path = "ruby_tests.rs"]
mod tests;
