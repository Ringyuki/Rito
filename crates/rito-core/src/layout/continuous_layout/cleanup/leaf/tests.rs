use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::Arc,
};

use serde_json::{json, Map};

use super::PendingContinuousLeafCleanup;
use crate::{
    layout::{
        content::{RuntimeBlock, RuntimeChild},
        continuous_layout::{
            ContinuousLeafLayoutSession, ContinuousLeafTextState, HorizontalMetrics,
            TextBlockMetrics,
        },
        inline_content::PendingInlineCandidateCollector,
        line::{LineBox, LineRun, TextRunBox},
        line_layout::GreedyLineLayoutSession,
        text_mapping::RunTextMapping,
        text_shape::fixture_run_shape,
    },
    style::{StyledNode, StyledNodeKind},
};

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn empty_leaf_has_exact_units() {
    let mut cleanup = PendingContinuousLeafCleanup::new(leaf(None, Vec::new()));

    assert_eq!(drive_q1(&mut cleanup, 5), 5);
}

#[test]
fn atomic_text_state_has_source_and_payload_units() {
    let text = ContinuousLeafTextState::LayoutLines(GreedyLineLayoutSession::empty(7));
    let mut cleanup = PendingContinuousLeafCleanup::new(leaf(Some(text), Vec::new()));

    assert_eq!(drive_q1(&mut cleanup, 6), 6);
}

#[test]
fn collecting_text_composes_the_candidate_cursor_and_retirement() {
    let collector = PendingInlineCandidateCollector::new(Vec::new(), None, None);
    let text = ContinuousLeafTextState::Collecting(Box::new(collector));
    let mut cleanup = PendingContinuousLeafCleanup::new(leaf(Some(text), Vec::new()));

    assert_eq!(drive_q1(&mut cleanup, 24), 24);
}

#[test]
fn completed_line_children_use_the_direct_child_vector_budget() {
    let children = vec![RuntimeChild::Line(LineBox {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        runs: Vec::new(),
    })];
    let mut cleanup = PendingContinuousLeafCleanup::new(leaf(None, children));

    assert_eq!(drive_q1(&mut cleanup, 8), 8);
}

#[test]
fn partial_leaf_drop_drains_deep_completed_children_during_unwind() {
    let source: Arc<str> = Arc::from("shared source");
    let result = catch_unwind(AssertUnwindSafe(|| {
        let line = LineBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 20.0,
            runs: vec![text_run(Arc::clone(&source))],
        };
        let child = deep_child_chain(DEEP_BLOCK_COUNT, line);
        let mut cleanup = PendingContinuousLeafCleanup::new(leaf(None, vec![child]));
        for _ in 0..128 {
            assert!(cleanup.advance_one());
        }
        panic!("force leaf cleanup during unwind");
    }));

    assert!(result.is_err());
    assert_eq!(Arc::strong_count(&source), 1);
}

fn drive_q1(cleanup: &mut PendingContinuousLeafCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "leaf cleanup exceeded its expected bound");
        assert!(cleanup.advance_one());
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn leaf(
    text_state: Option<ContinuousLeafTextState>,
    completed_children: Vec<RuntimeChild<LineBox>>,
) -> Box<ContinuousLeafLayoutSession> {
    Box::new(ContinuousLeafLayoutSession {
        node: styled_leaf(),
        container_width: 100.0,
        block_width: 100.0,
        y: 0.0,
        horizontal: HorizontalMetrics {
            margin_left: 0.0,
            margin_right: 0.0,
            target_width: 100.0,
        },
        extra_left: 0.0,
        metrics: TextBlockMetrics {
            padding_top: 0.0,
            padding_bottom: 0.0,
            padding_left: 0.0,
            border_top: 0.0,
            border_bottom: 0.0,
            border_left: 0.0,
            inner_width: 100.0,
        },
        line_width: 100.0,
        font_profile_id: 7,
        text_state,
        completed_children,
        child_bottom: 0.0,
    })
}

fn styled_leaf() -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Block,
        tag: Some("p".to_owned()),
        content: None,
        source_text: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: Map::new(),
        children: Vec::new(),
        source_ref: None,
    }
}

fn deep_child_chain(count: usize, deepest_line: LineBox) -> RuntimeChild<LineBox> {
    assert!(count > 0);
    let mut root = block(vec![RuntimeChild::Line(deepest_line)]);
    for _ in 1..count {
        root = block(vec![RuntimeChild::Block(Box::new(root))]);
    }
    RuntimeChild::Block(Box::new(root))
}

fn block(children: Vec<RuntimeChild<LineBox>>) -> RuntimeBlock<LineBox> {
    RuntimeBlock {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        semantic_tag: Some("p".to_owned()),
        anchor_id: None,
        paint: Some(json!({ "color": "#000" })),
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children,
    }
}

fn text_run(source: Arc<str>) -> LineRun {
    LineRun::Text(TextRunBox {
        text: "text".to_owned(),
        text_mapping: RunTextMapping::synthetic(),
        x: 0.0,
        y: 0.0,
        width: 20.0,
        height: 12.0,
        font_size: 12.0,
        paint: json!({ "color": "#000" }),
        line_height_px: None,
        href: None,
        source_path: None,
        source_text: Some(source),
        source_text_offset: Some(0),
        inline_margin_right: None,
        ruby_annotation: None,
        shape: fixture_run_shape(20.0),
    })
}
