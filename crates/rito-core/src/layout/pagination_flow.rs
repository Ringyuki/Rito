use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild},
    display_list_flow::{summarize_display_list_flow, DisplayListFlowSummary},
    hit_map::{summarize_hit_map_flow, HitMapFlowCounts, HitMapFlowSummary},
    line::{LineBox, LineRun},
    link_map::{summarize_link_map_flow, LinkMapFlowSummary, LinkMapFlowTotals},
    page::{RuntimePage, RuntimePageAccumulator},
    search_flow::{summarize_search_flow, SearchFlowSummary},
    spread_flow::{summarize_spread_flow, SpreadFlowSummary},
    summary_json::{hash_json, hash_text, number_value, rect_value},
    text_position::{
        summarize_text_position_flow, TextPositionFlowSummary, TextPositionFlowTotals,
    },
};
use crate::layout::LayoutConfig;

pub(crate) mod cursor;

use cursor::ContinuousPaginationSession;

type PaginationBlock = RuntimeBlock<LineBox>;
type PaginationChild = RuntimeChild<LineBox>;
type PaginationPage = RuntimePage<PaginationBlock>;
type PaginationState = RuntimePageAccumulator<PaginationBlock>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationFlowSummary {
    pub page_count: usize,
    pub chapter_map: BTreeMap<String, PaginationFlowChapterRange>,
    pub totals: PaginationFlowCounts,
    pub page_digests: Vec<PaginationFlowPageDigest>,
    pub samples: Vec<Value>,
    pub spread_flow: SpreadFlowSummary,
    pub display_list_flow: DisplayListFlowSummary,
    pub hit_map_flow: HitMapFlowSummary,
    pub text_position_flow: TextPositionFlowSummary,
    pub link_map_flow: LinkMapFlowSummary,
    pub search_flow: SearchFlowSummary,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationFlowChapterRange {
    pub start_page: usize,
    pub end_page: usize,
    pub page_count: usize,
    pub block_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationFlowPageDigest {
    pub index: usize,
    pub counts: PaginationFlowCounts,
    pub first_text: String,
    pub last_text: String,
    pub detail_hash: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationFlowCounts {
    pub blocks: usize,
    pub lines: usize,
    pub text_runs: usize,
    pub inline_atoms: usize,
    pub images: usize,
    pub ruby: usize,
    pub hrs: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct PaginationFlowChapter {
    pub(crate) idref: String,
    pub(crate) block_count: usize,
    pub(crate) pages: Vec<PaginationPage>,
}

#[derive(Debug, Clone)]
pub(crate) struct BuiltPaginationFlow {
    pub(crate) summary: PaginationFlowSummary,
    pub(crate) pages: Vec<PaginationPage>,
    pub(crate) chapter_start_pages: BTreeSet<usize>,
}

pub(crate) fn build_pagination_flow(
    chapters: &[PaginationFlowChapter],
    layout_config: &LayoutConfig,
) -> BuiltPaginationFlow {
    let mut chapter_map = BTreeMap::new();
    let mut chapter_ranges = Vec::new();
    let mut pages = Vec::new();
    let mut page_details = Vec::new();
    let mut page_digests = Vec::new();
    let mut totals = PaginationFlowCounts::default();

    for chapter in chapters {
        if chapter.pages.is_empty() {
            continue;
        }
        let start_page = page_details.len();
        for page in &chapter.pages {
            let global_index = page_details.len();
            let mut page = page.clone();
            page.set_index(global_index);
            let detail = summarize_pagination_flow_page(&page);
            let counts = count_value_field(&detail, "counts");
            totals = totals.add(&counts);
            page_digests.push(PaginationFlowPageDigest {
                index: global_index,
                counts,
                first_text: string_value_field(&detail, "firstText"),
                last_text: string_value_field(&detail, "lastText"),
                detail_hash: hash_json(&detail),
            });
            pages.push(page);
            page_details.push(detail);
        }
        let range = PaginationFlowChapterRange {
            start_page,
            end_page: page_details.len() - 1,
            page_count: chapter.pages.len(),
            block_count: chapter.block_count,
        };
        chapter_ranges.push(range.clone());
        chapter_map.insert(chapter.idref.clone(), range);
    }

    let samples = choose_pagination_flow_sample_indices(page_details.len(), &chapter_ranges)
        .into_iter()
        .map(|index| page_details[index].clone())
        .collect();
    let chapter_start_pages = collect_chapter_start_pages(&chapter_ranges);

    let summary = PaginationFlowSummary {
        page_count: page_details.len(),
        chapter_map,
        totals,
        page_digests,
        samples,
        spread_flow: summarize_spread_flow(page_details.len(), &chapter_start_pages, layout_config),
        display_list_flow: summarize_display_list_flow(&pages, &chapter_start_pages, layout_config),
        hit_map_flow: summarize_hit_map_flow(
            &pages,
            choose_pagination_flow_sample_indices(pages.len(), &chapter_ranges),
        ),
        text_position_flow: summarize_text_position_flow(
            &pages,
            choose_pagination_flow_sample_indices(pages.len(), &chapter_ranges),
        ),
        link_map_flow: summarize_link_map_flow(
            &pages,
            choose_pagination_flow_sample_indices(pages.len(), &chapter_ranges),
        ),
        search_flow: summarize_search_flow(&pages),
        full_detail_hash: hash_json(&Value::Array(page_details)),
    };

    BuiltPaginationFlow {
        summary,
        pages,
        chapter_start_pages,
    }
}

pub(crate) fn build_runtime_pagination_flow(
    chapters: &[PaginationFlowChapter],
    layout_config: &LayoutConfig,
) -> BuiltPaginationFlow {
    let mut chapter_map = BTreeMap::new();
    let mut chapter_ranges = Vec::new();
    let mut pages = Vec::new();

    for chapter in chapters {
        if chapter.pages.is_empty() {
            continue;
        }
        let start_page = pages.len();
        for page in &chapter.pages {
            let mut page = page.clone();
            page.set_index(pages.len());
            pages.push(page);
        }
        let range = PaginationFlowChapterRange {
            start_page,
            end_page: pages.len() - 1,
            page_count: chapter.pages.len(),
            block_count: chapter.block_count,
        };
        chapter_ranges.push(range.clone());
        chapter_map.insert(chapter.idref.clone(), range);
    }

    let chapter_start_pages = collect_chapter_start_pages(&chapter_ranges);
    let spread_flow = summarize_spread_flow(pages.len(), &chapter_start_pages, layout_config);
    let summary = runtime_pagination_summary(pages.len(), chapter_map, spread_flow);
    BuiltPaginationFlow {
        summary,
        pages,
        chapter_start_pages,
    }
}

pub(super) fn runtime_pagination_summary(
    page_count: usize,
    chapter_map: BTreeMap<String, PaginationFlowChapterRange>,
    spread_flow: SpreadFlowSummary,
) -> PaginationFlowSummary {
    let spread_count = spread_flow.spread_count;
    PaginationFlowSummary {
        page_count,
        chapter_map,
        totals: PaginationFlowCounts::default(),
        page_digests: Vec::new(),
        samples: Vec::new(),
        spread_flow,
        display_list_flow: DisplayListFlowSummary {
            spread_count,
            spread_digests: Vec::new(),
            samples: Vec::new(),
            full_detail_hash: String::new(),
        },
        hit_map_flow: HitMapFlowSummary {
            page_count,
            totals: HitMapFlowCounts::default(),
            page_digests: Vec::new(),
            samples: Vec::new(),
            full_detail_hash: String::new(),
        },
        text_position_flow: TextPositionFlowSummary {
            page_count,
            totals: TextPositionFlowTotals::default(),
            page_digests: Vec::new(),
            samples: Vec::new(),
            full_detail_hash: String::new(),
        },
        link_map_flow: LinkMapFlowSummary {
            page_count,
            totals: LinkMapFlowTotals::default(),
            page_digests: Vec::new(),
            samples: Vec::new(),
            full_detail_hash: String::new(),
        },
        search_flow: SearchFlowSummary {
            query_count: 0,
            result_count: 0,
            queries: Vec::new(),
            full_detail_hash: String::new(),
        },
        full_detail_hash: String::new(),
    }
}

pub(crate) fn paginate_continuous_blocks(
    blocks: Vec<PaginationBlock>,
    layout_config: &LayoutConfig,
    page_paint: Option<Value>,
) -> Vec<PaginationPage> {
    let mut session = ContinuousPaginationSession::new(layout_config, page_paint);
    let block_count = blocks.len();
    let pushed = session.push_blocks(blocks);
    debug_assert_eq!(pushed.processed_blocks, block_count);
    debug_assert_eq!(
        pushed.newly_sealed_pages.end,
        pushed.snapshot.sealed_pages.len()
    );
    debug_assert!(!pushed.snapshot.finished);
    session.into_pages()
}

fn collect_chapter_start_pages(chapter_ranges: &[PaginationFlowChapterRange]) -> BTreeSet<usize> {
    chapter_ranges
        .iter()
        .map(|range| range.start_page)
        .collect()
}

fn place_pagination_block(
    block: PaginationBlock,
    spacing: f64,
    content_height: f64,
    state: &mut PaginationState,
    layout_config: &LayoutConfig,
) {
    if block.page_break_before && !state.page_blocks.is_empty() {
        state.emit_page();
    }

    let effective_spacing = if !state.page_blocks.is_empty() || !state.has_emitted_pages() {
        spacing
    } else {
        0.0
    };
    let total_needed = state.used_height + effective_spacing + block.height;
    if total_needed <= content_height {
        state.used_height += effective_spacing;
        state
            .page_blocks
            .push(reposition_pagination_block(&block, state.used_height));
        state.used_height += block.height;
        if block.page_break_after {
            state.emit_page();
        }
        return;
    }

    if state.page_blocks.is_empty() {
        place_oversized_pagination_block(block, content_height, state, layout_config);
    } else {
        place_block_on_full_pagination_page(block, spacing, content_height, state, layout_config);
    }
}

fn place_block_on_full_pagination_page(
    block: PaginationBlock,
    spacing: f64,
    content_height: f64,
    state: &mut PaginationState,
    layout_config: &LayoutConfig,
) {
    let remaining = content_height - state.used_height - spacing;
    let split = if remaining > 0.0 {
        try_split_pagination_block(&block, remaining, layout_config)
    } else {
        None
    };
    if let Some(split) = split {
        if split.head.height <= remaining {
            state.used_height += spacing;
            state
                .page_blocks
                .push(reposition_pagination_block(&split.head, state.used_height));
            state.emit_page();
            place_pagination_block(split.tail, 0.0, content_height, state, layout_config);
            return;
        }
    }

    let forced = if remaining > 0.0 {
        force_split_pagination_block(&block, remaining)
    } else {
        None
    };
    if let Some(forced) = forced {
        if forced.head.height <= remaining {
            state.used_height += spacing;
            state
                .page_blocks
                .push(reposition_pagination_block(&forced.head, state.used_height));
            state.emit_page();
            place_pagination_block(forced.tail, 0.0, content_height, state, layout_config);
            return;
        }
    }

    state.emit_page();
    place_pagination_block(block, 0.0, content_height, state, layout_config);
}

fn place_oversized_pagination_block(
    block: PaginationBlock,
    content_height: f64,
    state: &mut PaginationState,
    layout_config: &LayoutConfig,
) {
    if let Some(split) = try_split_pagination_block(&block, content_height, layout_config) {
        if split.head.height <= content_height {
            state
                .page_blocks
                .push(reposition_pagination_block(&split.head, 0.0));
            state.emit_page();
            place_pagination_block(split.tail, 0.0, content_height, state, layout_config);
            return;
        }
    }

    if let Some(forced) = force_split_pagination_block(&block, content_height) {
        state
            .page_blocks
            .push(reposition_pagination_block(&forced.head, 0.0));
        state.emit_page();
        place_pagination_block(forced.tail, 0.0, content_height, state, layout_config);
        return;
    }

    state
        .page_blocks
        .push(reposition_pagination_block(&block, 0.0));
    state.emit_page();
}

#[derive(Debug)]
struct PaginationSplitResult {
    head: PaginationBlock,
    tail: PaginationBlock,
}

const GEOMETRY_EPSILON: f64 = 0.001;

fn try_split_pagination_block(
    block: &PaginationBlock,
    available_height: f64,
    layout_config: &LayoutConfig,
) -> Option<PaginationSplitResult> {
    split_pagination_block(
        block,
        available_height,
        layout_config.pagination_policy.as_ref(),
        false,
    )
}

fn split_pagination_block(
    block: &PaginationBlock,
    available_height: f64,
    policy: Option<&crate::layout::PaginationPolicy>,
    force: bool,
) -> Option<PaginationSplitResult> {
    if let Some(line_boxes) = direct_line_children(block) {
        return split_pagination_line_block(block, &line_boxes, available_height, policy, force);
    }
    split_pagination_composite_block(block, available_height, policy, force)
}

fn split_pagination_line_block(
    block: &PaginationBlock,
    line_boxes: &[LineBox],
    available_height: f64,
    policy: Option<&crate::layout::PaginationPolicy>,
    force: bool,
) -> Option<PaginationSplitResult> {
    let policy_enabled = policy.and_then(|policy| policy.enabled).unwrap_or(true);
    let orphans = resolve_pagination_line_constraint(
        block.orphans,
        policy.and_then(|policy| policy.default_orphans),
        policy_enabled,
    );
    let widows = resolve_pagination_line_constraint(
        block.widows,
        policy.and_then(|policy| policy.default_widows),
        policy_enabled,
    );
    let min_total = orphans.saturating_add(widows);
    let mut split_index = find_pagination_split_index(line_boxes, available_height);

    if !force && line_boxes.len() >= min_total {
        if split_index < orphans {
            split_index = orphans;
        }
        if line_boxes.len() - split_index < widows {
            split_index = line_boxes.len() - widows;
        }
    }

    build_pagination_line_split_result(block, line_boxes, split_index, available_height)
}

fn resolve_pagination_line_constraint(
    block_value: Option<usize>,
    policy_value: Option<u32>,
    policy_enabled: bool,
) -> usize {
    if !policy_enabled {
        return 1;
    }
    block_value
        .or_else(|| policy_value.map(|value| value as usize))
        .unwrap_or(2)
}

fn force_split_pagination_block(
    block: &PaginationBlock,
    available_height: f64,
) -> Option<PaginationSplitResult> {
    split_pagination_block(block, available_height, None, true)
}

fn direct_line_children(block: &PaginationBlock) -> Option<Vec<LineBox>> {
    if block.children.is_empty() {
        return None;
    }
    block
        .children
        .iter()
        .map(|child| match child {
            PaginationChild::Line(line) => Some(line.clone()),
            PaginationChild::Block(_) | PaginationChild::Image(_) | PaginationChild::Hr(_) => None,
        })
        .collect()
}

fn find_pagination_split_index(lines: &[LineBox], available_height: f64) -> usize {
    let mut split_index = 0usize;
    for (index, line) in lines.iter().enumerate() {
        if line.y + line.height > available_height {
            break;
        }
        split_index = index + 1;
    }
    split_index
}

fn build_pagination_line_split_result(
    block: &PaginationBlock,
    lines: &[LineBox],
    split_index: usize,
    available_height: f64,
) -> Option<PaginationSplitResult> {
    if split_index == 0 || split_index >= lines.len() {
        return None;
    }

    let head_content_bottom = compute_pagination_lines_height(&lines[..split_index]);
    let next_line_y = lines
        .get(split_index)
        .map(|line| line.y)
        .unwrap_or(head_content_bottom);
    let split_offset = if head_content_bottom > available_height {
        head_content_bottom
    } else {
        available_height.min(next_line_y)
    };
    let head_lines = lines[..split_index]
        .iter()
        .cloned()
        .map(PaginationChild::Line)
        .collect::<Vec<_>>();
    let tail_lines = reposition_pagination_lines(&lines[split_index..], split_offset)
        .into_iter()
        .map(PaginationChild::Line)
        .collect::<Vec<_>>();
    Some(build_pagination_fragment_result(
        block,
        head_lines,
        tail_lines,
        split_offset,
    ))
}

fn split_pagination_composite_block(
    block: &PaginationBlock,
    available_height: f64,
    policy: Option<&crate::layout::PaginationPolicy>,
    force: bool,
) -> Option<PaginationSplitResult> {
    if block.children.is_empty() || available_height <= 0.0 {
        return None;
    }
    let split_offset = resolve_composite_split_offset(block, available_height, policy, force);
    if split_offset <= 0.0 || split_offset >= block.height {
        return None;
    }
    let (head_children, tail_children) =
        split_composite_children(block, split_offset, policy, force)?;
    if head_children.is_empty() || tail_children.is_empty() {
        return None;
    }
    Some(build_pagination_fragment_result(
        block,
        head_children,
        tail_children,
        split_offset,
    ))
}

fn split_composite_children(
    block: &PaginationBlock,
    split_offset: f64,
    policy: Option<&crate::layout::PaginationPolicy>,
    force: bool,
) -> Option<(Vec<PaginationChild>, Vec<PaginationChild>)> {
    let mut head = Vec::new();
    let mut tail = Vec::new();
    for child in &block.children {
        let (top, height) = pagination_child_vertical_geometry(child);
        if top + height <= split_offset + GEOMETRY_EPSILON {
            head.push(child.clone());
        } else if top >= split_offset - GEOMETRY_EPSILON {
            tail.push(shift_pagination_child_y(child, -split_offset));
        } else {
            split_crossing_pagination_child(
                child,
                top,
                split_offset,
                policy,
                force,
                &mut head,
                &mut tail,
            )?;
        }
    }
    Some((head, tail))
}

fn split_crossing_pagination_child(
    child: &PaginationChild,
    top: f64,
    split_offset: f64,
    policy: Option<&crate::layout::PaginationPolicy>,
    force: bool,
    head_children: &mut Vec<PaginationChild>,
    tail_children: &mut Vec<PaginationChild>,
) -> Option<()> {
    let PaginationChild::Block(child_block) = child else {
        return None;
    };
    let mut nested = split_nested_pagination_block(child_block, split_offset - top, policy, force)?;
    if nested.head.height > split_offset - top + GEOMETRY_EPSILON {
        return None;
    }
    nested.head.x = child_block.x;
    nested.head.y = top;
    nested.tail.x = child_block.x;
    nested.tail.y = 0.0;
    head_children.push(PaginationChild::Block(Box::new(nested.head)));
    tail_children.push(PaginationChild::Block(Box::new(nested.tail)));
    Some(())
}

fn resolve_composite_split_offset(
    block: &PaginationBlock,
    available_height: f64,
    policy: Option<&crate::layout::PaginationPolicy>,
    force: bool,
) -> f64 {
    let mut split_offset = available_height.min(block.height);
    for _ in 0..block.children.len() + 2 {
        let adjusted = block.children.iter().fold(split_offset, |adjusted, child| {
            adjust_composite_split_offset(child, split_offset, adjusted, policy, force)
        });
        if adjusted >= split_offset - GEOMETRY_EPSILON {
            return split_offset;
        }
        split_offset = adjusted;
        if split_offset <= 0.0 {
            return 0.0;
        }
    }
    split_offset
}

fn adjust_composite_split_offset(
    child: &PaginationChild,
    split_offset: f64,
    adjusted: f64,
    policy: Option<&crate::layout::PaginationPolicy>,
    force: bool,
) -> f64 {
    let (top, height) = pagination_child_vertical_geometry(child);
    if top >= split_offset || top + height <= split_offset {
        return adjusted;
    }
    let PaginationChild::Block(block) = child else {
        return adjusted.min(top);
    };
    let nested = split_nested_pagination_block(block, split_offset - top, policy, force);
    adjusted.min(nested.map_or(top, |split| top + split.head.height))
}

fn split_nested_pagination_block(
    block: &PaginationBlock,
    available_height: f64,
    policy: Option<&crate::layout::PaginationPolicy>,
    force: bool,
) -> Option<PaginationSplitResult> {
    let mut local = block.clone();
    local.y = 0.0;
    split_pagination_block(&local, available_height, policy, force)
}

fn pagination_child_vertical_geometry(child: &PaginationChild) -> (f64, f64) {
    match child {
        PaginationChild::Block(block) => (block.y, block.height),
        PaginationChild::Line(line) => (line.y, line.height),
        PaginationChild::Image(image) => (image.y, image.height),
        PaginationChild::Hr(hr) => (hr.y, hr.height),
    }
}

fn shift_pagination_child_y(child: &PaginationChild, dy: f64) -> PaginationChild {
    match child {
        PaginationChild::Block(block) => {
            let mut block = block.as_ref().clone();
            block.y += dy;
            PaginationChild::Block(Box::new(block))
        }
        PaginationChild::Line(line) => {
            let mut line = line.clone();
            line.y += dy;
            PaginationChild::Line(line)
        }
        PaginationChild::Image(image) => {
            let mut image = image.clone();
            image.y += dy;
            PaginationChild::Image(image)
        }
        PaginationChild::Hr(hr) => {
            let mut hr = hr.clone();
            hr.y += dy;
            PaginationChild::Hr(hr)
        }
    }
}

fn build_pagination_fragment_result(
    block: &PaginationBlock,
    head_children: Vec<PaginationChild>,
    tail_children: Vec<PaginationChild>,
    split_offset: f64,
) -> PaginationSplitResult {
    PaginationSplitResult {
        head: build_pagination_fragment(block, head_children, split_offset, true),
        tail: build_pagination_fragment(block, tail_children, split_offset, false),
    }
}

fn build_pagination_fragment(
    block: &PaginationBlock,
    children: Vec<PaginationChild>,
    split_offset: f64,
    head: bool,
) -> PaginationBlock {
    let head_height = split_offset.min(block.height).max(0.0);
    let mut fragment = block.clone();
    fragment.y = if head { block.y } else { 0.0 };
    fragment.height = if head {
        head_height
    } else {
        (block.height - head_height).max(0.0)
    };
    fragment.anchor_id = if head { block.anchor_id.clone() } else { None };
    fragment.paint = slice_pagination_paint(block.paint.as_ref(), head);
    fragment.border_box = slice_pagination_border_box(block.border_box.as_ref(), head);
    fragment.page_break_before = head && block.page_break_before;
    fragment.page_break_after = !head && block.page_break_after;
    fragment.children = children;
    fragment
}

fn reposition_pagination_lines(lines: &[LineBox], split_offset: f64) -> Vec<LineBox> {
    lines
        .iter()
        .cloned()
        .map(|mut line| {
            line.y -= split_offset;
            line
        })
        .collect()
}

fn slice_pagination_paint(paint: Option<&Value>, head: bool) -> Option<Value> {
    let mut paint = paint?.clone();
    if let Some(border) = paint.get_mut("border").and_then(Value::as_object_mut) {
        border.remove(if head { "bottom" } else { "top" });
    }
    Some(paint)
}

fn slice_pagination_border_box(border_box: Option<&Value>, head: bool) -> Option<Value> {
    let mut border_box = border_box?.clone();
    if let Some(edges) = border_box.as_object_mut() {
        edges.insert(
            if head { "bottomWidth" } else { "topWidth" }.to_owned(),
            number_value(0.0),
        );
    }
    Some(border_box)
}

fn compute_pagination_lines_height(lines: &[LineBox]) -> f64 {
    lines.last().map(|line| line.y + line.height).unwrap_or(0.0)
}

fn reposition_pagination_block(block: &PaginationBlock, new_y: f64) -> PaginationBlock {
    let mut block = block.clone();
    block.y = new_y;
    block
}

fn summarize_pagination_flow_page(page: &PaginationPage) -> Value {
    let mut texts = Vec::new();
    for block in &page.content {
        collect_pagination_block_text(block, &mut texts);
    }
    let blocks = page
        .content
        .iter()
        .map(summarize_pagination_flow_block)
        .collect::<Vec<_>>();

    let mut value = Map::new();
    value.insert("index".to_owned(), Value::Number(Number::from(page.index)));
    value.insert(
        "bounds".to_owned(),
        rect_value(0.0, 0.0, page.width, page.height),
    );
    if let Some(paint) = &page.paint {
        value.insert("paint".to_owned(), paint.clone());
    }
    value.insert(
        "counts".to_owned(),
        serde_json::to_value(count_pagination_page(page))
            .expect("pagination flow counts serialize"),
    );
    value.insert(
        "firstText".to_owned(),
        Value::String(crop_text(texts.first().map(String::as_str).unwrap_or(""))),
    );
    value.insert(
        "lastText".to_owned(),
        Value::String(crop_text(texts.last().map(String::as_str).unwrap_or(""))),
    );
    value.insert("blocks".to_owned(), Value::Array(blocks));
    Value::Object(value)
}

fn summarize_pagination_flow_block(block: &PaginationBlock) -> Value {
    let aggregate = aggregate_pagination_flow_block(block);
    let child_summaries = block
        .children
        .iter()
        .map(summarize_pagination_flow_child)
        .collect::<Vec<_>>();
    let mut value = Map::new();
    value.insert(
        "anchorId".to_owned(),
        block
            .anchor_id
            .as_ref()
            .map_or(Value::Null, |value| Value::String(value.clone())),
    );
    value.insert(
        "bounds".to_owned(),
        rect_value(block.x, block.y, block.width, block.height),
    );
    value.insert(
        "childCount".to_owned(),
        Value::Number(Number::from(block.children.len())),
    );
    value.insert(
        "childDetailHash".to_owned(),
        Value::String(hash_json(&Value::Array(child_summaries.clone()))),
    );
    value.insert("children".to_owned(), Value::Array(child_summaries));
    value.insert(
        "hrCount".to_owned(),
        Value::Number(Number::from(aggregate.hr_count)),
    );
    value.insert(
        "imageCount".to_owned(),
        Value::Number(Number::from(aggregate.image_count)),
    );
    value.insert(
        "lineCount".to_owned(),
        Value::Number(Number::from(aggregate.line_count)),
    );
    value.insert(
        "nestedBlockCount".to_owned(),
        Value::Number(Number::from(aggregate.nested_block_count)),
    );
    value.insert(
        "semanticTag".to_owned(),
        block
            .semantic_tag
            .as_ref()
            .map_or(Value::Null, |value| Value::String(value.clone())),
    );
    value.insert(
        "textHash".to_owned(),
        Value::String(hash_text(&aggregate.text)),
    );
    value.insert(
        "textRunCount".to_owned(),
        Value::Number(Number::from(aggregate.text_run_count)),
    );
    remove_null_object_fields(Value::Object(value))
}

fn summarize_pagination_flow_child(child: &PaginationChild) -> Value {
    match child {
        PaginationChild::Block(block) => {
            let mut summary = summarize_pagination_flow_block(block);
            if let Value::Object(object) = &mut summary {
                object.remove("children");
            }
            summary
        }
        PaginationChild::Line(line) => json!({
            "type": "line-box",
            "bounds": rect_value(line.x, line.y, line.width, line.height),
            "runCount": line.runs.len(),
            "textHash": hash_text(&line.text()),
            "usedWidth": number_value(line.used_width()),
        }),
        PaginationChild::Image(image) => {
            let mut value = Map::new();
            value.insert(
                "alt".to_owned(),
                optional_string_value(image.alt.as_deref()),
            );
            value.insert(
                "bounds".to_owned(),
                rect_value(image.x, image.y, image.width, image.height),
            );
            value.insert(
                "href".to_owned(),
                optional_string_value(image.href.as_deref()),
            );
            value.insert("src".to_owned(), Value::String(image.src.clone()));
            value.insert("type".to_owned(), Value::String("image".to_owned()));
            remove_null_object_fields(Value::Object(value))
        }
        PaginationChild::Hr(hr) => json!({
            "type": "hr",
            "bounds": rect_value(hr.x, hr.y, hr.width, hr.height),
            "paint": {
                "color": hr.color,
                "style": hr.style,
            },
        }),
    }
}

#[derive(Debug, Default)]
struct PaginationAggregate {
    nested_block_count: usize,
    line_count: usize,
    text_run_count: usize,
    image_count: usize,
    hr_count: usize,
    text: String,
}

fn aggregate_pagination_flow_block(block: &PaginationBlock) -> PaginationAggregate {
    let mut aggregate = PaginationAggregate::default();
    aggregate_pagination_block(block, &mut aggregate);
    aggregate
}

fn aggregate_pagination_block(block: &PaginationBlock, aggregate: &mut PaginationAggregate) {
    aggregate.nested_block_count += 1;
    for child in &block.children {
        match child {
            PaginationChild::Block(block) => aggregate_pagination_block(block, aggregate),
            PaginationChild::Line(line) => {
                aggregate.line_count += 1;
                for run in &line.runs {
                    match run {
                        LineRun::Text(run) => {
                            aggregate.text_run_count += 1;
                            aggregate.text.push_str(&run.text);
                        }
                        LineRun::Atom(run) if run.image_src.is_some() => {
                            aggregate.image_count += 1;
                        }
                        LineRun::Atom(_) | LineRun::Ruby(_) => {}
                    }
                }
            }
            PaginationChild::Image(_) => aggregate.image_count += 1,
            PaginationChild::Hr(_) => aggregate.hr_count += 1,
        }
    }
}

fn count_pagination_page(page: &PaginationPage) -> PaginationFlowCounts {
    page.content
        .iter()
        .fold(PaginationFlowCounts::default(), |counts, block| {
            counts.add(&count_pagination_block(block))
        })
}

fn count_pagination_block(block: &PaginationBlock) -> PaginationFlowCounts {
    block
        .children
        .iter()
        .fold(PaginationFlowCounts::block(), |counts, child| {
            counts.add(&count_pagination_child(child))
        })
}

fn count_pagination_child(child: &PaginationChild) -> PaginationFlowCounts {
    match child {
        PaginationChild::Block(block) => count_pagination_block(block),
        PaginationChild::Line(line) => line
            .runs
            .iter()
            .fold(PaginationFlowCounts::line(), |counts, run| {
                counts.add(&count_pagination_run(run))
            }),
        PaginationChild::Image(_) => PaginationFlowCounts::image(),
        PaginationChild::Hr(_) => PaginationFlowCounts::hr(),
    }
}

fn count_pagination_run(run: &LineRun) -> PaginationFlowCounts {
    match run {
        LineRun::Text(_) => PaginationFlowCounts::text_run(),
        LineRun::Ruby(_) => PaginationFlowCounts::ruby(),
        LineRun::Atom(run) => {
            let mut counts = PaginationFlowCounts::inline_atom();
            if run.image_src.is_some() {
                counts.images = 1;
            }
            counts
        }
    }
}

impl PaginationFlowCounts {
    fn block() -> Self {
        Self {
            blocks: 1,
            ..Self::default()
        }
    }

    fn line() -> Self {
        Self {
            lines: 1,
            ..Self::default()
        }
    }

    fn text_run() -> Self {
        Self {
            text_runs: 1,
            ..Self::default()
        }
    }

    fn inline_atom() -> Self {
        Self {
            inline_atoms: 1,
            ..Self::default()
        }
    }

    fn image() -> Self {
        Self {
            images: 1,
            ..Self::default()
        }
    }

    fn ruby() -> Self {
        Self {
            ruby: 1,
            ..Self::default()
        }
    }

    fn hr() -> Self {
        Self {
            hrs: 1,
            ..Self::default()
        }
    }

    fn add(&self, other: &Self) -> Self {
        Self {
            blocks: self.blocks + other.blocks,
            lines: self.lines + other.lines,
            text_runs: self.text_runs + other.text_runs,
            inline_atoms: self.inline_atoms + other.inline_atoms,
            images: self.images + other.images,
            ruby: self.ruby + other.ruby,
            hrs: self.hrs + other.hrs,
        }
    }
}

fn collect_pagination_block_text(block: &PaginationBlock, texts: &mut Vec<String>) {
    for child in &block.children {
        match child {
            PaginationChild::Block(block) => collect_pagination_block_text(block, texts),
            PaginationChild::Line(line) => collect_pagination_line_text(line, texts),
            PaginationChild::Image(_) | PaginationChild::Hr(_) => {}
        }
    }
}

fn collect_pagination_line_text(line: &LineBox, texts: &mut Vec<String>) {
    for run in &line.runs {
        if let LineRun::Text(run) = run {
            if !run.text.trim().is_empty() {
                texts.push(run.text.clone());
            }
        }
    }
}

fn crop_text(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect()
}

fn choose_pagination_flow_sample_indices(
    page_count: usize,
    chapter_ranges: &[PaginationFlowChapterRange],
) -> Vec<usize> {
    let mut indices = BTreeMap::<usize, ()>::new();
    add_sample_range(&mut indices, 0, page_count.min(2));
    add_sample_range(&mut indices, page_count.saturating_sub(2), page_count);
    for range in chapter_ranges {
        indices.insert(range.start_page, ());
        indices.insert(range.end_page, ());
        if indices.len() >= 16 {
            break;
        }
    }
    indices
        .into_keys()
        .filter(|index| *index < page_count)
        .take(16)
        .collect()
}

fn add_sample_range(indices: &mut BTreeMap<usize, ()>, start: usize, end: usize) {
    for index in start..end {
        indices.insert(index, ());
    }
}

fn count_value_field(value: &Value, key: &str) -> PaginationFlowCounts {
    value
        .get(key)
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

fn string_value_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn optional_string_value(value: Option<&str>) -> Value {
    value.map_or(Value::Null, |value| Value::String(value.to_owned()))
}

fn remove_null_object_fields(value: Value) -> Value {
    let Value::Object(mut object) = value else {
        return value;
    };
    object.retain(|_, value| !value.is_null());
    Value::Object(object)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        build_pagination_flow, force_split_pagination_block, paginate_continuous_blocks,
        try_split_pagination_block, PaginationFlowChapter,
    };
    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild, RuntimeHorizontalRule, RuntimeImage},
        create_layout_config,
        line::{LineBox, LineRun, TextRunBox},
        LayoutConfigInput, MarginInput, PaginationPolicy, SpreadMode,
    };

    #[test]
    fn paginates_blocks_and_summarizes_flow() {
        let layout = test_layout();
        let blocks = vec![
            block_with_line("First", 0.0, 30.0),
            block_with_line("Second", 35.0, 90.0),
        ];
        let pages = paginate_continuous_blocks(blocks, &layout, None);

        let summary = build_pagination_flow(
            &[PaginationFlowChapter {
                idref: "chapter".to_owned(),
                block_count: 2,
                pages,
            }],
            &layout,
        )
        .summary;

        assert_eq!(summary.page_count, 2);
        assert_eq!(summary.totals.blocks, 2);
        assert_eq!(summary.page_digests[0].first_text, "First");
        assert_eq!(summary.samples[0]["bounds"]["width"], json!(320));
    }

    #[test]
    fn split_line_block_preserves_fragment_box_model_and_edge_semantics() {
        let mut block = block_with_line("First", 7.0, 100.0);
        block.anchor_id = Some("chapter".to_owned());
        block.page_break_before = true;
        block.page_break_after = true;
        block.paint = Some(json!({
            "background": { "color": "#fff" },
            "border": { "top": 1, "right": 2, "bottom": 3, "left": 4 },
        }));
        block.border_box = Some(json!({
            "topWidth": 1, "rightWidth": 2, "bottomWidth": 3, "leftWidth": 4,
        }));
        block.children = [8.0, 28.0, 48.0, 68.0]
            .into_iter()
            .enumerate()
            .map(|(index, y)| RuntimeChild::Line(line_box(&index.to_string(), y)))
            .collect();

        let split = try_split_pagination_block(&block, 50.0, &test_layout())
            .expect("line block splits after two lines");

        assert_eq!((split.head.y, split.head.height), (7.0, 48.0));
        assert_eq!((split.tail.y, split.tail.height), (0.0, 52.0));
        assert_eq!(line_y(&split.tail.children[0]), 0.0);
        assert_eq!(line_y(&split.tail.children[1]), 20.0);
        assert_eq!(split.head.anchor_id.as_deref(), Some("chapter"));
        assert_eq!(split.tail.anchor_id, None);
        assert!(split.head.page_break_before);
        assert!(!split.head.page_break_after);
        assert!(!split.tail.page_break_before);
        assert!(split.tail.page_break_after);
        assert_eq!(
            split.head.paint.as_ref().unwrap()["border"].get("bottom"),
            None
        );
        assert_eq!(
            split.tail.paint.as_ref().unwrap()["border"].get("top"),
            None
        );
        assert_eq!(split.head.border_box.as_ref().unwrap()["bottomWidth"], 0);
        assert_eq!(split.tail.border_box.as_ref().unwrap()["topWidth"], 0);
    }

    #[test]
    fn split_line_block_preserves_gap_at_fragment_boundary() {
        let mut block = block_with_line("First", 0.0, 100.0);
        block.children = vec![
            RuntimeChild::Line(line_box("First", 0.0)),
            RuntimeChild::Line(line_box("Second", 50.0)),
        ];

        let split = try_split_pagination_block(&block, 30.0, &test_layout())
            .expect("line block splits inside the inter-line gap");

        assert_eq!((split.head.height, split.tail.height), (30.0, 70.0));
        assert_eq!(line_y(&split.tail.children[0]), 20.0);
    }

    #[test]
    fn forced_split_preserves_non_line_children() {
        let mut block = block_with_line("First", 0.0, 60.0);
        block.children.push(RuntimeChild::Image(RuntimeImage {
            x: 0.0,
            y: 20.0,
            width: 80.0,
            height: 40.0,
            src: "figure.png".to_owned(),
            alt: None,
            href: None,
        }));

        let split = force_split_pagination_block(&block, 40.0)
            .expect("mixed block splits before the crossing image");

        assert!(matches!(
            split.head.children.as_slice(),
            [RuntimeChild::Line(_)]
        ));
        assert!(matches!(
            split.tail.children.as_slice(),
            [RuntimeChild::Image(_)]
        ));
        assert_eq!(child_y(&split.tail.children[0]), 0.0);
    }

    #[test]
    fn paginates_tall_table_like_composite_at_row_boundaries() {
        let mut table = empty_block(0.0, 180.0, Some("table"));
        table.paint = Some(json!({ "background": { "color": "#eee" } }));
        table.children = ["row-1", "row-2", "row-3"]
            .into_iter()
            .enumerate()
            .map(|(index, label)| {
                RuntimeChild::Block(Box::new(empty_block(
                    index as f64 * 60.0,
                    60.0,
                    Some(label),
                )))
            })
            .collect();

        let pages = paginate_continuous_blocks(vec![table], &test_layout(), None);
        let labels = pages
            .iter()
            .flat_map(|page| &page.content)
            .flat_map(|block| &block.children)
            .filter_map(|child| match child {
                RuntimeChild::Block(block) => block.semantic_tag.as_deref(),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(pages.len(), 3);
        assert_eq!(labels, ["row-1", "row-2", "row-3"]);
        assert!(pages.iter().all(|page| {
            page.content[0].paint.as_ref().unwrap()["background"]["color"] == "#eee"
        }));
    }

    #[test]
    fn recursively_splits_crossing_nested_block_and_preserves_trailing_hr() {
        let mut nested = block_with_lines(3);
        nested.x = 7.0;
        nested.y = 10.0;
        nested.height = 70.0;
        let mut outer = empty_block(0.0, 100.0, Some("outer"));
        outer.children = vec![
            RuntimeChild::Block(Box::new(nested)),
            RuntimeChild::Hr(RuntimeHorizontalRule {
                x: 0.0,
                y: 80.0,
                width: 100.0,
                height: 2.0,
                color: "#000".to_owned(),
                style: "solid".to_owned(),
            }),
        ];

        let split = try_split_pagination_block(&outer, 50.0, &test_layout())
            .expect("outer block splits through its nested line block");
        let RuntimeChild::Block(head_nested) = &split.head.children[0] else {
            panic!("nested head expected");
        };
        let RuntimeChild::Block(tail_nested) = &split.tail.children[0] else {
            panic!("nested tail expected");
        };

        assert_eq!(
            (head_nested.x, head_nested.y, head_nested.height),
            (7.0, 10.0, 40.0)
        );
        assert_eq!(head_nested.children.len(), 2);
        assert_eq!(
            (tail_nested.x, tail_nested.y, tail_nested.height),
            (7.0, 0.0, 30.0)
        );
        assert_eq!(tail_nested.children.len(), 1);
        assert!(matches!(split.tail.children[1], RuntimeChild::Hr(_)));
        assert_eq!(child_y(&split.tail.children[1]), 30.0);
    }

    #[test]
    fn split_constraints_prefer_block_then_policy_then_css_defaults() {
        let block = block_with_lines(8);
        let default_split = try_split_pagination_block(&block, 25.0, &test_layout())
            .expect("CSS default orphans moves the split after two lines");
        assert_eq!(default_split.head.children.len(), 2);

        let policy_layout = test_layout_with_policy(PaginationPolicy {
            enabled: None,
            default_orphans: Some(3),
            default_widows: Some(2),
        });
        let policy_split = try_split_pagination_block(&block, 25.0, &policy_layout)
            .expect("policy orphans moves the split after three lines");
        assert_eq!(policy_split.head.children.len(), 3);

        let mut block_override = block.clone();
        block_override.orphans = Some(4);
        let block_split = try_split_pagination_block(&block_override, 25.0, &policy_layout)
            .expect("block orphans overrides the policy default");
        assert_eq!(block_split.head.children.len(), 4);

        let default_split = try_split_pagination_block(&block, 125.0, &test_layout())
            .expect("CSS default widows leaves two lines in the tail");
        assert_eq!(default_split.head.children.len(), 6);

        let policy_layout = test_layout_with_policy(PaginationPolicy {
            enabled: None,
            default_orphans: Some(2),
            default_widows: Some(3),
        });
        let policy_split = try_split_pagination_block(&block, 125.0, &policy_layout)
            .expect("policy widows leaves three lines in the tail");
        assert_eq!(policy_split.head.children.len(), 5);

        block_override = block;
        block_override.widows = Some(4);
        let block_split = try_split_pagination_block(&block_override, 125.0, &policy_layout)
            .expect("block widows overrides the policy default");
        assert_eq!(block_split.head.children.len(), 4);
    }

    #[test]
    fn disabled_policy_uses_one_line_constraints_even_with_block_overrides() {
        let mut block = block_with_lines(8);
        block.orphans = Some(4);
        block.widows = Some(4);
        let layout = test_layout_with_policy(PaginationPolicy {
            enabled: Some(false),
            default_orphans: Some(5),
            default_widows: Some(5),
        });

        let split = try_split_pagination_block(&block, 25.0, &layout)
            .expect("disabled policy permits a one-line fragment");

        assert_eq!(split.head.children.len(), 1);
    }

    #[test]
    fn extreme_block_constraints_do_not_overflow() {
        let mut block = block_with_lines(8);
        block.orphans = Some(usize::MAX);
        block.widows = Some(2);

        let split = try_split_pagination_block(&block, 25.0, &test_layout())
            .expect("an unsatisfiable constraint preserves the natural split");

        assert_eq!(split.head.children.len(), 1);
    }

    fn test_layout() -> crate::layout::LayoutConfig {
        create_layout_config(LayoutConfigInput {
            width: 320.0,
            height: 120.0,
            margin: MarginInput::All(10.0),
            spread: SpreadMode::Single,
            first_page_alone: false,
            spread_gap: 20.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: None,
        })
    }

    fn test_layout_with_policy(policy: PaginationPolicy) -> crate::layout::LayoutConfig {
        let mut layout = test_layout();
        layout.pagination_policy = Some(policy);
        layout
    }

    fn block_with_lines(line_count: usize) -> RuntimeBlock<LineBox> {
        let mut block = block_with_line("0", 0.0, line_count as f64 * 20.0);
        block.children = (0..line_count)
            .map(|index| RuntimeChild::Line(line_box(&index.to_string(), index as f64 * 20.0)))
            .collect();
        block
    }

    fn block_with_line(text: &str, y: f64, height: f64) -> RuntimeBlock<LineBox> {
        RuntimeBlock {
            x: 0.0,
            y,
            width: 240.0,
            height,
            semantic_tag: None,
            anchor_id: None,
            paint: None,
            border_box: None,
            page_break_before: false,
            page_break_after: false,
            orphans: None,
            widows: None,
            children: vec![RuntimeChild::Line(line_box(text, 0.0))],
        }
    }

    fn empty_block(y: f64, height: f64, semantic_tag: Option<&str>) -> RuntimeBlock<LineBox> {
        let mut block = block_with_line("", y, height);
        block.semantic_tag = semantic_tag.map(str::to_owned);
        block.children.clear();
        block
    }

    fn line_box(text: &str, y: f64) -> LineBox {
        LineBox {
            x: 0.0,
            y,
            width: 240.0,
            height: 20.0,
            runs: vec![LineRun::Text(TextRunBox {
                text: text.to_owned(),
                text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
                x: 0.0,
                y: 0.0,
                width: 40.0,
                height: 12.0,
                font_size: 12.0,
                paint: json!({}),
                line_height_px: None,
                href: None,
                source_path: None,
                source_text: None,
                source_text_offset: None,
                inline_margin_right: None,
                ruby_annotation: None,
                shape: crate::layout::text_shape::fixture_run_shape(40.0),
            })],
        }
    }

    fn line_y(child: &RuntimeChild<LineBox>) -> f64 {
        match child {
            RuntimeChild::Line(line) => line.y,
            _ => panic!("line child expected"),
        }
    }

    fn child_y(child: &RuntimeChild<LineBox>) -> f64 {
        match child {
            RuntimeChild::Block(block) => block.y,
            RuntimeChild::Line(line) => line.y,
            RuntimeChild::Image(image) => image.y,
            RuntimeChild::Hr(hr) => hr.y,
        }
    }
}
