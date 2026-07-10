use serde_json::{Map, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild, RuntimeHorizontalRule},
    continuous_float::ContinuousFloatContext,
    continuous_image::{layout_continuous_image_block, ContinuousImageBlockInput},
    continuous_list::{
        add_continuous_list_marker, create_continuous_list_context, ContinuousListContext,
    },
    continuous_summary::{
        aggregate_continuous_blocks, continuous_block_bottom, summarize_continuous_block,
    },
    continuous_table::layout_continuous_table,
    image_size::ImageSizeIndex,
    inline_content::flatten_inline_content,
    inline_segment::SegmentContext,
    line::{LineBox, LineRun},
    line_metrics::line_height_px,
    line_mode::layout_lines_with_fonts,
    pagination_flow::{paginate_continuous_blocks, PaginationFlowChapter},
    style_values::*,
    summary_json::{hash_json, hash_text, number_value},
    summary_types::ContinuousBlockChapterSummary,
    text_measure::TextMeasurementFonts,
};
use crate::{
    layout::{LayoutConfig, LineBreaking},
    style::{StyledNode, StyledNodeKind},
};

type ContinuousBlock = RuntimeBlock<LineBox>;
type ContinuousChild = RuntimeChild<LineBox>;
type ContinuousHr = RuntimeHorizontalRule;

#[derive(Debug)]
struct ContinuousLayoutState<'a> {
    blocks: Vec<ContinuousBlock>,
    floats: ContinuousFloatContext,
    y: f64,
    previous_margin_bottom: f64,
    text_layout: ContinuousTextLayout<'a>,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct ContinuousTextLayout<'a> {
    pub(super) line_breaking: LineBreaking,
    pub(super) fonts: &'a TextMeasurementFonts<'a>,
}

#[derive(Debug, Clone, Copy)]
struct HorizontalMetrics {
    margin_left: f64,
    margin_right: f64,
    target_width: f64,
}

#[derive(Debug, Clone, Copy)]
struct TextBlockMetrics {
    padding_top: f64,
    padding_bottom: f64,
    padding_left: f64,
    border_top: f64,
    border_bottom: f64,
    border_left: f64,
    inner_width: f64,
}

#[derive(Debug)]
struct FloatSizing {
    margin_top: f64,
    margin_left: f64,
    margin_right: f64,
    margin_bottom: f64,
    side: String,
    layout_width: f64,
}

#[derive(Debug, Clone, Copy)]
struct FloatContainerInsets {
    padding_top: f64,
    padding_right: f64,
    padding_bottom: f64,
    padding_left: f64,
    border_top: f64,
    border_bottom: f64,
    border_left: f64,
    child_width: f64,
    child_start_y: f64,
}

pub(crate) fn summarize_continuous_blocks_for_chapter(
    idref: &str,
    href: &str,
    styled_nodes: &[StyledNode],
    image_sizes: &ImageSizeIndex,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> ContinuousBlockChapterSummary {
    let blocks = layout_continuous_blocks(
        styled_nodes,
        layout_config.content_width(),
        layout_config.content_height(),
        image_sizes,
        line_breaking,
        fonts,
    );
    let summaries = blocks
        .iter()
        .map(summarize_continuous_block)
        .collect::<Vec<_>>();
    let aggregate = aggregate_continuous_blocks(&blocks);
    let max_block_bottom = blocks
        .iter()
        .map(continuous_block_bottom)
        .fold(0.0_f64, f64::max);

    ContinuousBlockChapterSummary {
        idref: idref.to_owned(),
        href: href.to_owned(),
        top_level_block_count: blocks.len(),
        line_count: aggregate.line_count,
        text_run_count: aggregate.text_run_count,
        image_count: aggregate.image_count,
        hr_count: aggregate.hr_count,
        text_hash: hash_text(&aggregate.text),
        max_block_bottom: number_value(max_block_bottom),
        blocks: summaries.clone(),
        samples: summaries.iter().take(8).cloned().collect(),
        detail_hash: hash_json(&Value::Array(summaries)),
    }
}

fn layout_continuous_blocks<'a>(
    nodes: &[StyledNode],
    content_width: f64,
    content_height: f64,
    image_sizes: &ImageSizeIndex,
    line_breaking: LineBreaking,
    fonts: &'a TextMeasurementFonts<'a>,
) -> Vec<ContinuousBlock> {
    let mut list_ctx = None;
    let text_layout = ContinuousTextLayout {
        line_breaking,
        fonts,
    };
    layout_continuous_nodes_at(
        nodes,
        content_width,
        content_height,
        0.0,
        image_sizes,
        text_layout,
        &mut list_ctx,
    )
}

pub(super) fn layout_continuous_nodes_at<'a>(
    nodes: &[StyledNode],
    content_width: f64,
    content_height: f64,
    start_y: f64,
    image_sizes: &ImageSizeIndex,
    text_layout: ContinuousTextLayout<'a>,
    list_ctx: &mut Option<ContinuousListContext>,
) -> Vec<ContinuousBlock> {
    let mut state = ContinuousLayoutState {
        blocks: Vec::new(),
        floats: ContinuousFloatContext::default(),
        y: start_y,
        previous_margin_bottom: 0.0,
        text_layout,
    };

    for node in &wrap_anonymous_inline_runs(nodes) {
        apply_continuous_clearance(&mut state, node);
        layout_continuous_top_level_node(
            &mut state,
            node,
            content_width,
            content_height,
            image_sizes,
            list_ctx,
        );
    }

    state.blocks
}

fn wrap_anonymous_inline_runs(nodes: &[StyledNode]) -> Vec<StyledNode> {
    let mut result = Vec::new();
    let mut run = Vec::new();
    for node in nodes {
        if node.node_type == StyledNodeKind::Block {
            flush_anonymous_inline_run(&mut result, &mut run);
            result.push(node.clone());
        } else {
            run.push(node.clone());
        }
    }
    flush_anonymous_inline_run(&mut result, &mut run);
    result
}

