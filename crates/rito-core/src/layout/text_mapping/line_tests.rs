use std::sync::Arc;

use serde_json::{json, Map, Value};

use super::{
    finalize_inline_text_flow, RunTextMapping, TextFlowSlice, TextMappingCandidate,
    TextMappingUnavailableReason, TextSegmentMapping, TextSourceBasis,
};
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    create_layout_config,
    inline_segment::{InlineSegment, TextSegment},
    line::{LineBox, LineRun, TextRunBox},
    line_layout::layout_greedy_lines,
    line_optimal::layout_optimal_lines,
    pagination_flow::paginate_continuous_blocks,
    LayoutConfigInput, MarginInput, SpreadMode,
};

#[test]
fn greedy_soft_wrap_retains_the_unpainted_space_in_the_flow() {
    let lines = layout_greedy_lines(&exact_segments("one two"), 24.0);

    assert_soft_wrap(&lines);
}

#[test]
fn optimal_soft_wrap_retains_the_unpainted_space_in_the_flow() {
    let lines = layout_optimal_lines(&exact_segments("one two"), 24.0);

    assert_soft_wrap(&lines);
}

#[test]
fn forced_break_is_retained_between_greedy_run_ranges() {
    let lines = layout_greedy_lines(&exact_segments("a\nb"), 200.0);

    assert_forced_break(&lines);
}

#[test]
fn forced_break_is_retained_between_optimal_run_ranges() {
    let lines = layout_optimal_lines(&exact_segments("a\nb"), 200.0);

    assert_forced_break(&lines);
}

#[test]
fn greedy_discretionary_hyphen_is_typed_unavailable() {
    let mut segments = exact_segments("Nokyoushitsue");
    let InlineSegment::Text(segment) = &mut segments[0] else {
        unreachable!();
    };
    segment
        .style
        .insert("language".to_owned(), Value::String("ja".to_owned()));
    let lines = layout_greedy_lines(&segments, 66.0);
    let hyphenated = text_runs(&lines)
        .into_iter()
        .find(|run| run.text.ends_with('-'))
        .expect("hyphenated run");

    assert_eq!(
        hyphenated.text_mapping,
        RunTextMapping::Unavailable(TextMappingUnavailableReason::SyntheticLayoutText)
    );
}

#[test]
fn optimal_discretionary_hyphen_is_typed_unavailable() {
    let lines = layout_optimal_lines(&exact_segments("hyphenation"), 36.0);
    let hyphenated = text_runs(&lines)
        .into_iter()
        .find(|run| run.text.ends_with('-'))
        .expect("hyphenated run");

    assert_eq!(
        hyphenated.text_mapping,
        RunTextMapping::Unavailable(TextMappingUnavailableReason::SyntheticLayoutText)
    );
}

#[test]
fn pagination_split_keeps_the_same_flow_allocation() {
    let lines = layout_greedy_lines(&exact_segments("a\nb\nc\nd"), 200.0);
    let height = lines.last().map_or(0.0, |line| line.y + line.height);
    let block = RuntimeBlock {
        x: 0.0,
        y: 0.0,
        width: 200.0,
        height,
        semantic_tag: Some("p".to_owned()),
        anchor_id: None,
        paint: None,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: lines.into_iter().map(RuntimeChild::Line).collect(),
    };
    let pages = paginate_continuous_blocks(vec![block], &pagination_config(), None);
    let page_runs = pages
        .iter()
        .flat_map(|page| &page.content)
        .flat_map(|block| &block.children)
        .filter_map(|child| match child {
            RuntimeChild::Line(line) => text_runs(std::slice::from_ref(line)).first().copied(),
            RuntimeChild::Block(_) | RuntimeChild::Image(_) | RuntimeChild::Hr(_) => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(pages.len(), 2);
    assert!(Arc::ptr_eq(
        &exact_run_slice(page_runs[0]).flow,
        &exact_run_slice(page_runs[2]).flow
    ));
}

fn assert_soft_wrap(lines: &[LineBox]) {
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].text(), "one");
    assert_eq!(lines[1].text(), "two");
    let runs = text_runs(lines);
    let first = exact_run_slice(runs[0]);
    let second = exact_run_slice(runs[1]);
    assert!(Arc::ptr_eq(&first.flow, &second.flow));
    assert_eq!(first.flow.text(), "one two");
    assert_eq!((first.logical_start, first.logical_end), (0, 3));
    assert_eq!((second.logical_start, second.logical_end), (4, 7));
}

fn assert_forced_break(lines: &[LineBox]) {
    assert_eq!(lines.len(), 2);
    let runs = text_runs(lines);
    let first = exact_run_slice(runs[0]);
    let second = exact_run_slice(runs[1]);
    assert!(Arc::ptr_eq(&first.flow, &second.flow));
    assert_eq!(first.flow.text(), "a\nb");
    assert_eq!((first.logical_start, first.logical_end), (0, 1));
    assert_eq!((second.logical_start, second.logical_end), (2, 3));
}

fn exact_segments(text: &str) -> Vec<InlineSegment> {
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
        source_text: Some(text.to_owned()),
        source_text_offset: None,
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    })];
    finalize_inline_text_flow(&mut segments);
    segments
}

fn text_runs(lines: &[LineBox]) -> Vec<&TextRunBox> {
    lines
        .iter()
        .flat_map(|line| &line.runs)
        .filter_map(|run| match run {
            LineRun::Text(run) => Some(run),
            LineRun::Atom(_) | LineRun::Ruby(_) => None,
        })
        .collect()
}

fn exact_run_slice(run: &TextRunBox) -> &TextFlowSlice {
    let RunTextMapping::Exact(slice) = &run.text_mapping else {
        panic!("exact run mapping expected");
    };
    slice
}

fn pagination_config() -> crate::layout::LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 200.0,
        height: 24.0,
        margin: MarginInput::All(0.0),
        spread: SpreadMode::Single,
        first_page_alone: false,
        spread_gap: 0.0,
        root_font_size: 10.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    })
}
