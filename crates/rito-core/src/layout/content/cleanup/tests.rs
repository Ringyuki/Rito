use std::{num::NonZeroUsize, sync::Arc};

use serde_json::json;

use super::PendingRuntimeBlockCleanup;
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild, RuntimeHorizontalRule, RuntimeImage},
    line::{AtomRunBox, LineBox, LineRun, RubyRunBox, TextRunBox},
    text_mapping::RunTextMapping,
    text_shape::fixture_run_shape,
};

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn empty_cleanup_has_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingRuntimeBlockCleanup::new(block(Vec::new()));
    let progress = cleanup.advance(NonZeroUsize::new(99).unwrap());

    assert_eq!(progress.consumed_units, 3);
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
fn deep_block_tree_is_exact_and_reuses_existing_carrier_capacity() {
    let mut cleanup = PendingRuntimeBlockCleanup::new(deep_block(DEEP_BLOCK_COUNT, None));

    assert_eq!(
        drive_q1(&mut cleanup, DEEP_BLOCK_COUNT * 2),
        DEEP_BLOCK_COUNT * 2
    );
    assert_eq!(cleanup.carrier_push_stats(), (DEEP_BLOCK_COUNT - 2, 0));
}

#[test]
fn wide_block_tree_releases_one_owner_per_unit_without_carriers() {
    let children = (0..DEEP_BLOCK_COUNT)
        .map(|_| RuntimeChild::Block(Box::new(block(Vec::new()))))
        .collect();
    let mut cleanup = PendingRuntimeBlockCleanup::new(block(children));

    assert_eq!(
        drive_q1(&mut cleanup, DEEP_BLOCK_COUNT + 3),
        DEEP_BLOCK_COUNT + 3
    );
    assert_eq!(cleanup.carrier_push_stats(), (0, 0));
}

#[test]
fn line_runs_images_and_rules_each_release_at_an_explicit_boundary() {
    let source: Arc<str> = Arc::from("shared source");
    let line = LineBox {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        runs: vec![
            text_run(Arc::clone(&source)),
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
    };
    let children = vec![
        RuntimeChild::Line(line),
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
    let mut cleanup = PendingRuntimeBlockCleanup::new(block(children));

    assert_eq!(Arc::strong_count(&source), 2);
    assert_eq!(drive_q1(&mut cleanup, 11), 11);
    assert_eq!(Arc::strong_count(&source), 1);
}

#[test]
fn a_text_run_is_not_released_by_root_or_line_source_transitions() {
    let source: Arc<str> = Arc::from("shared source");
    let line = LineBox {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        runs: vec![text_run(Arc::clone(&source))],
    };
    let mut cleanup = PendingRuntimeBlockCleanup::new(block(vec![RuntimeChild::Line(line)]));

    assert_one(&mut cleanup);
    assert_eq!(Arc::strong_count(&source), 2);
    assert_one(&mut cleanup);
    assert_eq!(Arc::strong_count(&source), 2);
    assert_one(&mut cleanup);
    assert_eq!(Arc::strong_count(&source), 1);
    assert_eq!(drive_q1(&mut cleanup, 4), 4);
}

#[test]
fn partial_cursor_drop_drains_the_same_deep_state_without_recursion() {
    let source: Arc<str> = Arc::from("shared source");
    let cleanup = deep_block(
        DEEP_BLOCK_COUNT,
        Some(LineBox {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 20.0,
            runs: vec![text_run(Arc::clone(&source))],
        }),
    );
    let mut cleanup = PendingRuntimeBlockCleanup::new(cleanup);

    for _ in 0..DEEP_BLOCK_COUNT / 2 {
        assert_one(&mut cleanup);
    }
    drop(cleanup);

    assert_eq!(Arc::strong_count(&source), 1);
}

fn drive_q1(cleanup: &mut PendingRuntimeBlockCleanup, limit: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < limit, "cleanup exceeded its expected unit bound");
        assert_one(cleanup);
        steps += 1;
    }
    steps
}

fn assert_one(cleanup: &mut PendingRuntimeBlockCleanup) {
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