fn flush_anonymous_inline_run(result: &mut Vec<StyledNode>, run: &mut Vec<StyledNode>) {
    if run.is_empty() {
        return;
    }
    let nodes = std::mem::take(run);
    if has_textual_inline_content(&nodes) {
        if contains_only_bare_line_breaks(&nodes) {
            result.extend(nodes.into_iter().filter(|node| {
                node.node_type == StyledNodeKind::Text && node.content.as_deref() == Some("\n")
            }));
        } else if let Some(first) = nodes.first() {
            result.push(StyledNode {
                node_type: StyledNodeKind::Block,
                tag: None,
                content: None,
                source_text: None,
                src: None,
                alt: None,
                id: None,
                href: None,
                colspan: None,
                rowspan: None,
                style: crate::style::inheritable_style(&first.style),
                children: nodes,
                source_ref: None,
            });
        }
    } else {
        result.extend(
            nodes
                .into_iter()
                .filter(|node| node.node_type == StyledNodeKind::Image),
        );
    }
}

fn contains_only_bare_line_breaks(nodes: &[StyledNode]) -> bool {
    let mut has_break = false;
    for node in nodes {
        if node.node_type != StyledNodeKind::Text {
            return false;
        }
        match node.content.as_deref() {
            Some("\n") => has_break = true,
            Some(content) if !content.trim().is_empty() => return false,
            Some(_) | None => {}
        }
    }
    has_break
}

fn has_textual_inline_content(nodes: &[StyledNode]) -> bool {
    nodes.iter().any(|node| match node.node_type {
        StyledNodeKind::Text => node
            .content
            .as_deref()
            .is_some_and(|content| content == "\n" || !content.trim().is_empty()),
        StyledNodeKind::Inline => has_renderable_inline_descendant(&node.children),
        StyledNodeKind::Block | StyledNodeKind::Image => false,
    })
}

fn has_renderable_inline_descendant(nodes: &[StyledNode]) -> bool {
    nodes.iter().any(|node| match node.node_type {
        StyledNodeKind::Image => true,
        StyledNodeKind::Text => node
            .content
            .as_deref()
            .is_some_and(|content| content == "\n" || !content.trim().is_empty()),
        StyledNodeKind::Inline => has_renderable_inline_descendant(&node.children),
        StyledNodeKind::Block => false,
    })
}

fn apply_continuous_clearance(state: &mut ContinuousLayoutState, node: &StyledNode) {
    let clear = string_or_default(&node.style, "clear", "none");
    if clear == "none" {
        return;
    }
    let clear_y = state.floats.clear_y(&clear);
    if clear_y > state.y {
        state.y = clear_y;
    }
    state.floats.clear_expired(state.y);
}

fn layout_continuous_top_level_node(
    state: &mut ContinuousLayoutState,
    node: &StyledNode,
    content_width: f64,
    content_height: f64,
    image_sizes: &ImageSizeIndex,
    list_ctx: &mut Option<ContinuousListContext>,
) {
    match node.node_type {
        StyledNodeKind::Text if node.content.as_deref() == Some("\n") => {
            collapse_continuous_margin(state, 0.0);
            state.y += line_height_px(&node.style);
            state.previous_margin_bottom = 0.0;
        }
        StyledNodeKind::Image if node.src.is_some() => {
            layout_continuous_image_node(state, node, content_width, content_height, image_sizes);
        }
        StyledNodeKind::Block
            if string_or_default(&node.style, "position", "static") != "absolute" =>
        {
            layout_continuous_block_node(
                state,
                node,
                content_width,
                content_height,
                image_sizes,
                list_ctx,
            );
        }
        StyledNodeKind::Text
        | StyledNodeKind::Inline
        | StyledNodeKind::Image
        | StyledNodeKind::Block => {}
    }
}

fn layout_continuous_image_node(
    state: &mut ContinuousLayoutState,
    node: &StyledNode,
    content_width: f64,
    content_height: f64,
    image_sizes: &ImageSizeIndex,
) {
    collapse_continuous_margin(state, resolve_margin_top(&node.style, content_width));
    let block = layout_continuous_image_block(ContinuousImageBlockInput {
        src: node.src.as_deref().unwrap_or_default(),
        content_width,
        content_height,
        y: state.y,
        image_sizes,
        style: &node.style,
        alt: node.alt.clone(),
        href: node.href.clone(),
    });
    let float_side = string_or_default(&node.style, "float", "none");
    if float_side == "left" || float_side == "right" {
        let placed = if float_side == "right" {
            ContinuousBlock {
                x: content_width - block.width,
                ..block
            }
        } else {
            block
        };
        state
            .floats
            .add_float(&float_side, placed.width, state.y, state.y + placed.height);
        state.blocks.push(placed);
        state.previous_margin_bottom = 0.0;
        return;
    }
    state.y += block.height;
    state.blocks.push(block);
    state.previous_margin_bottom = resolve_margin_bottom(&node.style, content_width);
}

fn layout_continuous_block_node(
    state: &mut ContinuousLayoutState,
    node: &StyledNode,
    content_width: f64,
    content_height: f64,
    image_sizes: &ImageSizeIndex,
    list_ctx: &mut Option<ContinuousListContext>,
) {
    if node.tag.as_deref() == Some("hr") {
        place_continuous_hr(state, node, content_width);
    } else if node.tag.as_deref() == Some("table") {
        place_continuous_table(state, node, content_width, content_height, image_sizes);
    } else if string_or_default(&node.style, "float", "none") != "none" {
        layout_continuous_floated_block(
            state,
            node,
            content_width,
            content_height,
            image_sizes,
            list_ctx,
        );
    } else if has_continuous_block_children(node) {
        layout_continuous_container_block(
            state,
            node,
            content_width,
            content_height,
            image_sizes,
            list_ctx,
        );
    } else {
        layout_continuous_leaf_block(state, node, content_width, image_sizes, list_ctx);
    }
}

fn place_continuous_table(
    state: &mut ContinuousLayoutState,
    node: &StyledNode,
    content_width: f64,
    content_height: f64,
    image_sizes: &ImageSizeIndex,
) {
    collapse_continuous_margin(state, resolve_margin_top(&node.style, content_width));
    let metrics = resolve_horizontal_metrics(content_width, &node.style);
    let mut block = layout_continuous_table(
        node,
        metrics.target_width,
        content_height,
        state.y,
        image_sizes,
        state.text_layout,
    );
    let x_offset = resolve_horizontal_offset(
        content_width,
        block.width,
        &node.style,
        metrics.margin_left,
        metrics.margin_right,
        0.0,
    );
    if x_offset > 0.0 {
        block.x += x_offset;
    }
    block.semantic_tag = node.tag.clone();
    block.anchor_id = node.id.clone();
    block.border_box = border_box_from_style(&node.style);
    block.paint = block_paint_from_style(&node.style);
    apply_continuous_page_breaks(&mut block, &node.style);

    state.y += block.height;
    state.blocks.push(block);
    state.previous_margin_bottom = resolve_margin_bottom(&node.style, content_width);
}

