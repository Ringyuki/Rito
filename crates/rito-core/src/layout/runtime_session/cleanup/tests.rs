use std::{
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use serde_json::{json, Map};

use super::PendingRuntimeChapterLayoutSessionCleanup;
use crate::{
    layout::{
        content::RuntimeBlock,
        create_layout_config,
        image_size::ImageSizeIndex,
        line::LineBox,
        pagination_session::{LayoutAdvanceStatus, LayoutWorkBudget},
        LayoutConfig, LayoutConfigInput, LineBreaking, MarginInput, SpreadMode,
        TextMeasurementFonts,
    },
    style::{StyledNode, StyledNodeKind},
};

const DEEP_NODE_COUNT: usize = 16_384;

#[test]
fn empty_finished_and_unfinished_sessions_have_the_same_exact_units() {
    let unfinished = empty_session();
    let mut finished = empty_session();
    let advance = finished.advance(
        LayoutWorkBudget::new(NonZeroUsize::MIN),
        &TextMeasurementFonts::empty(),
    );
    assert_eq!(advance.status, LayoutAdvanceStatus::Complete);

    for owner in [unfinished, finished] {
        let mut cleanup = PendingRuntimeChapterLayoutSessionCleanup::new(owner);
        let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

        assert_eq!(progress.consumed_units, 39);
        assert!(progress.complete);
        assert!(!cleanup.advance_one());
        assert_eq!(cleanup.advance(NonZeroUsize::MIN).consumed_units, 0);
    }
}

#[test]
fn deep_pending_layout_forest_composes_exactly_after_empty_pagination() {
    let mut cleanup = PendingRuntimeChapterLayoutSessionCleanup::new(session(vec![deep_tree()]));
    let expected = 39 + DEEP_NODE_COUNT * 2 - 1;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);
}

#[test]
fn open_pagination_block_composes_before_the_empty_layout_session() {
    let mut owner = empty_session();
    let pushed = owner.pagination.push_blocks(vec![empty_block()]);
    assert_eq!(pushed.processed_blocks, 1);
    let mut cleanup = PendingRuntimeChapterLayoutSessionCleanup::new(owner);

    assert_eq!(drive_q1(&mut cleanup, 43), 43);
}

#[test]
fn immediate_and_partial_unwind_drops_drain_the_nested_layout_cursor() {
    drop(PendingRuntimeChapterLayoutSessionCleanup::new(session(
        vec![deep_tree()],
    )));

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup =
            PendingRuntimeChapterLayoutSessionCleanup::new(session(vec![deep_tree()]));
        let progress =
            cleanup.advance(NonZeroUsize::new(128).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force chapter cleanup during unwind");
    }));

    assert!(result.is_err());
}

#[test]
fn pagination_retirement_and_layout_source_boundaries_are_drop_safe() {
    for consumed in [21, 22, 23] {
        let mut cleanup =
            PendingRuntimeChapterLayoutSessionCleanup::new(session(vec![deep_tree()]));
        let progress =
            cleanup.advance(NonZeroUsize::new(consumed).expect("test cleanup budget is non-zero"));

        assert_eq!(progress.consumed_units, consumed);
        assert!(!progress.complete);
        drop(cleanup);
    }
}

fn drive_q1(cleanup: &mut PendingRuntimeChapterLayoutSessionCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(
            steps < expected,
            "chapter cleanup exceeded its expected bound"
        );
        let progress = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn empty_session() -> super::super::RuntimeChapterLayoutSession {
    session(Vec::new())
}

fn session(nodes: Vec<StyledNode>) -> super::super::RuntimeChapterLayoutSession {
    let layout = test_layout();
    super::super::RuntimeChapterLayoutSession::new(
        nodes,
        ImageSizeIndex::new(&[]),
        &layout,
        LineBreaking::Greedy,
        None,
    )
}

fn deep_tree() -> StyledNode {
    let mut root = node(Vec::new());
    for _ in 1..DEEP_NODE_COUNT {
        root = node(vec![root]);
    }
    root
}

fn node(children: Vec<StyledNode>) -> StyledNode {
    StyledNode {
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
        style: Map::new(),
        children,
        source_ref: None,
    }
}

fn empty_block() -> RuntimeBlock<LineBox> {
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
        children: Vec::new(),
    }
}

fn test_layout() -> LayoutConfig {
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
