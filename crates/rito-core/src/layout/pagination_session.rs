use std::{collections::VecDeque, num::NonZeroUsize};

use super::{
    continuous_layout::{flush_anonymous_inline_run, ContinuousBlock, ContinuousLayoutCursor},
    image_size::ImageSizeIndex,
    text_measure::TextMeasurementFonts,
    LineBreaking,
};
use crate::style::{StyledNode, StyledNodeKind};

/// A deterministic upper bound on the number of top-level layout nodes that
/// one session advance may start.
///
/// A node itself is currently atomic. In particular, this budget does not
/// interrupt line layout inside a single large paragraph.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LayoutWorkBudget {
    max_top_level_nodes: NonZeroUsize,
}

impl LayoutWorkBudget {
    pub(crate) const fn new(max_top_level_nodes: NonZeroUsize) -> Self {
        Self {
            max_top_level_nodes,
        }
    }

    pub(super) const fn max_top_level_nodes(self) -> usize {
        self.max_top_level_nodes.get()
    }

    pub(super) const fn unbounded() -> Self {
        Self::new(NonZeroUsize::MAX)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LayoutAdvanceStatus {
    Partial,
    Complete,
}

/// Opaque deterministic progress for an incomplete in-memory layout session.
///
/// The session owns the actual resumable state (floats, collapsed margins,
/// list counters, and the pending nodes). This value deliberately exposes no
/// mutable cursor and is suitable for comparing or reporting progress only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LayoutContinuationState {
    completed_top_level_nodes: usize,
    total_top_level_nodes: usize,
}

impl LayoutContinuationState {
    pub(super) const fn new(
        completed_top_level_nodes: usize,
        total_top_level_nodes: usize,
    ) -> Self {
        Self {
            completed_top_level_nodes,
            total_top_level_nodes,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
#[must_use]
pub(crate) struct LayoutSessionAdvance<Output> {
    pub(crate) status: LayoutAdvanceStatus,
    pub(crate) continuation: Option<LayoutContinuationState>,
    pub(crate) processed_top_level_nodes: usize,
    pub(crate) output: Output,
}

impl<Output> LayoutSessionAdvance<Output> {
    pub(super) const fn new(
        status: LayoutAdvanceStatus,
        continuation: Option<LayoutContinuationState>,
        processed_top_level_nodes: usize,
        output: Output,
    ) -> Self {
        Self {
            status,
            continuation,
            processed_top_level_nodes,
            output,
        }
    }
}

/// Resumable continuous block generation for one chapter.
///
/// The session owns its source nodes and image index, so a runtime document can
/// store it without a self-reference. Cross-node layout state stays in the
/// cursor and fonts are injected only for the duration of each advance.
/// Consecutive top-level inline nodes are buffered until their anonymous-block
/// boundary is known. A single block node, including a large paragraph, is
/// deliberately atomic.
#[derive(Debug)]
pub(crate) struct ContinuousLayoutSession {
    pending_nodes: VecDeque<StyledNode>,
    anonymous_inline_run: Vec<StyledNode>,
    cursor: ContinuousLayoutCursor,
    content_width: f64,
    content_height: f64,
    image_sizes: ImageSizeIndex,
    line_breaking: LineBreaking,
    total_top_level_nodes: usize,
}

impl ContinuousLayoutSession {
    pub(crate) fn new(
        nodes: Vec<StyledNode>,
        content_width: f64,
        content_height: f64,
        image_sizes: ImageSizeIndex,
        line_breaking: LineBreaking,
    ) -> Self {
        let pending_nodes = VecDeque::from(nodes);
        Self {
            total_top_level_nodes: pending_nodes.len(),
            pending_nodes,
            anonymous_inline_run: Vec::new(),
            cursor: ContinuousLayoutCursor::default(),
            content_width,
            content_height,
            image_sizes,
            line_breaking,
        }
    }

    pub(crate) fn advance<'fonts>(
        &mut self,
        budget: LayoutWorkBudget,
        fonts: &'fonts TextMeasurementFonts<'fonts>,
    ) -> LayoutSessionAdvance<Vec<ContinuousBlock>> {
        let before = self.pending_nodes.len();
        let ready_nodes = self.take_ready_nodes(budget);
        let processed_top_level_nodes = before - self.pending_nodes.len();
        let output = self.cursor.layout_nodes(
            &ready_nodes,
            self.content_width,
            self.content_height,
            &self.image_sizes,
            self.line_breaking,
            fonts,
        );

        let status = if self.pending_nodes.is_empty() {
            LayoutAdvanceStatus::Complete
        } else {
            LayoutAdvanceStatus::Partial
        };
        let completed_top_level_nodes = self.total_top_level_nodes - self.pending_nodes.len();
        let continuation = (status == LayoutAdvanceStatus::Partial).then_some(
            LayoutContinuationState::new(completed_top_level_nodes, self.total_top_level_nodes),
        );
        LayoutSessionAdvance::new(status, continuation, processed_top_level_nodes, output)
    }

    fn take_ready_nodes(&mut self, budget: LayoutWorkBudget) -> Vec<StyledNode> {
        let mut ready_nodes = Vec::new();
        for _ in 0..budget.max_top_level_nodes() {
            let Some(node) = self.pending_nodes.pop_front() else {
                break;
            };
            if node.node_type == StyledNodeKind::Block {
                flush_anonymous_inline_run(&mut ready_nodes, &mut self.anonymous_inline_run);
                ready_nodes.push(node);
            } else {
                self.anonymous_inline_run.push(node);
            }
        }
        if self.pending_nodes.is_empty()
            || self
                .pending_nodes
                .front()
                .is_some_and(|node| node.node_type == StyledNodeKind::Block)
        {
            flush_anonymous_inline_run(&mut ready_nodes, &mut self.anonymous_inline_run);
        }
        ready_nodes
    }
}

#[cfg(test)]
mod tests;
