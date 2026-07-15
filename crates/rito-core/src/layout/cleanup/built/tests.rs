use std::{
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use serde_json::json;

use super::{BuiltLayoutCleanupStage, PendingBuiltLayoutCleanup};
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    create_empty_runtime_layout, create_layout_config,
    page::RuntimePage,
    LayoutConfig, LayoutConfigInput, LineBox, MarginInput, SpreadMode,
};

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn empty_layout_has_six_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingBuiltLayoutCleanup::new(empty_layout());
    let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 6);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
    assert_eq!(cleanup.advance(NonZeroUsize::MIN).consumed_units, 0);
}

#[test]
fn metadata_sizes_do_not_change_structural_units_or_release_order() {
    let mut owner = empty_layout();
    owner.chapter_start_pages.extend([0, 11, 99]);
    owner.summary.inline_segments.full_detail_hash = "diagnostic".repeat(128);
    let mut cleanup = PendingBuiltLayoutCleanup::new(owner);

    for _ in 0..3 {
        assert_one(&mut cleanup);
    }
    assert_eq!(cleanup.stage, BuiltLayoutCleanupStage::Pages);
    assert!(cleanup
        .pages
        .as_ref()
        .is_some_and(|pages| pages.is_complete()));

    assert_one(&mut cleanup);
    assert_eq!(cleanup.stage, BuiltLayoutCleanupStage::Summary);
    assert!(cleanup.summary.is_some());
    assert_eq!(
        cleanup
            .chapter_start_pages
            .as_ref()
            .map(|pages| pages.len()),
        Some(3)
    );

    assert_one(&mut cleanup);
    assert!(cleanup.summary.is_none());
    assert_one(&mut cleanup);
    assert!(cleanup.chapter_start_pages.is_none());
    assert!(cleanup.is_complete());
}

#[test]
fn one_empty_page_composes_page_vector_exactly() {
    let mut owner = empty_layout();
    owner
        .pages
        .push(RuntimePage::new(0, 320.0, 120.0, None, Vec::new()));
    let mut cleanup = PendingBuiltLayoutCleanup::new(owner);

    assert_eq!(drive_q1(&mut cleanup, 11), 11);
}

#[test]
fn deep_layout_is_exact_and_immediate_drop_is_stack_safe() {
    let mut cleanup = PendingBuiltLayoutCleanup::new(deep_layout());
    let expected = DEEP_BLOCK_COUNT * 2 + 12;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);
    drop(PendingBuiltLayoutCleanup::new(deep_layout()));
}

#[test]
fn partial_cleanup_drains_during_panic_unwind() {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingBuiltLayoutCleanup::new(deep_layout());
        let progress =
            cleanup.advance(NonZeroUsize::new(128).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force built-layout cleanup during unwind");
    }));

    assert!(result.is_err());
}

fn drive_q1(cleanup: &mut PendingBuiltLayoutCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "built-layout cleanup exceeded its bound");
        assert_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_one(cleanup: &mut PendingBuiltLayoutCleanup) {
    let progress = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(progress.consumed_units, 1);
}

fn empty_layout() -> crate::layout::BuiltLayout {
    create_empty_runtime_layout(1, &test_layout())
}

fn deep_layout() -> crate::layout::BuiltLayout {
    let mut layout = empty_layout();
    layout.pages.push(RuntimePage::new(
        0,
        320.0,
        120.0,
        Some(json!({ "backgroundColor": "#fff" })),
        vec![deep_block(DEEP_BLOCK_COUNT)],
    ));
    layout
}

fn deep_block(count: usize) -> RuntimeBlock<LineBox> {
    assert!(count > 0);
    let mut root = block(Vec::new());
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

fn test_layout() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 320.0,
        height: 120.0,
        margin: MarginInput::All(0.0),
        spread: SpreadMode::Single,
        first_page_alone: false,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    })
}
