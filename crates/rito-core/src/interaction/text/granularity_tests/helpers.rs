use std::sync::Arc;

use super::super::{
    resolve_text_range_from_points, LayoutTextPageRange, LayoutTextPoint,
    LayoutTextRangeFromPoints, LayoutTextRangeFromPointsResolution, LayoutTextSelectionGranularity,
};
use crate::layout::{
    fixture_logical_text_flow, LayoutRuntimePage, LineBox, LineRun, LogicalTextFlow, RunPaint,
    RunShape, RunShapeCluster, RunShapeDirection, RunShapeProvenance, RunTextMapping, RuntimeBlock,
    RuntimeChild, TextFlowSlice, TextRunBox,
};

pub(super) fn selected_word(text: &str, hit_offset: usize) -> String {
    let flow = exact_flow(text);
    let length = u32::try_from(text.encode_utf16().count()).expect("fixture length fits");
    let page = one_flow_page(0, &flow, text, uniform_shape(length));
    let x = 15.0 + hit_offset as f64 * 10.0;
    resolved(
        &[page],
        point(0, x, 30.0),
        point(0, x, 30.0),
        LayoutTextSelectionGranularity::Word,
    )
    .range
    .selected_text
}

pub(super) fn resolved(
    pages: &[LayoutRuntimePage],
    anchor: LayoutTextPoint,
    focus: LayoutTextPoint,
    granularity: LayoutTextSelectionGranularity,
) -> Box<LayoutTextRangeFromPoints> {
    resolved_with_language(pages, anchor, focus, granularity, None)
}

pub(super) fn resolved_with_language(
    pages: &[LayoutRuntimePage],
    anchor: LayoutTextPoint,
    focus: LayoutTextPoint,
    granularity: LayoutTextSelectionGranularity,
    language: Option<&str>,
) -> Box<LayoutTextRangeFromPoints> {
    resolved_with_options(
        pages,
        anchor,
        focus,
        granularity,
        language,
        page_range(0, pages.len().saturating_sub(1)),
    )
}

pub(super) fn resolved_with_page_range(
    pages: &[LayoutRuntimePage],
    anchor: LayoutTextPoint,
    focus: LayoutTextPoint,
    granularity: LayoutTextSelectionGranularity,
    scope: LayoutTextPageRange,
) -> Box<LayoutTextRangeFromPoints> {
    resolved_with_options(pages, anchor, focus, granularity, None, scope)
}

pub(super) fn resolved_with_options(
    pages: &[LayoutRuntimePage],
    anchor: LayoutTextPoint,
    focus: LayoutTextPoint,
    granularity: LayoutTextSelectionGranularity,
    language: Option<&str>,
    scope: LayoutTextPageRange,
) -> Box<LayoutTextRangeFromPoints> {
    let LayoutTextRangeFromPointsResolution::Resolved(range) =
        resolve_text_range_from_points(pages, anchor, focus, granularity, language, scope)
    else {
        panic!("point range resolves");
    };
    range
}

pub(super) fn split_flow_pages(
    flow: &Arc<LogicalTextFlow>,
    text: &str,
    split: u32,
) -> Vec<LayoutRuntimePage> {
    let length = u32::try_from(text.encode_utf16().count()).expect("fixture length fits");
    let split_byte = usize::try_from(split).expect("ASCII fixture split fits");
    vec![
        page_from_blocks(
            0,
            vec![block(
                20.0,
                &text[..split_byte],
                exact_slice(flow, 0, split),
                uniform_shape(split),
            )],
        ),
        page_from_blocks(
            1,
            vec![block(
                20.0,
                &text[split_byte..],
                exact_slice(flow, split, length),
                uniform_shape(length - split),
            )],
        ),
    ]
}

pub(super) fn point(page_index: usize, x: f64, y: f64) -> LayoutTextPoint {
    LayoutTextPoint { page_index, x, y }
}

pub(super) fn page_range(first_page: usize, last_page: usize) -> LayoutTextPageRange {
    LayoutTextPageRange {
        first_page,
        last_page,
    }
}

