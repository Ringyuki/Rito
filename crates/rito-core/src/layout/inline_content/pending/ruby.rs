use std::sync::Arc;

use crate::{
    layout::{
        inline_segment::InlineSegment,
        text_work::{TextWorkMeter, TextWorkYield},
    },
    style::{StyledNode, StyledNodeKind},
};

use super::{
    context::OwnedInlineContext,
    discard::PendingNodeDiscard,
    frame::TextSegmentSummary,
    require_unit,
    ruby_text::{PendingAnnotationApply, PendingRubyAnnotation},
};

#[derive(Debug)]
pub(super) struct PendingRubyFrame {
    children: std::vec::IntoIter<StyledNode>,
    pending_base: Vec<StyledNode>,
    base_context: OwnedInlineContext,
    summary: TextSegmentSummary,
    state: RubyState,
}

#[derive(Debug)]
enum RubyState {
    Scanning,
    Extracting(PendingRubyAnnotation),
    ReadyGroup(RubyGroup),
    WaitingGroup(WaitingGroup),
    Applying(PendingAnnotationApply, AfterGroup),
    Discarding(PendingNodeDiscard),
    Complete,
    Transition,
}

#[derive(Debug)]
struct RubyGroup {
    nodes: Vec<StyledNode>,
    annotation: Option<Arc<String>>,
    after: AfterGroup,
}

#[derive(Debug)]
struct WaitingGroup {
    output_start: usize,
    annotation: Option<Arc<String>>,
    after: AfterGroup,
}

#[derive(Debug)]
enum AfterGroup {
    Continue,
    ReplaceBase(Vec<StyledNode>),
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
            pending_base: Vec::new(),
            base_context: inherited.ruby_base(),
            summary: TextSegmentSummary::default(),
            state: RubyState::Scanning,
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
                RubyState::Scanning => self.advance_scan(work)?,
                RubyState::Extracting(mut extraction) => match extraction.advance(work) {
                    Ok(Some(annotation)) => self.finish_annotation(annotation),
                    Ok(None) => self.state = RubyState::Extracting(extraction),
                    Err(error) => {
                        self.state = RubyState::Extracting(extraction);
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
                RubyState::Discarding(mut discard) => match discard.advance(work) {
                    Ok(true) => self.state = RubyState::Scanning,
                    Ok(false) => self.state = RubyState::Discarding(discard),
                    Err(error) => {
                        self.state = RubyState::Discarding(discard);
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
        output.append(&mut self.pending_base);
        let state = std::mem::replace(&mut self.state, RubyState::Complete);
        drain_state_nodes(state, output);
    }

    fn advance_scan(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        self.state = RubyState::Scanning;
        if self.children.as_slice().is_empty() {
            require_unit(work)?;
            let nodes = std::mem::take(&mut self.pending_base);
            if nodes.is_empty() {
                self.state = RubyState::Complete;
            } else {
                self.prepare_group(nodes, None, AfterGroup::Complete);
            }
            return Ok(());
        }
        require_unit(work)?;
        let node = self
            .children
            .next()
            .expect("a paid direct ruby child exists");
        self.dispatch_child(node);
        Ok(())
    }

    fn dispatch_child(&mut self, mut node: StyledNode) {
        if node.node_type == StyledNodeKind::Text {
            self.pending_base.push(node);
            return;
        }
        if node.node_type != StyledNodeKind::Inline {
            self.discard_children(&mut node);
            return;
        }
        match node.tag.as_deref() {
            Some("rt") => {
                self.state = RubyState::Extracting(PendingRubyAnnotation::new(std::mem::take(
                    &mut node.children,
                )));
            }
            Some("rp") => self.discard_children(&mut node),
            Some("rb") => {
                let replacement = std::mem::take(&mut node.children);
                let nodes = std::mem::take(&mut self.pending_base);
                if nodes.is_empty() {
                    self.pending_base = replacement;
                    self.state = RubyState::Scanning;
                } else {
                    self.prepare_group(nodes, None, AfterGroup::ReplaceBase(replacement));
                }
            }
            _ => self.pending_base.push(node),
        }
    }

    fn discard_children(&mut self, node: &mut StyledNode) {
        let children = std::mem::take(&mut node.children);
        self.state = if children.is_empty() {
            RubyState::Scanning
        } else {
            RubyState::Discarding(PendingNodeDiscard::new(children))
        };
    }

    fn finish_annotation(&mut self, annotation: String) {
        let nodes = std::mem::take(&mut self.pending_base);
        if nodes.is_empty() {
            self.state = RubyState::Scanning;
            return;
        }
        let annotation = (!annotation.is_empty()).then(|| Arc::new(annotation));
        self.prepare_group(nodes, annotation, AfterGroup::Continue);
    }

    fn prepare_group(
        &mut self,
        nodes: Vec<StyledNode>,
        annotation: Option<Arc<String>>,
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
            AfterGroup::Continue => self.state = RubyState::Scanning,
            AfterGroup::ReplaceBase(nodes) => {
                self.pending_base = nodes;
                self.state = RubyState::Scanning;
            }
            AfterGroup::Complete => self.state = RubyState::Complete,
        }
    }
}

fn drain_state_nodes(state: RubyState, output: &mut Vec<StyledNode>) {
    match state {
        RubyState::Extracting(mut extraction) => extraction.drain_nodes_into(output),
        RubyState::ReadyGroup(mut group) => {
            output.append(&mut group.nodes);
            drain_after_nodes(group.after, output);
        }
        RubyState::WaitingGroup(waiting) => drain_after_nodes(waiting.after, output),
        RubyState::Applying(_, after) => drain_after_nodes(after, output),
        RubyState::Discarding(mut discard) => discard.drain_remaining_into(output),
        RubyState::Scanning | RubyState::Complete | RubyState::Transition => {}
    }
}

fn drain_after_nodes(after: AfterGroup, output: &mut Vec<StyledNode>) {
    if let AfterGroup::ReplaceBase(mut nodes) = after {
        output.append(&mut nodes);
    }
}

#[cfg(test)]
#[path = "ruby_tests.rs"]
mod tests;
