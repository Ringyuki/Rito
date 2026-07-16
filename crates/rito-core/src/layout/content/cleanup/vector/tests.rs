use std::{num::NonZeroUsize, sync::Arc};

use serde_json::json;

use super::PendingRuntimeBlockVectorCleanup;
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, TextRunBox},
    text_mapping::RunTextMapping,
    text_shape::fixture_run_shape,
};

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn empty_vector_has_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingRuntimeBlockVectorCleanup::new(Vec::new());
    let progress = cleanup.advance(NonZeroUsize::new(99).unwrap());

    assert_eq!(progress.consumed_units, 2);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
}

#[test]
fn vector_accounts_for_each_block_and_nested_retirement() {
    let blocks = vec![block(Vec::new()), block(Vec::new())];
    let mut cleanup = PendingRuntimeBlockVectorCleanup::new(blocks);

    assert_eq!(drive_q1(&mut cleanup, 10), 10);
    assert!(!cleanup.advance_one());
}

#[test]
fn partial_drop_drains_active_and_unread_deep_blocks() {
    let source: Arc<str> = Arc::from("shared source");
    let deepest_line = LineBox {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        runs: vec![text_run(Arc::clone(&source))],
    };
    let blocks = vec![
        block(Vec::new()),
        deep_block(DEEP_BLOCK_COUNT, Some(deepest_line)),
    ];
    let mut cleanup = PendingRuntimeBlockVectorCleanup::new(blocks);

    for _ in 0..5 {
        assert_one(&mut cleanup);
    }
    assert_eq!(Arc::strong_count(&source), 2);
    drop(cleanup);

    assert_eq!(Arc::strong_count(&source), 1);
}

fn drive_q1(cleanup: &mut PendingRuntimeBlockVectorCleanup, limit: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < limit, "block vector exceeded its expected bound");
        assert_one(cleanup);
        steps += 1;
    }
    steps
}

fn assert_one(cleanup: &mut PendingRuntimeBlockVectorCleanup) {
    let progress = cleanup.advance(NonZeroUsize::new(1).unwrap());
    assert_eq!(progress.consumed_units, 1);
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
