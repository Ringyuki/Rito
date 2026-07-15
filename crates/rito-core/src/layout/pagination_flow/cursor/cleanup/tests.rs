use std::{num::NonZeroUsize, sync::Arc};

use serde_json::json;

use super::PendingContinuousPaginationSessionCleanup;
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    create_layout_config,
    line::{LineBox, LineRun, TextRunBox},
    page::RuntimePage,
    text_mapping::RunTextMapping,
    text_shape::fixture_run_shape,
    LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode,
};

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn empty_finished_and_unfinished_sessions_have_the_same_exact_units() {
    let layout = test_layout();
    let unfinished = super::super::ContinuousPaginationSession::new(&layout, None);
    let mut finished = super::super::ContinuousPaginationSession::new(&layout, None);
    let _ = finished.finish();

    for owner in [unfinished, finished] {
        let mut cleanup = PendingContinuousPaginationSessionCleanup::new(owner);
        let progress = cleanup.advance(NonZeroUsize::new(99).unwrap());

        assert_eq!(progress.consumed_units, 20);
        assert!(progress.complete);
        assert!(!cleanup.advance_one());
    }
}

#[test]
fn populated_session_composes_accumulator_config_and_owner_boundaries() {
    let mut layout = test_layout();
    layout.font_family_override = Some("Pinned Serif".to_owned());
    layout.generic_serif_advances.insert("中".to_owned(), 16.0);
    let mut owner = super::super::ContinuousPaginationSession::new(&layout, None);
    owner.state.pages.push(page(0, Vec::new()));
    owner.state.page_blocks.push(block(Vec::new()));
    let mut cleanup = PendingContinuousPaginationSessionCleanup::new(owner);

    for _ in 0..21 {
        assert_one(&mut cleanup);
    }
    let retained = cleanup
        .layout_config()
        .expect("layout config remains until its own unit");
    assert_eq!(
        retained.font_family_override.as_deref(),
        Some("Pinned Serif")
    );
    assert_eq!(retained.generic_serif_advances.len(), 1);
    for _ in 0..7 {
        assert_one(&mut cleanup);
    }
    assert!(cleanup.layout_config().is_none());
    assert!(cleanup
        .layout_config
        .as_ref()
        .is_some_and(super::PendingLayoutConfigCleanup::is_complete));
    assert_one(&mut cleanup);
    assert!(cleanup.layout_config.is_none());
    assert_one(&mut cleanup);
    assert!(cleanup.is_complete());
}

#[test]
fn scalar_session_flags_do_not_add_hidden_cleanup_units() {
    let layout = test_layout();
    let mut owner = super::super::ContinuousPaginationSession::new(&layout, None);
    owner.previous_block = Some(super::super::PreviousBlockGeometry {
        y: 12.0,
        height: 34.0,
    });
    owner.pagination_disabled = true;
    owner.finished = true;
    let mut cleanup = PendingContinuousPaginationSessionCleanup::new(owner);

    assert_eq!(drive_q1(&mut cleanup, 20), 20);
}

#[test]
fn partial_drop_from_open_page_drains_the_active_deep_block() {
    let source: Arc<str> = Arc::from("session source");
    let layout = test_layout();
    let mut owner = super::super::ContinuousPaginationSession::new(&layout, None);
    owner.state.page_blocks.push(deep_block(
        DEEP_BLOCK_COUNT,
        Some(line(Arc::clone(&source))),
    ));
    let mut cleanup = PendingContinuousPaginationSessionCleanup::new(owner);

    for _ in 0..8 {
        assert_one(&mut cleanup);
    }
    drop(cleanup);

    assert_eq!(Arc::strong_count(&source), 1);
}

#[test]
fn partial_drop_before_state_source_still_uses_the_iterative_cursor() {
    let source: Arc<str> = Arc::from("unopened session source");
    let layout = test_layout();
    let mut owner = super::super::ContinuousPaginationSession::new(&layout, None);
    owner.state.page_blocks.push(deep_block(
        DEEP_BLOCK_COUNT,
        Some(line(Arc::clone(&source))),
    ));
    let cleanup = PendingContinuousPaginationSessionCleanup::new(owner);

    drop(cleanup);

    assert_eq!(Arc::strong_count(&source), 1);
}

fn drive_q1(cleanup: &mut PendingContinuousPaginationSessionCleanup, limit: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < limit, "session cleanup exceeded its expected bound");
        assert_one(cleanup);
        steps += 1;
    }
    steps
}

fn assert_one(cleanup: &mut PendingContinuousPaginationSessionCleanup) {
    let progress = cleanup.advance(NonZeroUsize::new(1).unwrap());
    assert_eq!(progress.consumed_units, 1);
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

fn page(index: usize, content: Vec<RuntimeBlock<LineBox>>) -> RuntimePage<RuntimeBlock<LineBox>> {
    RuntimePage::new(index, 320.0, 120.0, None, content)
}

fn deep_block(count: usize, deepest_line: Option<LineBox>) -> RuntimeBlock<LineBox> {
    assert!(count > 0);
    let children = deepest_line.map(RuntimeChild::Line).into_iter().collect();
    let mut root = block(children);
    for _ in 1..count {
        root = block(vec![RuntimeChild::Block(Box::new(root))]);
    }
    root
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

fn line(source: Arc<str>) -> LineBox {
    LineBox {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        runs: vec![text_run(source)],
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
