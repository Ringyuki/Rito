use std::{num::NonZeroUsize, sync::Arc};

use serde_json::json;

use super::{PendingRuntimePageCleanup, PendingRuntimePageVectorCleanup};
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, TextRunBox},
    page::RuntimePage,
    text_mapping::RunTextMapping,
    text_shape::fixture_run_shape,
};

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn empty_page_has_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingRuntimePageCleanup::new(page(0, Vec::new()));
    let progress = cleanup.advance(NonZeroUsize::new(99).unwrap());

    assert_eq!(progress.consumed_units, 4);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
    assert_eq!(
        cleanup.advance(NonZeroUsize::new(1).unwrap()),
        crate::layout::CleanupProgress {
            consumed_units: 0,
            complete: true,
        }
    );
}

#[test]
fn block_retirement_source_retirement_paint_and_owner_are_distinct() {
    let mut cleanup = PendingRuntimePageCleanup::new(page(0, vec![block(Vec::new())]));

    for _ in 0..6 {
        assert_one_page(&mut cleanup);
    }
    assert!(cleanup.owner().paint.is_some());
    assert_one_page(&mut cleanup);
    assert!(cleanup.owner().paint.is_none());
    assert_one_page(&mut cleanup);
    assert!(cleanup.is_complete());
}

#[test]
fn deep_page_delegates_every_block_unit_without_recursive_drop() {
    let mut cleanup =
        PendingRuntimePageCleanup::new(page(0, vec![deep_block(DEEP_BLOCK_COUNT, None)]));

    assert_eq!(
        drive_page_q1(&mut cleanup, DEEP_BLOCK_COUNT * 2 + 5),
        DEEP_BLOCK_COUNT * 2 + 5
    );
}

#[test]
fn empty_page_vector_has_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingRuntimePageVectorCleanup::new(Vec::new());
    let progress = cleanup.advance(NonZeroUsize::new(99).unwrap());

    assert_eq!(progress.consumed_units, 2);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
}

#[test]
fn page_vector_accounts_for_each_page_and_nested_retirement() {
    let pages = vec![page(0, Vec::new()), page(1, vec![block(Vec::new())])];
    let mut cleanup = PendingRuntimePageVectorCleanup::new(pages);

    assert_eq!(drive_vector_q1(&mut cleanup, 16), 16);
    assert!(!cleanup.advance_one());
}

#[test]
fn partial_vector_drop_drains_active_and_unread_deep_pages() {
    let source: Arc<str> = Arc::from("shared source");
    let deepest_line = LineBox {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        runs: vec![text_run(Arc::clone(&source))],
    };
    let pages = vec![
        page(0, Vec::new()),
        page(1, vec![deep_block(DEEP_BLOCK_COUNT, Some(deepest_line))]),
    ];
    let mut cleanup = PendingRuntimePageVectorCleanup::new(pages);

    for _ in 0..3 {
        assert_one_vector(&mut cleanup);
    }
    assert_eq!(Arc::strong_count(&source), 2);
    drop(cleanup);

    assert_eq!(Arc::strong_count(&source), 1);
}

fn drive_page_q1(cleanup: &mut PendingRuntimePageCleanup, limit: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < limit, "page cleanup exceeded its expected bound");
        assert_one_page(cleanup);
        steps += 1;
    }
    steps
}

fn drive_vector_q1(cleanup: &mut PendingRuntimePageVectorCleanup, limit: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(
            steps < limit,
            "page vector cleanup exceeded its expected bound"
        );
        assert_one_vector(cleanup);
        steps += 1;
    }
    steps
}

fn assert_one_page(cleanup: &mut PendingRuntimePageCleanup) {
    let progress = cleanup.advance(NonZeroUsize::new(1).unwrap());
    assert_eq!(progress.consumed_units, 1);
}

fn assert_one_vector(cleanup: &mut PendingRuntimePageVectorCleanup) {
    let progress = cleanup.advance(NonZeroUsize::new(1).unwrap());
    assert_eq!(progress.consumed_units, 1);
}

fn page(index: usize, content: Vec<RuntimeBlock<LineBox>>) -> RuntimePage<RuntimeBlock<LineBox>> {
    RuntimePage::new(
        index,
        600.0,
        800.0,
        Some(json!({ "backgroundColor": "#fff" })),
        content,
    )
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

fn text_run(source: Arc<str>) -> LineRun {
    LineRun::Text(TextRunBox {
        text: "text".to_owned(),
        text_mapping: RunTextMapping::synthetic(),
        x: 0.0,
        y: 0.0,
        width: 20.0,
        height: 12.0,
        font_size: 12.0,
        interaction_geometry: None,
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
