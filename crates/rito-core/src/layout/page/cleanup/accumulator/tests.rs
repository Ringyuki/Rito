use std::{num::NonZeroUsize, sync::Arc};

use serde_json::json;

use super::PendingRuntimePageAccumulatorCleanup;
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, TextRunBox},
    page::{RuntimePage, RuntimePageAccumulator},
    text_mapping::RunTextMapping,
    text_shape::fixture_run_shape,
};

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn empty_accumulator_has_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingRuntimePageAccumulatorCleanup::new(accumulator());
    let progress = cleanup.advance(NonZeroUsize::new(99).unwrap());

    assert_eq!(progress.consumed_units, 10);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
}

#[test]
fn sealed_page_accounts_for_both_nested_vector_retirements() {
    let mut owner = accumulator();
    owner.pages.push(page(0, Vec::new()));
    let mut cleanup = PendingRuntimePageAccumulatorCleanup::new(owner);

    assert_eq!(drive_q1(&mut cleanup, 15), 15);
}

#[test]
fn open_block_accounts_for_both_nested_vector_retirements() {
    let mut owner = accumulator();
    owner.page_blocks.push(block(Vec::new()));
    let mut cleanup = PendingRuntimePageAccumulatorCleanup::new(owner);

    assert_eq!(drive_q1(&mut cleanup, 14), 14);
}

#[test]
fn page_paint_and_accumulator_owner_have_distinct_boundaries() {
    let mut owner = accumulator();
    owner.pages.push(page(0, Vec::new()));
    owner.page_blocks.push(block(Vec::new()));
    let mut cleanup = PendingRuntimePageAccumulatorCleanup::new(owner);

    for _ in 0..17 {
        assert_one(&mut cleanup);
    }
    assert!(cleanup.owner().page_paint.is_some());
    assert_one(&mut cleanup);
    assert!(cleanup.owner().page_paint.is_none());
    assert_one(&mut cleanup);
    assert!(cleanup.is_complete());
}

#[test]
fn partial_drop_from_a_sealed_page_drains_unread_pages_and_open_blocks() {
    let active_source: Arc<str> = Arc::from("active page");
    let unread_source: Arc<str> = Arc::from("unread page");
    let open_source: Arc<str> = Arc::from("open page");
    let mut owner = accumulator();
    owner.pages = vec![
        page(
            0,
            vec![deep_block(
                DEEP_BLOCK_COUNT,
                Some(line(Arc::clone(&active_source))),
            )],
        ),
        page(
            1,
            vec![deep_block(
                DEEP_BLOCK_COUNT,
                Some(line(Arc::clone(&unread_source))),
            )],
        ),
    ];
    owner.page_blocks.push(deep_block(
        DEEP_BLOCK_COUNT,
        Some(line(Arc::clone(&open_source))),
    ));
    let mut cleanup = PendingRuntimePageAccumulatorCleanup::new(owner);

    for _ in 0..4 {
        assert_one(&mut cleanup);
    }
    drop(cleanup);

    assert_eq!(Arc::strong_count(&active_source), 1);
    assert_eq!(Arc::strong_count(&unread_source), 1);
    assert_eq!(Arc::strong_count(&open_source), 1);
}

#[test]
fn partial_drop_from_the_open_page_drains_the_active_block() {
    let source: Arc<str> = Arc::from("open page");
    let mut owner = accumulator();
    owner.page_blocks.push(deep_block(
        DEEP_BLOCK_COUNT,
        Some(line(Arc::clone(&source))),
    ));
    let mut cleanup = PendingRuntimePageAccumulatorCleanup::new(owner);

    for _ in 0..7 {
        assert_one(&mut cleanup);
    }
    drop(cleanup);

    assert_eq!(Arc::strong_count(&source), 1);
}

fn drive_q1(cleanup: &mut PendingRuntimePageAccumulatorCleanup, limit: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < limit, "accumulator exceeded its expected bound");
        assert_one(cleanup);
        steps += 1;
    }
    steps
}

fn assert_one(cleanup: &mut PendingRuntimePageAccumulatorCleanup) {
    let progress = cleanup.advance(NonZeroUsize::new(1).unwrap());
    assert_eq!(progress.consumed_units, 1);
}

fn accumulator() -> RuntimePageAccumulator<RuntimeBlock<LineBox>> {
    RuntimePageAccumulator::new(600.0, 800.0, Some(json!({ "backgroundColor": "#fff" })))
}

fn page(index: usize, content: Vec<RuntimeBlock<LineBox>>) -> RuntimePage<RuntimeBlock<LineBox>> {
    RuntimePage::new(index, 600.0, 800.0, None, content)
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
