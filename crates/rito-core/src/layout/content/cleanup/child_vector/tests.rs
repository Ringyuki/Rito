use std::{
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::Arc,
};

use serde_json::json;

use super::PendingRuntimeChildVectorCleanup;
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild, RuntimeHorizontalRule, RuntimeImage},
    line::{AtomRunBox, LineBox, LineRun, RubyRunBox, TextRunBox},
    text_mapping::RunTextMapping,
    text_shape::fixture_run_shape,
};

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn empty_vector_has_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingRuntimeChildVectorCleanup::new(Vec::new());
    let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 2);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
}

#[test]
fn mixed_children_account_for_line_runs_and_leaf_payloads() {
    let source: Arc<str> = Arc::from("shared source");
    let children = vec![
        RuntimeChild::Line(line_with_three_runs(Arc::clone(&source))),
        RuntimeChild::Image(RuntimeImage {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
            src: "image.png".to_owned(),
            alt: None,
            href: None,
        }),
        RuntimeChild::Hr(RuntimeHorizontalRule {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 1.0,
            color: "#000".to_owned(),
            style: "solid".to_owned(),
        }),
    ];
    let mut cleanup = PendingRuntimeChildVectorCleanup::new(children);

    assert_eq!(Arc::strong_count(&source), 2);
    assert_eq!(drive_q1(&mut cleanup, 10), 10);
    assert_eq!(Arc::strong_count(&source), 1);
}

#[test]
fn deep_block_forest_is_exact_without_a_synthetic_root() {
    let mut cleanup =
        PendingRuntimeChildVectorCleanup::new(vec![deep_child_chain(DEEP_BLOCK_COUNT, None)]);

    assert_eq!(
        drive_q1(&mut cleanup, DEEP_BLOCK_COUNT * 2 + 1),
        DEEP_BLOCK_COUNT * 2 + 1
    );
}

#[test]
fn partial_drop_drains_deep_children_during_unwind() {
    let source: Arc<str> = Arc::from("shared source");
    let result = catch_unwind(AssertUnwindSafe(|| {
        let line = LineBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 20.0,
            runs: vec![text_run(Arc::clone(&source))],
        };
        let mut cleanup = PendingRuntimeChildVectorCleanup::new(vec![deep_child_chain(
            DEEP_BLOCK_COUNT,
            Some(line),
        )]);
        let progress = cleanup
            .advance(NonZeroUsize::new(DEEP_BLOCK_COUNT / 2).expect("test budget is non-zero"));
        assert_eq!(progress.consumed_units, DEEP_BLOCK_COUNT / 2);
        panic!("force cleanup during unwind");
    }));

    assert!(result.is_err());
    assert_eq!(Arc::strong_count(&source), 1);
}

fn drive_q1(cleanup: &mut PendingRuntimeChildVectorCleanup, limit: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < limit, "cleanup exceeded its expected unit bound");
        let progress = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        steps += 1;
    }
    steps
}

fn deep_child_chain(count: usize, deepest_line: Option<LineBox>) -> RuntimeChild<LineBox> {
    assert!(count > 0);
    let children = deepest_line.map(RuntimeChild::Line).into_iter().collect();
    let mut root = block(children);
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

fn line_with_three_runs(source: Arc<str>) -> LineBox {
    LineBox {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        runs: vec![
            text_run(source),
            LineRun::Atom(AtomRunBox {
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 10.0,
                image_src: Some("atom.png".to_owned()),
                alt: Some("atom".to_owned()),
                href: None,
            }),
            LineRun::Ruby(RubyRunBox {
                text: "ruby".to_owned(),
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 5.0,
                paint: json!({ "color": "#000" }),
            }),
        ],
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