fn place_continuous_hr(state: &mut ContinuousLayoutState, node: &StyledNode, content_width: f64) {
    collapse_continuous_margin(state, resolve_margin_top(&node.style, content_width));
    let border = node.style.get("borderTop").unwrap_or(&Value::Null);
    let border_width = border_value_width(border);
    let border_style = border_value_string(border, "style").unwrap_or_else(|| "none".to_owned());
    let use_border = border_width > 0.0 && border_style != "none";
    let color = if use_border {
        border_value_string(border, "color").unwrap_or_else(|| "#000000".to_owned())
    } else {
        string_or_default(&node.style, "color", "#000000")
    };
    let height = if use_border { border_width } else { 1.0 };
    let style = if use_border {
        border_style
    } else {
        "solid".to_owned()
    };

    state.blocks.push(ContinuousBlock {
        x: 0.0,
        y: state.y,
        width: content_width,
        height,
        semantic_tag: None,
        anchor_id: None,
        paint: None,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: vec![ContinuousChild::Hr(ContinuousHr {
            x: 0.0,
            y: 0.0,
            width: content_width,
            height,
            color,
            style,
        })],
    });
    state.y += height;
    state.previous_margin_bottom = resolve_margin_bottom(&node.style, content_width);
}

fn layout_continuous_leaf_block(
    state: &mut ContinuousLayoutState,
    node: &StyledNode,
    content_width: f64,
    image_sizes: &ImageSizeIndex,
    list_ctx: &mut Option<ContinuousListContext>,
) {
    collapse_continuous_margin(state, resolve_margin_top(&node.style, content_width));

    let metrics = resolve_horizontal_metrics(content_width, &node.style);
    let left_float = state.floats.left_width(state.y);
    let right_float = state.floats.right_width(state.y);
    let extra_left = if left_float > 0.0 {
        (left_float - metrics.margin_left).max(0.0)
    } else {
        0.0
    };
    let extra_right = if right_float > 0.0 {
        (right_float - metrics.margin_right).max(0.0)
    } else {
        0.0
    };
    let width = (metrics.target_width - extra_left - extra_right).max(1.0);
    let mut block = layout_continuous_text_block(
        node,
        width,
        state.y,
        image_sizes,
        state.text_layout.line_breaking,
        state.text_layout.fonts,
    );
    add_continuous_list_marker(&mut block, node, list_ctx);
    let x_offset = resolve_horizontal_offset(
        content_width,
        block.width,
        &node.style,
        metrics.margin_left,
        metrics.margin_right,
        extra_left,
    );
    if x_offset != 0.0 {
        block.x += x_offset;
    }
    if let Some(id) = &node.id {
        block.anchor_id = Some(id.clone());
    }
    apply_continuous_page_breaks(&mut block, &node.style);

    state.y += block.height;
    state.blocks.push(block);
    state.previous_margin_bottom = resolve_margin_bottom(&node.style, content_width);
}

fn layout_continuous_text_block(
    node: &StyledNode,
    content_width: f64,
    y: f64,
    image_sizes: &ImageSizeIndex,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> ContinuousBlock {
    let metrics = resolve_text_block_metrics(node, content_width);
    let segments = flatten_inline_content(
        &node.children,
        SegmentContext {
            image_sizes: Some(image_sizes),
            href: node.href.clone(),
            ..SegmentContext::default()
        },
    );
    let line_width = if metrics.inner_width > 0.0 {
        metrics.inner_width
    } else {
        content_width
    };
    let children = layout_lines_with_fonts(&segments, line_width, line_breaking, fonts)
        .into_iter()
        .map(|line| {
            ContinuousChild::Line(line.offset_position(
                metrics.border_left + metrics.padding_left,
                metrics.border_top + metrics.padding_top,
            ))
        })
        .collect::<Vec<_>>();
    let height = resolve_continuous_text_block_height(node, &children, metrics);

    ContinuousBlock {
        x: 0.0,
        y,
        width: content_width,
        height,
        semantic_tag: node.tag.clone(),
        anchor_id: None,
        paint: block_paint_from_style(&node.style),
        border_box: border_box_from_style(&node.style),
        page_break_before: false,
        page_break_after: false,
        orphans: non_default_line_constraint(&node.style, "orphans"),
        widows: non_default_line_constraint(&node.style, "widows"),
        children,
    }
}

fn non_default_line_constraint(style: &Map<String, Value>, key: &str) -> Option<usize> {
    style
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value != 2)
}

fn layout_continuous_container_block(
    state: &mut ContinuousLayoutState,
    node: &StyledNode,
    content_width: f64,
    content_height: f64,
    image_sizes: &ImageSizeIndex,
    list_ctx: &mut Option<ContinuousListContext>,
) {
    let padding_top = resolve_padding_top(&node.style, content_width);
    let padding_right = resolve_padding_right(&node.style, content_width);
    let padding_bottom = resolve_padding_bottom(&node.style, content_width);
    let padding_left = resolve_padding_left(&node.style, content_width);
    let collapsed = collapse_container_margin_top(node, state, padding_top, content_width);
    let container_top = collapsed.start_y - padding_top;

    let metrics = resolve_horizontal_metrics(content_width, &node.style);
    let border_h =
        border_width(&node.style, "borderLeft") + border_width(&node.style, "borderRight");
    let child_width = metrics.target_width - padding_left - padding_right - border_h;
    let mut child_list_ctx = create_continuous_list_context(node);
    let mut child_blocks = if child_list_ctx.is_some() {
        layout_continuous_nodes_at(
            &collapsed.children,
            if child_width > 0.0 {
                child_width
            } else {
                content_width
            },
            content_height,
            collapsed.start_y,
            image_sizes,
            state.text_layout,
            &mut child_list_ctx,
        )
    } else {
        layout_continuous_nodes_at(
            &collapsed.children,
            if child_width > 0.0 {
                child_width
            } else {
                content_width
            },
            content_height,
            collapsed.start_y,
            image_sizes,
            state.text_layout,
            list_ctx,
        )
    };

    if has_visual_decorations(&node.style) {
        localize_wrapper_children(&mut child_blocks, node, container_top, padding_left);
        let mut wrapper = build_continuous_container_wrapper(
            node,
            child_blocks,
            metrics,
            content_width,
            container_top,
            padding_top,
            padding_bottom,
        );
        apply_continuous_page_breaks(&mut wrapper, &node.style);
        state.y = wrapper.y + wrapper.height;
        state.blocks.push(wrapper);
    } else {
        let total_indent = padding_left
            + resolve_horizontal_offset(
                content_width,
                metrics.target_width,
                &node.style,
                metrics.margin_left,
                metrics.margin_right,
                0.0,
            );
        if total_indent != 0.0 {
            indent_continuous_blocks(&mut child_blocks, total_indent);
        }
        apply_page_break_flags_to_blocks(&mut child_blocks, &node.style);
        if let (Some(id), Some(first)) = (&node.id, child_blocks.first_mut()) {
            first.anchor_id = Some(id.clone());
        }
        update_flattened_continuous_state_y(state, &child_blocks, padding_bottom);
        state.blocks.extend(child_blocks);
    }

    state.previous_margin_bottom = resolve_collapsed_container_margin_bottom(node, content_width);
}