pub(super) fn exact_flow(text: &str) -> Arc<LogicalTextFlow> {
    let length = u32::try_from(text.encode_utf16().count()).expect("fixture length fits");
    fixture_logical_text_flow(text, vec![(0, length, Some((vec![1, 2], 0)))])
}

pub(super) fn one_flow_page(
    index: usize,
    flow: &Arc<LogicalTextFlow>,
    text: &str,
    shape: RunShape,
) -> LayoutRuntimePage {
    let length = u32::try_from(text.encode_utf16().count()).expect("fixture length fits");
    page_from_blocks(
        index,
        vec![block(20.0, text, exact_slice(flow, 0, length), shape)],
    )
}

pub(super) fn flow_page(flows: &[(&Arc<LogicalTextFlow>, &str)]) -> LayoutRuntimePage {
    page_from_blocks(
        0,
        flows
            .iter()
            .enumerate()
            .map(|(index, (flow, text))| {
                let length = u32::try_from(text.encode_utf16().count()).expect("fixture fits");
                block(
                    20.0 + index as f64 * 40.0,
                    text,
                    exact_slice(flow, 0, length),
                    uniform_shape(length),
                )
            })
            .collect(),
    )
}

pub(super) fn exact_slice(flow: &Arc<LogicalTextFlow>, start: u32, end: u32) -> RunTextMapping {
    mapped_slice(flow, 0, start, end)
}

pub(super) fn mapped_slice(
    flow: &Arc<LogicalTextFlow>,
    span_index: u32,
    start: u32,
    end: u32,
) -> RunTextMapping {
    RunTextMapping::Exact(TextFlowSlice {
        flow: Arc::clone(flow),
        span_index,
        logical_start: start,
        logical_end: end,
    })
}

pub(super) fn block(
    y: f64,
    text: &str,
    mapping: RunTextMapping,
    shape: RunShape,
) -> RuntimeBlock<LineBox> {
    block_with_runs(y, vec![text_run(text, mapping, 0.0, shape)])
}

pub(super) fn block_with_runs(y: f64, runs: Vec<LineRun>) -> RuntimeBlock<LineBox> {
    let width = runs
        .iter()
        .filter_map(|run| match run {
            LineRun::Text(run) => Some(run.x + run.width),
            LineRun::Atom(_) | LineRun::Ruby(_) => None,
        })
        .fold(0.0, f64::max);
    RuntimeBlock {
        x: 10.0,
        y,
        width,
        height: 20.0,
        semantic_tag: Some("p".to_owned()),
        anchor_id: None,
        paint: None,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: vec![RuntimeChild::Line(LineBox {
            x: 0.0,
            y: 0.0,
            width,
            height: 20.0,
            runs,
        })],
    }
}

pub(super) fn text_run(
    text: &str,
    text_mapping: RunTextMapping,
    x: f64,
    shape: RunShape,
) -> LineRun {
    let width = shape.advance();
    LineRun::Text(TextRunBox {
        text: text.to_owned(),
        text_mapping,
        x,
        y: 0.0,
        width,
        height: 20.0,
        font_size: 16.0,
        interaction_geometry: None,
        paint: RunPaint::default(),
        line_height_px: None,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        inline_margin_right: None,
        ruby_annotation: None,
        shape,
    })
}

pub(super) fn page_from_blocks(
    index: usize,
    blocks: Vec<RuntimeBlock<LineBox>>,
) -> LayoutRuntimePage {
    LayoutRuntimePage {
        index,
        width: 400.0,
        height: 600.0,
        paint: None,
        content: blocks,
    }
}

pub(super) fn uniform_shape(length: u32) -> RunShape {
    exact_shape(
        &(0..length)
            .map(|offset| (offset, offset + 1, 10.0))
            .collect::<Vec<_>>(),
    )
}

pub(super) fn exact_shape(clusters: &[(u32, u32, f32)]) -> RunShape {
    RunShape::exact(
        RunShapeProvenance::single([1; 8]),
        RunShapeDirection::LeftToRight,
        clusters.iter().map(|cluster| f64::from(cluster.2)).sum(),
        clusters
            .iter()
            .map(|cluster| RunShapeCluster {
                logical_start: cluster.0,
                logical_end: cluster.1,
                advance: cluster.2,
            })
            .collect(),
    )
}
