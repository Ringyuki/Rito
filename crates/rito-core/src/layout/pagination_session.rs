use std::{collections::VecDeque, sync::Arc};

#[allow(dead_code)] // Chapter-session retirement consumes this next.
mod cleanup;
mod image_frontier;
mod work_meter;

#[allow(unused_imports)] // Chapter-session retirement consumes this next.
pub(crate) use cleanup::PendingContinuousLayoutSessionCleanup;
pub(super) use work_meter::LayoutSessionScope;
pub(crate) use work_meter::LayoutWorkBudget;
pub(crate) use work_meter::LayoutWorkMeter;

use super::{
    continuous_layout::{
        flush_anonymous_inline_run, ContinuousBlock, ContinuousLayoutCursor,
        ContinuousNodeLayoutInput,
    },
    continuous_list::ContinuousListContext,
    image_size::ImageSizeIndex,
    text_measure::TextMeasurementFonts,
    LineBreaking,
};
use crate::style::{StyledNode, StyledNodeKind};

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
/// The session owns its source nodes and shares its immutable image index with
/// recursive child sessions, so a runtime document can store it without a
/// self-reference. Cross-node layout state stays in the cursor and fonts are
/// injected only for the duration of each advance.
/// Consecutive top-level inline nodes are buffered until their anonymous-block
/// boundary is known. Greedy leaf paragraphs retain their unfinished line
/// layout in the cursor and publish no block until the paragraph is complete.
/// Ordinary transparent containers recursively reuse this session and retain a
/// private tail block while streaming earlier stable children.
#[derive(Debug)]
pub(crate) struct ContinuousLayoutSession {
    pending_nodes: VecDeque<StyledNode>,
    ready_nodes: VecDeque<StyledNode>,
    anonymous_inline_run: Vec<StyledNode>,
    cursor: ContinuousLayoutCursor,
    content_width: f64,
    content_height: f64,
    image_sizes: Arc<ImageSizeIndex>,
    line_breaking: LineBreaking,
    total_top_level_nodes: usize,
    /// `None` keeps eager callers unchanged. Runtime continuation uses
    /// `Some(0)` as an admission gate: a root node cannot leave `pending_nodes`
    /// until its complete subtree's image dimensions have been supplied.
    prepared_root_image_frontier: Option<usize>,
}

impl ContinuousLayoutSession {
    pub(crate) fn new(
        nodes: Vec<StyledNode>,
        content_width: f64,
        content_height: f64,
        image_sizes: ImageSizeIndex,
        line_breaking: LineBreaking,
    ) -> Self {
        Self::new_with_cursor(
            nodes,
            content_width,
            content_height,
            Arc::new(image_sizes),
            line_breaking,
            ContinuousLayoutCursor::default(),
            None,
        )
    }

    pub(super) fn new_descendant(
        nodes: Vec<StyledNode>,
        content_width: f64,
        content_height: f64,
        image_sizes: Arc<ImageSizeIndex>,
        line_breaking: LineBreaking,
        start_y: f64,
        list_ctx: Option<ContinuousListContext>,
    ) -> Self {
        Self::new_with_cursor(
            nodes,
            content_width,
            content_height,
            image_sizes,
            line_breaking,
            ContinuousLayoutCursor::at(start_y, list_ctx),
            None,
        )
    }

    fn new_with_cursor(
        nodes: Vec<StyledNode>,
        content_width: f64,
        content_height: f64,
        image_sizes: Arc<ImageSizeIndex>,
        line_breaking: LineBreaking,
        cursor: ContinuousLayoutCursor,
        prepared_root_image_frontier: Option<usize>,
    ) -> Self {
        let pending_nodes = VecDeque::from(nodes);
        Self {
            total_top_level_nodes: pending_nodes.len(),
            pending_nodes,
            ready_nodes: VecDeque::new(),
            anonymous_inline_run: Vec::new(),
            cursor,
            content_width,
            content_height,
            image_sizes,
            line_breaking,
            prepared_root_image_frontier,
        }
    }

    pub(crate) fn advance<'fonts>(
        &mut self,
        budget: LayoutWorkBudget,
        fonts: &'fonts TextMeasurementFonts<'fonts>,
    ) -> LayoutSessionAdvance<Vec<ContinuousBlock>> {
        let mut work = LayoutWorkMeter::new(budget);
        self.advance_with_meter(&mut work, LayoutSessionScope::Root, fonts)
    }

    pub(super) fn advance_with_meter<'fonts>(
        &mut self,
        work: &mut LayoutWorkMeter,
        scope: LayoutSessionScope,
        fonts: &'fonts TextMeasurementFonts<'fonts>,
    ) -> LayoutSessionAdvance<Vec<ContinuousBlock>> {
        let mut processed_top_level_nodes = 0;
        let mut output = Vec::new();

        loop {
            if !self.cursor.has_active_node() && self.ready_nodes.is_empty() {
                let accepts_remaining = work.accepts_remaining(scope);
                if accepts_remaining == 0 {
                    break;
                }
                let before = self.pending_nodes.len();
                let ready_nodes = self.take_ready_nodes(accepts_remaining);
                let accepted = before - self.pending_nodes.len();
                work.consume_accepts(scope, accepted);
                if scope == LayoutSessionScope::Root {
                    processed_top_level_nodes += accepted;
                }
                self.ready_nodes.extend(ready_nodes);
                if self.ready_nodes.is_empty() {
                    break;
                }
            }

            let node = if self.cursor.has_active_node() {
                None
            } else {
                if !work.try_start_node(scope) {
                    break;
                }
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
                },
                work,
            );
            output.extend(advance.output);
            if !advance.complete || work.line_boxes_remaining() == 0 {
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

    pub(super) fn take_list_context(&mut self) -> Option<ContinuousListContext> {
        self.cursor.take_list_context()
    }

    fn take_ready_nodes(&mut self, max_top_level_nodes: usize) -> Vec<StyledNode> {
        let max_top_level_nodes = self
            .prepared_root_image_frontier
            .map_or(max_top_level_nodes, |prepared| {
                max_top_level_nodes.min(prepared)
            });
        let before = self.pending_nodes.len();
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
        if let Some(prepared) = self.prepared_root_image_frontier.as_mut() {
            *prepared = prepared.saturating_sub(before - self.pending_nodes.len());
        }
        ready_nodes
    }
}

#[cfg(test)]
mod tests;