fn layout_continuous_floated_block(
    state: &mut ContinuousLayoutState,
    node: &StyledNode,
    content_width: f64,
    content_height: f64,
    image_sizes: &ImageSizeIndex,
    list_ctx: &mut Option<ContinuousListContext>,
) {
    let sizing = resolve_float_sizing(node, content_width);
    let mut block = if has_continuous_block_children(node) {
        layout_continuous_floated_container(
            node,
            sizing.layout_width,
            content_height,
            image_sizes,
            state.text_layout.line_breaking,
            state.text_layout.fonts,
            list_ctx,
        )
    } else {
        layout_continuous_floated_leaf(
            node,
            sizing.layout_width,
            image_sizes,
            state.text_layout.line_breaking,
            state.text_layout.fonts,
            list_ctx,
        )
    };
    if let Some(tag) = &node.tag {
        block.semantic_tag = Some(tag.clone());
    }
    if let Some(id) = &node.id {
        block.anchor_id = Some(id.clone());
    }
    place_continuous_floated_block(state, block, &sizing, content_width);
}

fn resolve_float_sizing(node: &StyledNode, content_width: f64) -> FloatSizing {
    let margin_left = resolve_margin_left(&node.style, content_width);
    let margin_right = resolve_margin_right(&node.style, content_width);
    let available_width = content_width - margin_left - margin_right;
    FloatSizing {
        margin_top: resolve_margin_top(&node.style, content_width),
        margin_left,
        margin_right,
        margin_bottom: resolve_margin_bottom(&node.style, content_width),
        side: string_or_default(&node.style, "float", "left"),
        layout_width: apply_size_constraints(available_width, &node.style, available_width),
    }
}

fn layout_continuous_floated_leaf(
    node: &StyledNode,
    layout_width: f64,
    image_sizes: &ImageSizeIndex,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
    list_ctx: &mut Option<ContinuousListContext>,
) -> ContinuousBlock {
    let mut block = layout_continuous_text_block(
        node,
        layout_width.max(1.0),
        0.0,
        image_sizes,
        line_breaking,
        fonts,
    );
    add_continuous_list_marker(&mut block, node, list_ctx);
    if !has_explicit_width(&node.style) {
        let fit_width = shrink_to_fit_width(
            &block.children,
            number_style(&node.style, "paddingRight").unwrap_or(0.0),
            layout_width,
        );
        if fit_width < layout_width {
            normalize_child_positions(&mut block.children, false);
        }
        block.width = fit_width;
    }
    block
}

fn layout_continuous_floated_container(
    node: &StyledNode,
    layout_width: f64,
    content_height: f64,
    image_sizes: &ImageSizeIndex,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
    list_ctx: &mut Option<ContinuousListContext>,
) -> ContinuousBlock {
    let insets = resolve_float_container_insets(node, layout_width);
    let text_layout = ContinuousTextLayout {
        line_breaking,
        fonts,
    };
    let mut child_list_ctx = create_continuous_list_context(node);
    let mut child_blocks = if child_list_ctx.is_some() {
        layout_continuous_nodes_at(
            &node.children,
            if insets.child_width > 0.0 {
                insets.child_width
            } else {
                layout_width
            },
            content_height,
            insets.child_start_y,
            image_sizes,
            text_layout,
            &mut child_list_ctx,
        )
    } else {
        layout_continuous_nodes_at(
            &node.children,
            if insets.child_width > 0.0 {
                insets.child_width
            } else {
                layout_width
            },
            content_height,
            insets.child_start_y,
            image_sizes,
            text_layout,
            list_ctx,
        )
    };
    let child_indent = insets.border_left + insets.padding_left;
    if child_indent > 0.0 {
        indent_continuous_blocks(&mut child_blocks, child_indent);
    }
    let height = resolve_floated_container_height(node, &child_blocks, insets, layout_width);
    let actual_width = if has_explicit_width(&node.style) {
        layout_width
    } else {
        shrink_to_fit_blocks(&child_blocks, insets.padding_right, layout_width)
    };
    if !has_explicit_width(&node.style) && actual_width < layout_width {
        normalize_block_child_positions(&mut child_blocks);
    }

    ContinuousBlock {
        x: 0.0,
        y: 0.0,
        width: actual_width,
        height,
        semantic_tag: node.tag.clone(),
        anchor_id: node.id.clone(),
        paint: block_paint_from_style(&node.style),
        border_box: border_box_from_style(&node.style),
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: child_blocks
            .into_iter()
            .map(|block| ContinuousChild::Block(Box::new(block)))
            .collect(),
    }
}

