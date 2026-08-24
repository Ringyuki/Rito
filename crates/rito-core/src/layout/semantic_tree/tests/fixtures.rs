use std::sync::Arc;

use serde_json::{json, Map, Value};

use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    inline_segment::{InlineSegment, TextSegment},
    line::{AtomRunBox, LineBox, LineRun, TextRunBox},
    line_layout::layout_greedy_lines,
    text_mapping::{
        finalize_inline_text_flow, fixture_logical_text_flow, LogicalTextFlow, RunTextMapping,
        TextFlowSlice, TextMappingCandidate, TextSegmentMapping, TextSourceBasis,
    },
    text_shape::fixture_run_shape,
    visual_geometry::VisualRect,
    RunPaint,
};

pub(super) fn block(
    tag: &str,
    x: f64,
    y: f64,
    children: Vec<RuntimeChild<LineBox>>,
) -> RuntimeBlock<LineBox> {
    RuntimeBlock {
        x,
        y,
        width: 180.0,
        height: 36.0,
        semantic_tag: Some(tag.to_owned()),
        anchor_id: None,
        paint: None,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children,
    }
}

pub(super) fn line(runs: Vec<LineRun>) -> RuntimeChild<LineBox> {
    line_at(0.0, 0.0, runs)
}

pub(super) fn line_at(x: f64, y: f64, runs: Vec<LineRun>) -> RuntimeChild<LineBox> {
    RuntimeChild::Line(LineBox {
        x,
        y,
        width: 160.0,
        height: 18.0,
        runs,
    })
}

pub(super) fn text(value: &str, href: Option<&str>) -> LineRun {
    let mut run = text_at(value, 0.0, 0.0, value.len() as f64 * 8.0);
    if let LineRun::Text(text) = &mut run {
        text.href = href.map(str::to_owned);
    }
    run
}

pub(super) fn text_at(value: &str, x: f64, y: f64, width: f64) -> LineRun {
    LineRun::Text(TextRunBox {
        text: value.to_owned(),
        text_mapping: RunTextMapping::synthetic(),
        x,
        y,
        width,
        height: 12.0,
        font_size: 12.0,
        interaction_geometry: None,
        paint: RunPaint::default(),
        line_height_px: None,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        inline_margin_right: None,
        ruby_annotation: None,
        shape: fixture_run_shape(width),
    })
}

pub(super) fn exact_flow(text: &str) -> Arc<LogicalTextFlow> {
    let length = text.encode_utf16().count() as u32;
    fixture_logical_text_flow(text, vec![(0, length, Some((vec![0], 0)))])
}

pub(super) fn exact_lines(text: &str, width: f64) -> Vec<RuntimeChild<LineBox>> {
    let mut segments = vec![InlineSegment::Text(TextSegment {
        text: text.to_owned(),
        mapping: TextSegmentMapping::Candidate(TextMappingCandidate::new(
            text.to_owned(),
            Some(vec![0]),
            0,
            TextSourceBasis::ParsedText,
            text,
        )),
        style: Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("language".to_owned(), Value::String("en-us".to_owned())),
        ]),
        href: None,
        source_path: Some(vec![0]),
        source_text: Some(text.into()),
        source_text_offset: None,
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    })];
    finalize_inline_text_flow(&mut segments);
    layout_greedy_lines(&segments, width)
        .into_iter()
        .map(RuntimeChild::Line)
        .collect()
}

pub(super) fn exact_text(
    value: &str,
    flow: &Arc<LogicalTextFlow>,
    logical_start: u32,
    logical_end: u32,
) -> LineRun {
    let mut run = text(value, None);
    let LineRun::Text(text_run) = &mut run else {
        unreachable!();
    };
    text_run.text_mapping = RunTextMapping::Exact(TextFlowSlice {
        flow: Arc::clone(flow),
        span_index: 0,
        logical_start,
        logical_end,
    });
    run
}

pub(super) fn atom(image_src: Option<&str>, alt: Option<&str>, href: Option<&str>) -> LineRun {
    LineRun::Atom(AtomRunBox {
        x: 0.0,
        y: 0.0,
        width: 20.0,
        height: 20.0,
        image_src: image_src.map(str::to_owned),
        alt: alt.map(str::to_owned),
        href: href.map(str::to_owned),
    })
}

pub(super) fn assert_rect(rect: &VisualRect, x: f64, y: f64, width: f64, height: f64) {
    const EPSILON: f64 = 1e-9;
    assert!((rect.x - x).abs() < EPSILON);
    assert!((rect.y - y).abs() < EPSILON);
    assert!((rect.width - width).abs() < EPSILON);
    assert!((rect.height - height).abs() < EPSILON);
}
