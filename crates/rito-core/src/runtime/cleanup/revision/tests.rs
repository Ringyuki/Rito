use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use serde_json::json;

use super::{PendingRuntimeRevisionCleanup, RuntimeRevisionCleanupStage};
use crate::{
    layout::{
        create_empty_runtime_layout, create_layout_config, LayoutConfig, LayoutConfigInput,
        LayoutRuntimePage, LineBox, MarginInput, RuntimeBlock, RuntimeChild, SpreadMode,
    },
    runtime::{
        frame::{RuntimeChapterTextIndexSource, RuntimeRevision, RuntimeRevisionInteractions},
        RuntimeRequiredFontFace, RuntimeRevisionExtent, RuntimeRevisionStatus,
    },
};

use super::super::test_support::cached_frame;

const DEEP_BLOCK_COUNT: usize = 16_384;

#[test]
fn empty_revision_has_sixteen_exact_units_for_all_shell_values() {
    for status in [
        RuntimeRevisionStatus::Warming,
        RuntimeRevisionStatus::Ready,
        RuntimeRevisionStatus::Complete,
        RuntimeRevisionStatus::Cancelled,
        RuntimeRevisionStatus::Failed,
    ] {
        for has_final_extent in [false, true] {
            for has_font_catalog in [false, true] {
                let mut owner = revision(empty_layout());
                owner.revision_version = u32::MAX;
                owner.status = status;
                owner.known_extent = RuntimeRevisionExtent {
                    page_count: usize::MAX,
                    spread_count: usize::MAX,
                };
                owner.final_extent = has_final_extent.then_some(owner.known_extent);
                owner.required_font_face_catalog = has_font_catalog.then(|| vec![font_face()]);
                let mut cleanup = PendingRuntimeRevisionCleanup::new(owner);

                assert_eq!(drive_q1(&mut cleanup, 16), 16);
            }
        }
    }
}

#[test]
fn cache_layout_and_flat_fields_release_in_order() {
    let mut owner = revision(empty_layout());
    owner.frame_cache.insert(9, cached_frame(9, 3));
    owner.frame_cache.insert(2, cached_frame(2, 0));
    owner.frame_cache_order.extend([9, 2]);
    owner.layout_config.font_family_override = Some("Pinned Serif".to_owned());
    owner.required_font_face_catalog = Some(vec![font_face()]);
    owner
        .interactions
        .completed_chapter_idrefs
        .insert("chapter".to_owned());
    let mut cleanup = PendingRuntimeRevisionCleanup::new(owner);

    assert_one(&mut cleanup);
    assert_eq!(cleanup.stage, RuntimeRevisionCleanupStage::FrameCache);
    for _ in 0..5 {
        assert_one(&mut cleanup);
    }
    assert!(cleanup
        .frame_cache
        .as_ref()
        .is_some_and(|cache| cache.is_complete()));
    assert!(cleanup.layout.is_some());

    assert_one(&mut cleanup);
    assert!(cleanup.frame_cache.is_none());
    assert_eq!(cleanup.stage, RuntimeRevisionCleanupStage::Layout);

    assert_eq!(drive_q1(&mut cleanup, 11), 11);
}

#[test]
fn detached_cache_owner_is_immediately_invisible_to_the_revision() {
    let mut owner = revision(empty_layout());
    owner.frame_cache.insert(9, cached_frame(9, 3));
    owner.frame_cache.insert(2, cached_frame(2, 0));
    owner.frame_cache_order.extend([9, 2]);

    let detached = owner.take_frame_cache();

    assert!(owner.frame_cache.is_empty());
    assert!(owner.frame_cache_order.is_empty());
    assert_eq!(detached.frames.len(), 2);
    assert_eq!(detached.order.len(), 2);
    drop(detached);
    drop(PendingRuntimeRevisionCleanup::new(owner));
}

#[test]
fn layout_retirement_is_separate_from_its_nested_completion() {
    let mut cleanup = PendingRuntimeRevisionCleanup::new(revision(empty_layout()));

    for _ in 0..11 {
        assert_one(&mut cleanup);
    }
    assert_eq!(cleanup.stage, RuntimeRevisionCleanupStage::Layout);
    assert!(cleanup
        .layout
        .as_ref()
        .is_some_and(|layout| layout.is_complete()));

    assert_one(&mut cleanup);
    assert!(cleanup.layout.is_none());
    assert_eq!(cleanup.stage, RuntimeRevisionCleanupStage::LayoutConfig);
    assert_eq!(drive_q1(&mut cleanup, 4), 4);
}

#[test]
fn one_empty_page_composes_built_layout_exactly() {
    let mut layout = empty_layout();
    layout
        .pages
        .push(LayoutRuntimePage::new(0, 320.0, 120.0, None, Vec::new()));
    let mut cleanup = PendingRuntimeRevisionCleanup::new(revision(layout));

    assert_eq!(drive_q1(&mut cleanup, 21), 21);
}

#[test]
fn deep_revision_is_exact_and_immediate_drop_is_stack_safe() {
    let mut cleanup = PendingRuntimeRevisionCleanup::new(revision(deep_layout()));
    let expected = DEEP_BLOCK_COUNT * 2 + 22;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);
    drop(PendingRuntimeRevisionCleanup::new(revision(deep_layout())));
}

#[test]
fn source_boundary_and_partial_panic_unwind_drain_the_deep_owner() {
    let mut source_boundary = PendingRuntimeRevisionCleanup::new(revision(deep_layout()));
    assert_one(&mut source_boundary);
    drop(source_boundary);

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeRevisionCleanup::new(revision(deep_layout()));
        let progress =
            cleanup.advance(NonZeroUsize::new(128).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force runtime-revision cleanup during unwind");
    }));

    assert!(result.is_err());
}

#[test]
fn outer_drop_finishes_a_deep_layout_after_partial_full_cache_cleanup() {
    let mut owner = revision(deep_layout());
    for spread_index in 0..12 {
        owner
            .frame_cache
            .insert(spread_index, cached_frame(spread_index, 128));
        owner.frame_cache_order.push_back(spread_index);
    }
    let mut cleanup = PendingRuntimeRevisionCleanup::new(owner);

    for _ in 0..5 {
        assert_one(&mut cleanup);
    }
    assert_eq!(cleanup.stage, RuntimeRevisionCleanupStage::FrameCache);
    drop(cleanup);
}

fn drive_q1(cleanup: &mut PendingRuntimeRevisionCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "revision cleanup exceeded its bound");
        assert_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_one(cleanup: &mut PendingRuntimeRevisionCleanup) {
    let progress = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(progress.consumed_units, 1);
}

fn revision(layout: crate::layout::BuiltLayout) -> RuntimeRevision {
    RuntimeRevision::warming(layout, test_layout(), None, interactions())
}

fn empty_layout() -> crate::layout::BuiltLayout {
    create_empty_runtime_layout(1, &test_layout())
}

fn deep_layout() -> crate::layout::BuiltLayout {
    let mut layout = empty_layout();
    layout.pages.push(LayoutRuntimePage::new(
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

fn interactions() -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        footnotes: BTreeMap::new(),
        chapter_text_indices: RuntimeChapterTextIndexSource::FullDocument,
        completed_chapter_idrefs: BTreeSet::new(),
    }
}

fn font_face() -> RuntimeRequiredFontFace {
    RuntimeRequiredFontFace {
        family: "serif".to_owned(),
        href: "font.otf".to_owned(),
        style: "normal".to_owned(),
        weight: 400,
        shape_fingerprint: "shape".to_owned(),
        byte_length: 123,
        source_order: 0,
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