fn resolve_float_container_insets(node: &StyledNode, layout_width: f64) -> FloatContainerInsets {
    let padding_top = resolve_padding_top(&node.style, layout_width);
    let padding_right = resolve_padding_right(&node.style, layout_width);
    let padding_bottom = resolve_padding_bottom(&node.style, layout_width);
    let padding_left = resolve_padding_left(&node.style, layout_width);
    let border_top = border_width(&node.style, "borderTop");
    let border_right = border_width(&node.style, "borderRight");
    let border_bottom = border_width(&node.style, "borderBottom");
    let border_left = border_width(&node.style, "borderLeft");
    FloatContainerInsets {
        padding_top,
        padding_right,
        padding_bottom,
        padding_left,
        border_top,
        border_bottom,
        border_left,
        child_width: layout_width - padding_left - padding_right - border_left - border_right,
        child_start_y: border_top + padding_top,
    }
}

fn resolve_floated_container_height(
    node: &StyledNode,
    children: &[ContinuousBlock],
    insets: FloatContainerInsets,
    layout_width: f64,
) -> f64 {
    let trailing_margin_bottom = if insets.padding_bottom > 0.0 || insets.border_bottom > 0.0 {
        0.0
    } else {
        resolve_trailing_float_margin_bottom(&node.children, layout_width)
    };
    let mut height = children
        .last()
        .map(|child| {
            child.y
                + child.height
                + trailing_margin_bottom
                + insets.padding_bottom
                + insets.border_bottom
        })
        .unwrap_or(0.0);
    if positive_style(&node.style, "height").is_some() {
        let border_v = insets.border_top + insets.border_bottom;
        height = if string_or_default(&node.style, "boxSizing", "content-box") == "border-box" {
            positive_style(&node.style, "height").unwrap_or(height)
        } else {
            positive_style(&node.style, "height").unwrap_or(0.0)
                + insets.padding_top
                + insets.padding_bottom
                + border_v
        };
    }
    if let Some(min_height) = positive_style(&node.style, "minHeight") {
        height = height.max(min_height);
    }
    height
}

fn resolve_trailing_float_margin_bottom(children: &[StyledNode], layout_width: f64) -> f64 {
    let Some(child) = children
        .iter()
        .rev()
        .find(|child| is_first_in_flow_node(child))
    else {
        return 0.0;
    };
    let mut margins = vec![resolve_margin_bottom(&child.style, layout_width)];
    if number_style(&child.style, "paddingBottom").unwrap_or(0.0) <= 0.0
        && border_width(&child.style, "borderBottom") <= 0.0
    {
        margins.push(resolve_trailing_float_margin_bottom(
            &child.children,
            layout_width,
        ));
    }
    collapse_margin_chain(&margins)
}

fn place_continuous_floated_block(
    state: &mut ContinuousLayoutState,
    mut block: ContinuousBlock,
    sizing: &FloatSizing,
    content_width: f64,
) {
    let margin_box_start_y = state.y + state.previous_margin_bottom;
    let margin_box_width = block.width + sizing.margin_left + sizing.margin_right;
    let margin_box_height = (sizing.margin_top + block.height + sizing.margin_bottom).max(0.0);
    let place_margin_box_y = find_float_place_y(
        margin_box_start_y,
        &state.floats,
        margin_box_width,
        content_width,
        margin_box_height,
    );
    let place_y = place_margin_box_y + sizing.margin_top;
    let margin_box_bottom_y = place_margin_box_y + margin_box_height;
    let float_x = if sizing.side == "right" {
        content_width
            - block.width
            - sizing.margin_right
            - state
                .floats
                .max_right_width_in_range(place_margin_box_y, margin_box_bottom_y)
    } else {
        sizing.margin_left
            + state
                .floats
                .max_left_width_in_range(place_margin_box_y, margin_box_bottom_y)
    };
    block.x = float_x;
    block.y = place_y;
    state.floats.add_float(
        &sizing.side,
        margin_box_width,
        place_margin_box_y,
        margin_box_bottom_y,
    );
    state.blocks.push(block);
}

fn find_float_place_y(
    start_y: f64,
    floats: &ContinuousFloatContext,
    total_width: f64,
    content_width: f64,
    height: f64,
) -> f64 {
    let mut place_y = start_y;
    loop {
        let bottom_y = place_y + height;
        let used_left = floats.max_left_width_in_range(place_y, bottom_y);
        let used_right = floats.max_right_width_in_range(place_y, bottom_y);
        if used_left + used_right + total_width <= content_width {
            break place_y;
        }
        let next_y = floats.next_clearance(place_y);
        if next_y <= place_y {
            break place_y;
        }
        place_y = next_y;
    }
}

fn resolve_continuous_text_block_height(
    node: &StyledNode,
    children: &[ContinuousChild],
    metrics: TextBlockMetrics,
) -> f64 {
    let child_bottom = children
        .iter()
        .filter_map(|child| match child {
            ContinuousChild::Line(line) => Some(line.y + line.height),
            ContinuousChild::Block(_) | ContinuousChild::Image(_) | ContinuousChild::Hr(_) => None,
        })
        .fold(0.0_f64, f64::max);
    let mut height = child_bottom + metrics.padding_bottom + metrics.border_bottom;
    if positive_style(&node.style, "height").is_some() {
        let border_v = metrics.border_top + metrics.border_bottom;
        height = if string_or_default(&node.style, "boxSizing", "content-box") == "border-box" {
            positive_style(&node.style, "height").unwrap_or(height)
        } else {
            positive_style(&node.style, "height").unwrap_or(0.0)
                + metrics.padding_top
                + metrics.padding_bottom
                + border_v
        };
    }
    if let Some(min_height) = number_style(&node.style, "minHeight") {
        if height < min_height {
            height = min_height;
        }
    }
    if let Some(max_height) = number_style(&node.style, "maxHeight") {
        if height > max_height {
            height = max_height;
        }
    }
    height
}

fn resolve_text_block_metrics(node: &StyledNode, content_width: f64) -> TextBlockMetrics {
    let padding_top = resolve_padding_top(&node.style, content_width);
    let padding_bottom = resolve_padding_bottom(&node.style, content_width);
    let padding_right = resolve_padding_right(&node.style, content_width);
    let padding_left = resolve_padding_left(&node.style, content_width);
    let border_top = border_width(&node.style, "borderTop");
    let border_bottom = border_width(&node.style, "borderBottom");
    let border_left = border_width(&node.style, "borderLeft");
    let border_right = border_width(&node.style, "borderRight");
    TextBlockMetrics {
        padding_top,
        padding_bottom,
        padding_left,
        border_top,
        border_bottom,
        border_left,
        inner_width: content_width - padding_right - padding_left - border_left - border_right,
    }
}

