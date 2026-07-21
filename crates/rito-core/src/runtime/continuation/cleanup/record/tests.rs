use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use serde_json::Map;

use super::{ContinuationRecordCleanupStage, PendingRuntimeContinuationRecordCleanup};
use crate::runtime::RuntimeSourceLocator;
use crate::{
    layout::{
        create_layout_config, image_size::ImageSizeIndex,
        runtime_session::RuntimeChapterLayoutSession, LayoutConfig, LayoutConfigInput,
        LayoutRuntimePage, LineBreaking, MarginInput, SpreadMode,
    },
    style::{StyledNode, StyledNodeKind},
};

use super::super::super::state::{RuntimeChapterContinuation, RuntimeContinuationRecord};
use super::super::chapter::PendingRuntimeChapterContinuationCleanup;

const DEEP_NODE_COUNT: usize = 16_384;

#[test]
fn inactive_record_has_eleven_exact_units_for_all_scalar_values() {
    for line_breaking in [LineBreaking::Greedy, LineBreaking::Optimal] {
        let mut owner = record(None, line_breaking);
        owner.revision_version = u32::MAX;
        owner.next_chapter_index = usize::MAX;
        owner.chapter_count = usize::MAX;
        owner.published_page_count = usize::MAX;
        let mut cleanup = PendingRuntimeContinuationRecordCleanup::new(owner);
        let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

        assert_eq!(progress.consumed_units, 11);
        assert!(progress.complete);
        assert!(!cleanup.advance_one());
        assert_eq!(cleanup.advance(NonZeroUsize::MIN).consumed_units, 0);
    }
}

#[test]
fn chapter_local_target_adds_one_explicit_cleanup_unit() {
    let mut owner = record(None, LineBreaking::Greedy);
    owner.chapter_local_target = Some(RuntimeSourceLocator {
        href: "chapter.xhtml".to_owned(),
        anchor_id: Some("target".to_owned()),
        source_point: None,
        source_range: None,
        progression: None,
    });
    let mut cleanup = PendingRuntimeContinuationRecordCleanup::new(owner);
    let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 12);
    assert!(progress.complete);
}

#[test]
fn inactive_record_enters_layout_config_before_identity_fields() {
    let mut owner = record(None, LineBreaking::Greedy);
    owner.layout_config.font_family_override = Some("Pinned Serif".to_owned());
    owner
        .layout_config
        .generic_serif_advances
        .insert("中".to_owned(), 16.0);
    owner
        .layout_config
        .font_family_advances
        .insert("Family".to_owned(), BTreeMap::from([("A".to_owned(), 9.0)]));
    let mut cleanup = PendingRuntimeContinuationRecordCleanup::new(owner);

    assert_one(&mut cleanup);
    assert_eq!(cleanup.stage, ContinuationRecordCleanupStage::LayoutConfig);
    assert!(cleanup.layout_config.is_some());
    assert!(cleanup.layout_key.is_some());
    assert!(cleanup.revision_id.is_some());
    assert_eq!(drive_q1(&mut cleanup, 14), 14);
}

#[test]
fn active_record_composes_empty_and_single_page_chapters_exactly() {
    let empty = record(Some(current(Vec::new(), Vec::new())), LineBreaking::Greedy);
    let page = LayoutRuntimePage::new(0, 320.0, 120.0, None, Vec::new());
    let one_page = record(Some(current(Vec::new(), vec![page])), LineBreaking::Greedy);

    for (owner, expected) in [(empty, 53), (one_page, 58)] {
        let mut cleanup = PendingRuntimeContinuationRecordCleanup::new(owner);
        assert_eq!(drive_q1(&mut cleanup, expected), expected);
    }
}

#[test]
fn active_chapter_retirement_has_its_own_unit() {
    let owner = record(Some(current(Vec::new(), Vec::new())), LineBreaking::Greedy);
    let mut cleanup = PendingRuntimeContinuationRecordCleanup::new(owner);

    for _ in 0..42 {
        assert_one(&mut cleanup);
    }
    assert_eq!(cleanup.stage, ContinuationRecordCleanupStage::Current);
    assert!(cleanup
        .current
        .as_ref()
        .is_some_and(PendingRuntimeChapterContinuationCleanup::is_complete));

    assert_one(&mut cleanup);
    assert!(cleanup.current.is_none());
    assert_eq!(cleanup.stage, ContinuationRecordCleanupStage::LayoutConfig);
    assert_eq!(drive_q1(&mut cleanup, 10), 10);
}

#[test]
fn deep_active_record_has_exact_units_and_immediate_drop_is_linear() {
    let owner = deep_record();
    let mut cleanup = PendingRuntimeContinuationRecordCleanup::new(owner);
    let expected = DEEP_NODE_COUNT * 2 + 52;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);
    drop(PendingRuntimeContinuationRecordCleanup::new(deep_record()));
}

#[test]
fn partial_unwind_and_current_source_boundary_drops_drain_the_deep_owner() {
    let mut source_boundary = PendingRuntimeContinuationRecordCleanup::new(deep_record());
    assert_one(&mut source_boundary);
    drop(source_boundary);

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeContinuationRecordCleanup::new(deep_record());
        let progress =
            cleanup.advance(NonZeroUsize::new(128).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force continuation-record cleanup during unwind");
    }));

    assert!(result.is_err());
}

fn drive_q1(cleanup: &mut PendingRuntimeContinuationRecordCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(
            steps < expected,
            "record cleanup exceeded its expected bound"
        );
        assert_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_one(cleanup: &mut PendingRuntimeContinuationRecordCleanup) {
    let progress = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(progress.consumed_units, 1);
}

fn deep_record() -> RuntimeContinuationRecord {
    record(
        Some(current(vec![deep_node_tree(DEEP_NODE_COUNT)], Vec::new())),
        LineBreaking::Greedy,
    )
}

fn record(
    current: Option<RuntimeChapterContinuation>,
    line_breaking: LineBreaking,
) -> RuntimeContinuationRecord {
    let mut owner = RuntimeContinuationRecord::new(
        "revision".to_owned(),
        "layout-key".to_owned(),
        test_layout(),
        line_breaking,
        1,
    );
    owner.current = current;
    owner
}

fn current(
    nodes: Vec<StyledNode>,
    unpublished_pages: Vec<LayoutRuntimePage>,
) -> RuntimeChapterContinuation {
    RuntimeChapterContinuation {
        idref: "chapter".to_owned(),
        session: chapter_session(nodes),
        completed_chapter_idrefs: BTreeSet::new(),
        unpublished_pages,
        has_published_pages: false,
        chapter_complete: false,
        total_block_count: 0,
        pending_style_table: None,
    }
}

fn chapter_session(nodes: Vec<StyledNode>) -> RuntimeChapterLayoutSession {
    let layout = test_layout();
    RuntimeChapterLayoutSession::new(
        nodes,
        ImageSizeIndex::new(&[]),
        &layout,
        LineBreaking::Greedy,
        None,
    )
}

fn deep_node_tree(count: usize) -> StyledNode {
    let mut root = styled_node(Vec::new());
    for _ in 1..count {
        root = styled_node(vec![root]);
    }
    root
}

fn styled_node(children: Vec<StyledNode>) -> StyledNode {
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
