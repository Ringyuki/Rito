use std::{collections::VecDeque, num::NonZeroUsize};

use super::{
    continuous_layout::{
        flush_anonymous_inline_run, ContinuousBlock, ContinuousLayoutCursor,
        ContinuousNodeLayoutInput,
    },
    image_size::ImageSizeIndex,
    text_measure::TextMeasurementFonts,
    LineBreaking,
};
use crate::style::{StyledNode, StyledNodeKind};

const DEFAULT_MAX_LINE_BOXES_PER_ADVANCE: usize = 32;

/// Deterministic upper bounds for one layout-session advance.
///
/// The public budget controls how many top-level source nodes may be accepted.
/// Greedy leaf paragraphs also stop after a small internal line-box quantum so
/// one large paragraph cannot monopolize a continuation call. Other composite
/// nodes and individual shaping calls remain atomic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LayoutWorkBudget {
    max_top_level_nodes: NonZeroUsize,
    max_line_boxes: NonZeroUsize,
}

impl LayoutWorkBudget {
    pub(crate) const fn new(max_top_level_nodes: NonZeroUsize) -> Self {
        Self {
            max_top_level_nodes,
            max_line_boxes: NonZeroUsize::new(DEFAULT_MAX_LINE_BOXES_PER_ADVANCE)
                .expect("the default line-box budget is non-zero"),
        }
    }

    #[cfg(test)]
    pub(super) const fn with_max_line_boxes(
        max_top_level_nodes: NonZeroUsize,
        max_line_boxes: NonZeroUsize,
    ) -> Self {
        Self {
            max_top_level_nodes,
            max_line_boxes,
        }
    }

    pub(super) const fn max_top_level_nodes(self) -> usize {
        self.max_top_level_nodes.get()
    }

    pub(super) const fn max_line_boxes(self) -> usize {
        self.max_line_boxes.get()
    }

    pub(super) const fn unbounded() -> Self {
        Self {
            max_top_level_nodes: NonZeroUsize::MAX,
            max_line_boxes: NonZeroUsize::MAX,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LayoutAdvanceStatus {
    Partial,
    Complete,
}

/// Opaque deterministic input progress for an incomplete in-memory layout session.
///
/// The session owns the actual resumable state (floats, collapsed margins,
/// list counters, accepted nodes, and pending nodes). Accepted input may still
/// be queued or active inside a resumable paragraph. This value deliberately
/// exposes no mutable cursor and is suitable for comparing progress only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LayoutContinuationState {
    accepted_top_level_nodes: usize,
    total_top_level_nodes: usize,
}

impl LayoutContinuationState {
    pub(super) const fn new(accepted_top_level_nodes: usize, total_top_level_nodes: usize) -> Self {
        Self {
            accepted_top_level_nodes,
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
/// boundary is known. Greedy leaf paragraphs retain their unfinished line
/// layout in the cursor and publish no block until the paragraph is complete.
#[derive(Debug)]
pub(crate) struct ContinuousLayoutSession {
    pending_nodes: VecDeque<StyledNode>,
    ready_nodes: VecDeque<StyledNode>,
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
            ready_nodes: VecDeque::new(),
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
        let mut remaining_nodes = budget.max_top_level_nodes();
        let mut remaining_node_starts = budget.max_top_level_nodes();
        let mut remaining_lines = budget.max_line_boxes();
        let mut processed_top_level_nodes = 0;
        let mut output = Vec::new();

        loop {
            if !self.cursor.has_active_node() && self.ready_nodes.is_empty() {
                if remaining_nodes == 0 {
                    break;
                }
                let before = self.pending_nodes.len();
                let ready_nodes = self.take_ready_nodes(remaining_nodes);
                let accepted = before - self.pending_nodes.len();
                processed_top_level_nodes += accepted;
                remaining_nodes -= accepted;
                self.ready_nodes.extend(ready_nodes);
                if self.ready_nodes.is_empty() {
                    break;
                }
            }

            let node = if self.cursor.has_active_node() {
                None
            } else {
                if remaining_node_starts == 0 {
                    break;
                }
                remaining_node_starts -= 1;
                Some(self.ready_nodes.pop_front().expect("a ready node exists"))
            };
            let advance = self.cursor.advance_node(
                node,
                ContinuousNodeLayoutInput {
                    content_width: self.content_width,
                    content_height: self.content_height,
                    image_sizes: &self.image_sizes,
                    line_breaking: self.line_breaking,
                    fonts,
                    max_line_boxes: remaining_lines,
                },
            );
            remaining_lines = remaining_lines.saturating_sub(advance.processed_line_boxes);
            output.extend(advance.output);
            if !advance.complete || remaining_lines == 0 {
                break;
            }
            if self.pending_nodes.is_empty()
                && self.ready_nodes.is_empty()
                && !self.cursor.has_active_node()
            {
                break;
            }
        }

        let status = if self.pending_nodes.is_empty()
            && self.ready_nodes.is_empty()
            && !self.cursor.has_active_node()
        {
            LayoutAdvanceStatus::Complete
        } else {
            LayoutAdvanceStatus::Partial
        };
        let accepted_top_level_nodes = self.total_top_level_nodes - self.pending_nodes.len();
        let continuation = (status == LayoutAdvanceStatus::Partial).then_some(
            LayoutContinuationState::new(accepted_top_level_nodes, self.total_top_level_nodes),
        );
        LayoutSessionAdvance::new(status, continuation, processed_top_level_nodes, output)
    }

    fn take_ready_nodes(&mut self, max_top_level_nodes: usize) -> Vec<StyledNode> {
        let mut ready_nodes = Vec::new();
        for _ in 0..max_top_level_nodes {
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