struct CollapsedContainerTop {
    start_y: f64,
    children: Vec<StyledNode>,
}

fn collapse_container_margin_top(
    node: &StyledNode,
    state: &mut ContinuousLayoutState,
    padding_top: f64,
    container_width: f64,
) -> CollapsedContainerTop {
    let has_top_separator = padding_top > 0.0 || border_width(&node.style, "borderTop") > 0.0;
    if has_top_separator {
        collapse_continuous_margin(state, resolve_margin_top(&node.style, container_width));
        return CollapsedContainerTop {
            start_y: state.y + padding_top,
            children: node.children.clone(),
        };
    }

    let mut margins = vec![resolve_margin_top(&node.style, container_width)];
    let children = collect_and_zero_margin_chain(&node.children, &mut margins, container_width);
    collapse_continuous_margin(state, collapse_margin_chain(&margins));
    CollapsedContainerTop {
        start_y: state.y,
        children,
    }
}

fn collect_and_zero_margin_chain(
    children: &[StyledNode],
    margins: &mut Vec<f64>,
    container_width: f64,
) -> Vec<StyledNode> {
    let Some(index) = children.iter().position(is_first_in_flow_node) else {
        return children.to_vec();
    };
    let mut result = children.to_vec();
    let child = &children[index];
    margins.push(resolve_margin_top(&child.style, container_width));
    let mut modified = zero_top_margin(child);
    if number_style(&child.style, "paddingTop").unwrap_or(0.0) <= 0.0
        && border_width(&child.style, "borderTop") <= 0.0
    {
        let nested = collect_and_zero_margin_chain(&modified.children, margins, container_width);
        modified.children = nested;
    }
    result[index] = modified;
    result
}

fn zero_top_margin(child: &StyledNode) -> StyledNode {
    let mut modified = child.clone();
    modified
        .style
        .insert("marginTop".to_owned(), number_value(0.0));
    modified.style.remove("marginTopPct");
    modified
}

fn resolve_collapsed_container_margin_bottom(node: &StyledNode, container_width: f64) -> f64 {
    if number_style(&node.style, "paddingBottom").unwrap_or(0.0) > 0.0
        || border_width(&node.style, "borderBottom") > 0.0
    {
        return resolve_margin_bottom(&node.style, container_width);
    }

    let mut margins = vec![resolve_margin_bottom(&node.style, container_width)];
    collect_trailing_margin_chain(&node.children, &mut margins, container_width);
    collapse_margin_chain(&margins)
}

fn collect_trailing_margin_chain(
    children: &[StyledNode],
    margins: &mut Vec<f64>,
    container_width: f64,
) {
    let Some(child) = children
        .iter()
        .rev()
        .find(|child| is_first_in_flow_node(child))
    else {
        return;
    };
    margins.push(resolve_margin_bottom(&child.style, container_width));
    if number_style(&child.style, "paddingBottom").unwrap_or(0.0) <= 0.0
        && border_width(&child.style, "borderBottom") <= 0.0
    {
        collect_trailing_margin_chain(&child.children, margins, container_width);
    }
}

fn collapse_margin_chain(margins: &[f64]) -> f64 {
    let mut max_positive = 0.0_f64;
    let mut min_negative = 0.0_f64;
    for margin in margins {
        if *margin > max_positive {
            max_positive = *margin;
        }
        if *margin < min_negative {
            min_negative = *margin;
        }
    }
    max_positive + min_negative
}

fn localize_wrapper_children(
    blocks: &mut [ContinuousBlock],
    node: &StyledNode,
    container_top: f64,
    padding_left: f64,
) {
    let border_top = border_width(&node.style, "borderTop");
    let border_left = border_width(&node.style, "borderLeft");
    for block in blocks {
        block.x += border_left + padding_left;
        block.y = block.y - container_top + border_top;
    }
}

fn build_continuous_container_wrapper(
    node: &StyledNode,
    child_blocks: Vec<ContinuousBlock>,
    metrics: HorizontalMetrics,
    container_width: f64,
    start_y: f64,
    padding_top: f64,
    padding_bottom: f64,
) -> ContinuousBlock {
    let x = resolve_horizontal_offset(
        container_width,
        metrics.target_width,
        &node.style,
        metrics.margin_left,
        metrics.margin_right,
        0.0,
    );
    let height = resolve_wrapper_height(node, &child_blocks, padding_top, padding_bottom);
    ContinuousBlock {
        x,
        y: start_y,
        width: metrics.target_width,
        height,
        semantic_tag: node.tag.clone(),
        anchor_id: node.id.clone(),
        paint: block_paint_from_style(&node.style),
        border_box: border_box_from_style(&node.style),
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: child_blocks
            .into_iter()
            .map(|block| ContinuousChild::Block(Box::new(block)))
            .collect(),
    }
}

fn resolve_wrapper_height(
    node: &StyledNode,
    children: &[ContinuousBlock],
    padding_top: f64,
    padding_bottom: f64,
) -> f64 {
    let border_top = border_width(&node.style, "borderTop");
    let border_bottom = border_width(&node.style, "borderBottom");
    let mut height = children
        .last()
        .map(|child| child.y + child.height + padding_bottom + border_bottom)
        .unwrap_or(padding_bottom + border_top + border_bottom);
    if positive_style(&node.style, "height").is_some() {
        let border_v = border_top + border_bottom;
        height = if string_or_default(&node.style, "boxSizing", "content-box") == "border-box" {
            positive_style(&node.style, "height").unwrap_or(height)
        } else {
            positive_style(&node.style, "height").unwrap_or(0.0)
                + padding_top
                + padding_bottom
                + border_v
        };
    }
    if let Some(min_height) = positive_style(&node.style, "minHeight") {
        height = height.max(min_height);
    }
    height
}

fn update_flattened_continuous_state_y(
    state: &mut ContinuousLayoutState,
    blocks: &[ContinuousBlock],
    padding_bottom: f64,
) {
    if let Some(last) = blocks.last() {
        state.y = last.y + last.height + padding_bottom;
    }
}

fn indent_continuous_blocks(blocks: &mut [ContinuousBlock], indent: f64) {
    for block in blocks {
        block.x += indent;
    }
}

