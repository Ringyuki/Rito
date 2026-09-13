use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use super::{PendingRuntimeRevisionCleanup, RuntimeRevisionCleanupStage};
use crate::{
    interaction::{FootnoteEntry, FootnoteKind},
    layout::{create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode},
    runtime::{
        fragment_backend::FragmentBuiltLayout,
        frame::{
            RuntimeChapterTextIndexSource, RuntimeRevision, RuntimeRevisionCoordinateSpace,
            RuntimeRevisionInteractions,
        },
        RuntimeChapterTextIndex, RuntimeChapterTextSpan, RuntimeRequiredFontFace,
        RuntimeRevisionExtent,
    },
};

use super::super::test_support::cached_frame;

const LARGE_FONT_FACE_COUNT: usize = 16_384;

#[test]
fn empty_revision_units_include_each_required_font_face() {
    for has_font_catalog in [false, true] {
        let mut owner = revision();
        owner.revision_version = u32::MAX;
        owner.extent = RuntimeRevisionExtent {
            page_count: usize::MAX,
            spread_count: usize::MAX,
        };
        owner.required_font_face_catalog = has_font_catalog.then(|| vec![font_face()]);
        let mut cleanup = PendingRuntimeRevisionCleanup::new(owner);

        let expected = 13 + usize::from(has_font_catalog);
        assert_eq!(drive_q1(&mut cleanup, expected), expected);
    }
}

#[test]
fn cache_and_flat_fields_release_in_order() {
    let mut owner = revision();
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
    let frame_cache_units = 3 + (6 + 1) + (6 + 1);
    for _ in 0..frame_cache_units {
        assert_one(&mut cleanup);
    }
    assert!(cleanup
        .frame_cache
        .as_ref()
        .is_some_and(|cache| cache.is_complete()));

    assert_one(&mut cleanup);
    assert!(cleanup.frame_cache.is_none());
    assert_eq!(
        cleanup.stage,
        RuntimeRevisionCleanupStage::RequiredFontFaceCatalog
    );

    assert_eq!(drive_q1(&mut cleanup, 10), 10);
}

#[test]
fn materialized_interactions_compose_with_revision_retirement() {
    let mut owner = revision();
    owner.interactions = materialized_interactions(2);
    let mut cleanup = PendingRuntimeRevisionCleanup::new(owner);

    assert_eq!(drive_q1(&mut cleanup, 24), 24);
}

#[test]
fn large_font_catalog_is_exact_and_drop_drains_unread_faces() {
    let mut owner = revision();
    owner.required_font_face_catalog = Some(font_faces(LARGE_FONT_FACE_COUNT));
    let mut cleanup = PendingRuntimeRevisionCleanup::new(owner);
    let expected = LARGE_FONT_FACE_COUNT + 13;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);

    let mut immediate = revision();
    immediate.required_font_face_catalog = Some(font_faces(LARGE_FONT_FACE_COUNT));
    drop(PendingRuntimeRevisionCleanup::new(immediate));

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut partial = revision();
        partial.required_font_face_catalog = Some(font_faces(LARGE_FONT_FACE_COUNT));
        let mut cleanup = PendingRuntimeRevisionCleanup::new(partial);
        let progress =
            cleanup.advance(NonZeroUsize::new(128).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force font-catalog cleanup during unwind");
    }));

    assert!(result.is_err());
}

#[test]
fn outer_drop_finishes_after_partial_full_cache_cleanup() {
    let mut owner = revision();
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

fn revision() -> RuntimeRevision {
    RuntimeRevision::new(
        RuntimeRevisionCoordinateSpace::Absolute,
        test_layout(),
        BTreeMap::new(),
        None,
        interactions(),
        FragmentBuiltLayout::empty(),
    )
}

fn interactions() -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        publication_footnotes: None,
        footnotes: BTreeMap::new(),
        pending_footnote_keys: crate::interaction::FootnoteTargetSet::default(),
        footnote_index_complete: false,
        chapter_text_indices: RuntimeChapterTextIndexSource::FullDocument,
        completed_chapter_idrefs: BTreeSet::new(),
    }
}

fn materialized_interactions(span_count: usize) -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        publication_footnotes: None,
        footnotes: BTreeMap::from([(
            "note".to_owned(),
            FootnoteEntry {
                kind: FootnoteKind::Footnote,
                text: "note text".to_owned(),
                html: "<p>note text</p>".to_owned(),
            },
        )]),
        pending_footnote_keys: crate::interaction::FootnoteTargetSet::default(),
        footnote_index_complete: false,
        chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(BTreeMap::from([(
            "chapter".to_owned(),
            RuntimeChapterTextIndex {
                href: "chapter.xhtml".to_owned(),
                normalized_text: "chapter text".to_owned(),
                spans: (0..span_count).map(runtime_text_span).collect(),
            },
        )])),
        completed_chapter_idrefs: BTreeSet::from(["chapter".to_owned()]),
    }
}

fn runtime_text_span(index: usize) -> RuntimeChapterTextSpan {
    RuntimeChapterTextSpan {
        node_path: vec![index],
        source_start: index,
        source_end: index + 1,
        normalized_start: index,
        normalized_end: index + 1,
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

fn font_faces(count: usize) -> Vec<RuntimeRequiredFontFace> {
    (0..count).map(|_| font_face()).collect()
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
    })
}
