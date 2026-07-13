use std::sync::Arc;

use super::{
    collapse_container_margin_top, resolve_collapsed_container_margin_bottom,
    resolve_horizontal_metrics, resolve_horizontal_offset, ContinuousBlock, ContinuousLayoutState,
};
use crate::{
    layout::{
        continuous_list::{create_continuous_list_context, ContinuousListContext},
        image_size::ImageSizeIndex,
        pagination_session::{
            ContinuousLayoutSession, LayoutAdvanceStatus, LayoutSessionScope, LayoutWorkMeter,
        },
        style_values::{
            border_width, resolve_padding_bottom, resolve_padding_left, resolve_padding_right,
            resolve_padding_top, string_style,
        },
        text_measure::TextMeasurementFonts,
    },
    style::StyledNode,
};

#[derive(Debug)]
pub(super) struct ContinuousContainerLayoutSession {
    node: StyledNode,
    padding_bottom: f64,
    total_indent: f64,
    collapsed_margin_bottom: f64,
    child: Box<ContinuousLayoutSession>,
    borrowed_parent_list_ctx: bool,
    pending_tail: Option<ContinuousBlock>,
    saw_first_block: bool,
    last_block_bottom: Option<f64>,
}

#[derive(Debug)]
pub(super) struct ContinuousContainerLayoutAdvance {
    pub(super) complete: bool,
    pub(super) output: Vec<ContinuousBlock>,
}

impl ContinuousContainerLayoutSession {
    pub(super) fn new(
        state: &mut ContinuousLayoutState<'_>,
        mut node: StyledNode,
        content_width: f64,
        content_height: f64,
        image_sizes: &Arc<ImageSizeIndex>,
        parent_list_ctx: &mut Option<ContinuousListContext>,
    ) -> Self {
        let padding_top = resolve_padding_top(&node.style, content_width);
        let padding_right = resolve_padding_right(&node.style, content_width);
        let padding_bottom = resolve_padding_bottom(&node.style, content_width);
        let padding_left = resolve_padding_left(&node.style, content_width);
        let collapsed_margin_bottom =
            resolve_collapsed_container_margin_bottom(&node, content_width);
        let collapsed = collapse_container_margin_top(&node, state, padding_top, content_width);
        let metrics = resolve_horizontal_metrics(content_width, &node.style);
        let border_h =
            border_width(&node.style, "borderLeft") + border_width(&node.style, "borderRight");
        let child_width = metrics.target_width - padding_left - padding_right - border_h;
        let total_indent = padding_left
            + resolve_horizontal_offset(
                content_width,
                metrics.target_width,
                &node.style,
                metrics.margin_left,
                metrics.margin_right,
                0.0,
            );
        let local_list_ctx = create_continuous_list_context(&node);
        let borrowed_parent_list_ctx = local_list_ctx.is_none();
        let child_list_ctx = if borrowed_parent_list_ctx {
            parent_list_ctx.take()
        } else {
            local_list_ctx
        };
        node.children.clear();
        let child = ContinuousLayoutSession::new_descendant(
            collapsed.children,
            if child_width > 0.0 {
                child_width
            } else {
                content_width
            },
            content_height,
            Arc::clone(image_sizes),
            state.text_layout.line_breaking,
            collapsed.start_y,
            child_list_ctx,
        );

        Self {
            node,
            padding_bottom,
            total_indent,
            collapsed_margin_bottom,
            child: Box::new(child),
            borrowed_parent_list_ctx,
            pending_tail: None,
            saw_first_block: false,
            last_block_bottom: None,
        }
    }

    pub(super) fn advance(
        &mut self,
        work: &mut LayoutWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
    ) -> ContinuousContainerLayoutAdvance {
        let child = self
            .child
            .advance_with_meter(work, LayoutSessionScope::Descendant, fonts);
        let complete = child.status == LayoutAdvanceStatus::Complete;
        let mut output = Vec::new();

        for mut block in child.output {
            block.x += self.total_indent;
            if !self.saw_first_block {
                if let Some(id) = &self.node.id {
                    block.anchor_id = Some(id.clone());
                }
                if string_style(&self.node.style, "pageBreakBefore").as_deref() == Some("always") {
                    block.page_break_before = true;
                }
                self.saw_first_block = true;
            }
            self.last_block_bottom = Some(block.y + block.height);
            if let Some(previous) = self.pending_tail.replace(block) {
                output.push(previous);
            }
        }

        if complete {
            if let Some(mut tail) = self.pending_tail.take() {
                if string_style(&self.node.style, "pageBreakAfter").as_deref() == Some("always") {
                    tail.page_break_after = true;
                }
                output.push(tail);
            }
        }

        ContinuousContainerLayoutAdvance { complete, output }
    }

    pub(super) fn finish(
        mut self,
        state: &mut ContinuousLayoutState<'_>,
        parent_list_ctx: &mut Option<ContinuousListContext>,
    ) {
        debug_assert!(self.pending_tail.is_none());
        if self.borrowed_parent_list_ctx {
            *parent_list_ctx = self.child.take_list_context();
        }
        if let Some(last_block_bottom) = self.last_block_bottom {
            state.y = last_block_bottom + self.padding_bottom;
        }
        state.previous_margin_bottom = self.collapsed_margin_bottom;
    }
}