fn apply_page_break_flags_to_blocks(blocks: &mut [ContinuousBlock], style: &Map<String, Value>) {
    if string_style(style, "pageBreakBefore").as_deref() == Some("always") {
        if let Some(first) = blocks.first_mut() {
            first.page_break_before = true;
        }
    }
    if string_style(style, "pageBreakAfter").as_deref() == Some("always") {
        if let Some(last) = blocks.last_mut() {
            last.page_break_after = true;
        }
    }
}

fn apply_continuous_page_breaks(block: &mut ContinuousBlock, style: &Map<String, Value>) {
    if string_style(style, "pageBreakBefore").as_deref() == Some("always") {
        block.page_break_before = true;
    }
    if string_style(style, "pageBreakAfter").as_deref() == Some("always") {
        block.page_break_after = true;
    }
}

fn has_continuous_block_children(node: &StyledNode) -> bool {
    node.children.iter().any(|child| {
        if child.node_type == StyledNodeKind::Block {
            return string_or_default(&child.style, "display", "block") != "inline-block";
        }
        if child.node_type == StyledNodeKind::Image {
            return !has_mixed_inline_content(&node.children);
        }
        false
    })
}

fn has_mixed_inline_content(children: &[StyledNode]) -> bool {
    let mut has_inline = false;
    let mut has_image = false;
    for child in children {
        let non_empty_text = child.node_type == StyledNodeKind::Text
            && child
                .content
                .as_deref()
                .is_some_and(|content| !content.trim().is_empty());
        if non_empty_text || child.node_type == StyledNodeKind::Inline {
            has_inline = true;
        }
        if child.node_type == StyledNodeKind::Image {
            has_image = true;
        }
    }
    has_inline && has_image
}

fn has_visual_decorations(style: &Map<String, Value>) -> bool {
    !string_or_default(style, "backgroundColor", "").is_empty()
        || border_width(style, "borderTop") > 0.0
        || border_width(style, "borderRight") > 0.0
        || border_width(style, "borderBottom") > 0.0
        || border_width(style, "borderLeft") > 0.0
        || number_style(style, "borderRadius").unwrap_or(0.0) > 0.0
        || style.get("borderRadiusPct").is_some()
        || number_style(style, "opacity").unwrap_or(1.0) < 1.0
        || string_style(style, "overflow").as_deref() == Some("hidden")
        || style
            .get("boxShadow")
            .and_then(Value::as_array)
            .is_some_and(|values| !values.is_empty())
        || style
            .get("transform")
            .and_then(Value::as_array)
            .is_some_and(|values| !values.is_empty())
        || style.get("backgroundImage").is_some()
}

fn is_first_in_flow_node(child: &StyledNode) -> bool {
    child.node_type == StyledNodeKind::Block
        && string_or_default(&child.style, "float", "none") == "none"
        && string_or_default(&child.style, "position", "static") != "absolute"
        && string_or_default(&child.style, "display", "block") != "inline-block"
}

fn resolve_horizontal_metrics(
    container_width: f64,
    style: &Map<String, Value>,
) -> HorizontalMetrics {
    let margin_left = resolve_margin_left(style, container_width);
    let margin_right = resolve_margin_right(style, container_width);
    let post_margin_width = container_width - margin_left - margin_right;
    let target_width = apply_size_constraints(post_margin_width, style, container_width);
    HorizontalMetrics {
        margin_left,
        margin_right,
        target_width,
    }
}

fn resolve_horizontal_offset(
    container_width: f64,
    actual_width: f64,
    style: &Map<String, Value>,
    margin_left: f64,
    margin_right: f64,
    base_offset: f64,
) -> f64 {
    let left_auto = bool_style(style, "marginLeftAuto");
    let right_auto = bool_style(style, "marginRightAuto");
    if (left_auto || right_auto) && actual_width < container_width {
        let remaining = container_width - actual_width;
        if left_auto && right_auto {
            return remaining / 2.0;
        }
        if left_auto {
            return remaining - margin_right;
        }
    }
    margin_left + base_offset
}

fn apply_size_constraints(
    available_width: f64,
    style: &Map<String, Value>,
    container_width: f64,
) -> f64 {
    let mut width = available_width;
    let resolved_width = positive_style(style, "width")
        .or_else(|| number_style(style, "widthPct").map(|pct| pct / 100.0 * container_width))
        .unwrap_or(0.0);
    if resolved_width > 0.0 {
        width = to_total_box(resolved_width, style).min(available_width);
    }
    let resolved_max_width = positive_style(style, "maxWidth")
        .or_else(|| number_style(style, "maxWidthPct").map(|pct| pct / 100.0 * container_width))
        .unwrap_or(0.0);
    if resolved_max_width > 0.0 {
        width = width.min(to_total_box(resolved_max_width, style));
    }
    width
}

fn to_total_box(value: f64, style: &Map<String, Value>) -> f64 {
    if string_or_default(style, "boxSizing", "content-box") == "border-box" {
        return value;
    }
    value
        + number_style(style, "paddingLeft").unwrap_or(0.0)
        + number_style(style, "paddingRight").unwrap_or(0.0)
        + border_width(style, "borderLeft")
        + border_width(style, "borderRight")
}

fn collapse_continuous_margin(state: &mut ContinuousLayoutState, margin_top: f64) {
    state.y += compute_collapsed_margin(state.previous_margin_bottom, margin_top);
}

fn compute_collapsed_margin(previous: f64, next: f64) -> f64 {
    if previous >= 0.0 && next >= 0.0 {
        previous.max(next)
    } else if previous < 0.0 && next < 0.0 {
        previous.min(next)
    } else {
        previous + next
    }
}

fn has_explicit_width(style: &Map<String, Value>) -> bool {
    positive_style(style, "width").is_some() || style.get("widthPct").is_some()
}

fn shrink_to_fit_width(children: &[ContinuousChild], padding_right: f64, max_width: f64) -> f64 {
    (measure_continuous_content_right(children) + padding_right).min(max_width)
}

fn shrink_to_fit_blocks(blocks: &[ContinuousBlock], padding_right: f64, max_width: f64) -> f64 {
    let children = blocks
        .iter()
        .cloned()
        .map(|block| ContinuousChild::Block(Box::new(block)))
        .collect::<Vec<_>>();
    shrink_to_fit_width(&children, padding_right, max_width)
}

