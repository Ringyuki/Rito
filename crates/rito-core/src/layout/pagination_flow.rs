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

fn runtime_pagination_summary(
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
    let content_height = layout_config.content_height();
    if content_height <= 0.0 {
        return Vec::new();
    }

    let mut state = PaginationState::new(
        layout_config.page_width,
        layout_config.page_height,
        page_paint,
    );

    for (index, block) in blocks.iter().enumerate() {
        let spacing = compute_pagination_spacing(&blocks, index);
        place_pagination_block(
            block.clone(),
            spacing,
            content_height,
            &mut state,
            layout_config,
        );
    }
    if !state.page_blocks.is_empty() {
        state.emit_page();
    }

    state.pages
}

fn collect_chapter_start_pages(chapter_ranges: &[PaginationFlowChapterRange]) -> BTreeSet<usize> {
    chapter_ranges
        .iter()
        .map(|range| range.start_page)
        .collect()
}

fn compute_pagination_spacing(blocks: &[PaginationBlock], index: usize) -> f64 {
    if index == 0 {
        return blocks.first().map(|block| block.y).unwrap_or(0.0);
    }
    let previous = &blocks[index - 1];
    let current = &blocks[index];
    current.y - (previous.y + previous.height)
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

    let effective_spacing = if !state.page_blocks.is_empty() || state.pages.is_empty() {
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

fn try_split_pagination_block(
    block: &PaginationBlock,
    available_height: f64,
    layout_config: &LayoutConfig,
) -> Option<PaginationSplitResult> {
    let line_boxes = direct_line_children(block)?;
    let policy = layout_config.pagination_policy.as_ref();
    let policy_enabled = policy.and_then(|policy| policy.enabled).unwrap_or(true);
    let default_orphans = policy
        .and_then(|policy| policy.default_orphans)
        .unwrap_or(2) as usize;
    let default_widows = policy.and_then(|policy| policy.default_widows).unwrap_or(2) as usize;
    let orphans = if policy_enabled { default_orphans } else { 1 };
    let widows = if policy_enabled { default_widows } else { 1 };
    let min_total = orphans + widows;
    let mut split_index = find_pagination_split_index(&line_boxes, available_height);

    if line_boxes.len() >= min_total {
        if split_index < orphans {
            split_index = orphans;
        }
        if line_boxes.len() - split_index < widows {
            split_index = line_boxes.len() - widows;
        }
    }

    build_pagination_split_result(block, &line_boxes, split_index, available_height)
}

fn force_split_pagination_block(
    block: &PaginationBlock,
    available_height: f64,
) -> Option<PaginationSplitResult> {
    let line_boxes = direct_line_children(block)?;
    let split_index = find_pagination_split_index(&line_boxes, available_height);
    build_pagination_split_result(block, &line_boxes, split_index, available_height)
}

fn direct_line_children(block: &PaginationBlock) -> Option<Vec<LineBox>> {
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

fn build_pagination_split_result(
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
    let head_height = split_offset.min(block.height).max(0.0);
    let tail_height = (block.height - head_height).max(0.0);
    let head_lines = lines[..split_index]
        .iter()
        .cloned()
        .map(PaginationChild::Line)
        .collect::<Vec<_>>();
    let tail_lines = reposition_pagination_lines(&lines[split_index..], split_offset)
        .into_iter()
        .map(PaginationChild::Line)
        .collect::<Vec<_>>();
    let mut head = block.clone();
    head.height = head_height;
    head.paint = slice_pagination_paint(block.paint.as_ref(), true);
    head.border_box = slice_pagination_border_box(block.border_box.as_ref(), true);
    head.page_break_after = false;
    head.children = head_lines;
    let mut tail = block.clone();
    tail.y = 0.0;
    tail.height = tail_height;
    tail.anchor_id = None;
    tail.paint = slice_pagination_paint(block.paint.as_ref(), false);
    tail.border_box = slice_pagination_border_box(block.border_box.as_ref(), false);
    tail.page_break_before = false;
    tail.children = tail_lines;

    Some(PaginationSplitResult { head, tail })
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
        content::{RuntimeBlock, RuntimeChild, RuntimeImage},
        create_layout_config,
        line::{LineBox, LineRun, TextRunBox},
        LayoutConfigInput, MarginInput, SpreadMode,
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
    fn forced_split_rejects_mixed_children_without_dropping_content() {
        let mut block = block_with_line("First", 0.0, 100.0);
        block.children.push(RuntimeChild::Image(RuntimeImage {
            x: 0.0,
            y: 30.0,
            width: 20.0,
            height: 20.0,
            src: "image.png".to_owned(),
            alt: None,
            href: None,
        }));

        assert!(force_split_pagination_block(&block, 25.0).is_none());
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
            children: vec![RuntimeChild::Line(line_box(text, 0.0))],
        }
    }

    fn line_box(text: &str, y: f64) -> LineBox {
        LineBox {
            x: 0.0,
            y,
            width: 240.0,
            height: 20.0,
            runs: vec![LineRun::Text(TextRunBox {
                text: text.to_owned(),
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
            })],
        }
    }

    fn line_y(child: &RuntimeChild<LineBox>) -> f64 {
        match child {
            RuntimeChild::Line(line) => line.y,
            _ => panic!("line child expected"),
        }
    }
}