fn measure_continuous_content_right(children: &[ContinuousChild]) -> f64 {
    let mut max_right = 0.0_f64;
    for child in children {
        match child {
            ContinuousChild::Line(line) => {
                max_right = max_right.max(measure_line_content_width(line));
            }
            ContinuousChild::Block(block) => {
                let nested = measure_continuous_content_right(&block.children);
                let first_line_right = measure_first_line_abs_right(&block.children);
                max_right = max_right
                    .max(block.x + nested)
                    .max(block.x + first_line_right);
            }
            ContinuousChild::Image(image) => {
                max_right = max_right.max(image.width);
            }
            ContinuousChild::Hr(hr) => {
                max_right = max_right.max(hr.x + hr.width);
            }
        }
    }
    max_right
}

fn measure_line_content_width(line: &LineBox) -> f64 {
    let mut min_left = f64::INFINITY;
    let mut max_right = 0.0_f64;
    for run in &line.runs {
        let (x, width) = run.geometry();
        min_left = min_left.min(x);
        max_right = max_right.max(x + width);
    }
    if min_left.is_infinite() {
        0.0
    } else {
        max_right - min_left
    }
}

fn measure_first_line_abs_right(children: &[ContinuousChild]) -> f64 {
    for child in children {
        match child {
            ContinuousChild::Line(line) => return measure_line_abs_right(line),
            ContinuousChild::Block(block) => return measure_first_line_abs_right(&block.children),
            ContinuousChild::Image(_) | ContinuousChild::Hr(_) => {}
        }
    }
    0.0
}

fn measure_line_abs_right(line: &LineBox) -> f64 {
    line.runs
        .iter()
        .map(|run| {
            let (x, width) = run.geometry();
            x + width
        })
        .fold(0.0_f64, f64::max)
}

fn normalize_child_positions(children: &mut [ContinuousChild], preserve_first_line: bool) {
    for (index, child) in children.iter_mut().enumerate() {
        match child {
            ContinuousChild::Line(line) => {
                normalize_line_box(line, preserve_first_line && index == 0);
            }
            ContinuousChild::Block(block) => normalize_child_positions(&mut block.children, true),
            ContinuousChild::Image(image) if image.x > 0.0 => image.x = 0.0,
            ContinuousChild::Image(_) | ContinuousChild::Hr(_) => {}
        }
    }
}

fn normalize_block_child_positions(blocks: &mut [ContinuousBlock]) {
    for block in blocks {
        normalize_child_positions(&mut block.children, true);
    }
}

fn normalize_line_box(line: &mut LineBox, preserve: bool) {
    if preserve {
        return;
    }
    let min_x = line
        .runs
        .iter()
        .map(LineRun::geometry)
        .map(|(x, _)| x)
        .fold(f64::INFINITY, f64::min);
    if min_x <= 0.0 || min_x.is_infinite() {
        return;
    }
    for run in &mut line.runs {
        run.shift_x(-min_x);
    }
}

pub(crate) fn summarize_pagination_flow_for_chapter(
    idref: &str,
    styled_nodes: &[StyledNode],
    page_paint: Option<Value>,
    image_sizes: &ImageSizeIndex,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> PaginationFlowChapter {
    let blocks = layout_continuous_blocks(
        styled_nodes,
        layout_config.content_width(),
        layout_config.content_height(),
        image_sizes,
        line_breaking,
        fonts,
    );
    let pages = paginate_continuous_blocks(blocks.clone(), layout_config, page_paint.clone());

    PaginationFlowChapter {
        idref: idref.to_owned(),
        block_count: blocks.len(),
        pages,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map};

    use super::{
        layout_continuous_text_block, wrap_anonymous_inline_runs, ImageSizeIndex, LineBreaking,
        TextMeasurementFonts,
    };
    use crate::style::{StyledNode, StyledNodeKind};

    #[test]
    fn wraps_inline_siblings_between_blocks_in_anonymous_blocks() {
        let nodes = vec![
            node(StyledNodeKind::Block, vec![]),
            node(
                StyledNodeKind::Inline,
                vec![text_node("anonymous inline text")],
            ),
            node(StyledNodeKind::Block, vec![]),
        ];

        let wrapped = wrap_anonymous_inline_runs(&nodes);

        assert_eq!(wrapped.len(), 3);
        assert_eq!(wrapped[1].node_type, StyledNodeKind::Block);
        assert_eq!(wrapped[1].children, vec![nodes[1].clone()]);
        assert_eq!(wrapped[1].style["fontSize"], json!(16));
        assert_eq!(wrapped[1].style["marginTop"], json!(0));
    }

    #[test]
    fn text_blocks_store_only_non_default_widow_and_orphan_constraints() {
        let images = ImageSizeIndex::new(&[]);
        let fonts = TextMeasurementFonts::empty();
        let mut styled = node(StyledNodeKind::Block, vec![text_node("A short paragraph")]);
        styled.style.insert("orphans".to_owned(), json!(4));
        styled.style.insert("widows".to_owned(), json!(2));

        let block = layout_continuous_text_block(
            &styled,
            320.0,
            0.0,
            &images,
            LineBreaking::Greedy,
            &fonts,
        );

        assert_eq!(block.orphans, Some(4));
        assert_eq!(block.widows, None);

        styled.style.insert("orphans".to_owned(), json!(2));
        styled.style.insert("widows".to_owned(), json!(5));
        let block = layout_continuous_text_block(
            &styled,
            320.0,
            0.0,
            &images,
            LineBreaking::Greedy,
            &fonts,
        );

        assert_eq!(block.orphans, None);
        assert_eq!(block.widows, Some(5));
    }

    fn text_node(content: &str) -> StyledNode {
        let mut text = node(StyledNodeKind::Text, vec![]);
        text.content = Some(content.to_owned());
        text
    }

    fn node(node_type: StyledNodeKind, children: Vec<StyledNode>) -> StyledNode {
        StyledNode {
            node_type,
            tag: None,
            content: None,
            source_text: None,
            src: None,
            alt: None,
            id: None,
            href: None,
            colspan: None,
            rowspan: None,
            style: Map::from_iter([
                ("fontSize".to_owned(), json!(16)),
                ("marginTop".to_owned(), json!(12)),
            ]),
            children,
            source_ref: None,
        }
    }
}
