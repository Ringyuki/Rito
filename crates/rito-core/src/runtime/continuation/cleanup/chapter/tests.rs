use std::{
    collections::BTreeSet,
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::Arc,
};

use serde_json::{json, Map};

use super::{ChapterContinuationCleanupStage, PendingRuntimeChapterContinuationCleanup};
use crate::{
    layout::{
        create_layout_config,
        image_size::ImageSizeIndex,
        pagination_session::{LayoutAdvanceStatus, LayoutWorkBudget},
        runtime_session::RuntimeChapterLayoutSession,
        LayoutConfig, LayoutConfigInput, LayoutRuntimePage, LineBox, LineBreaking, LineRun,
        MarginInput, RunPaint, RunShape, RunShapeUnavailableReason, RunTextMapping, RuntimeBlock,
        RuntimeChild, SpreadMode, TextMeasurementFonts, TextRunBox,
    },
    style::{StyledNode, StyledNodeKind},
};

use super::super::super::state::RuntimeChapterContinuation;

const DEEP_OWNER_COUNT: usize = 16_384;

#[test]
fn empty_current_has_exact_units_for_both_scalar_flag_values() {
    for has_published_pages in [false, true] {
        let mut cleanup = PendingRuntimeChapterContinuationCleanup::new(current(
            Vec::new(),
            Vec::new(),
            has_published_pages,
        ));
        let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

        assert_eq!(progress.consumed_units, 41);
        assert!(progress.complete);
        assert!(!cleanup.advance_one());
        assert_eq!(cleanup.advance(NonZeroUsize::MIN).consumed_units, 0);
    }
}

#[test]
fn completed_current_has_41_exact_units_after_its_idrefs_are_transferred() {
    let mut owner = current(vec![styled_node(Vec::new())], Vec::new(), true);
    let advance = owner.session.advance(
        LayoutWorkBudget::new(NonZeroUsize::new(8).expect("layout budget is non-zero")),
        &TextMeasurementFonts::empty(),
    );
    assert_eq!(advance.status, LayoutAdvanceStatus::Complete);
    owner.completed_chapter_idrefs =
        BTreeSet::from(["chapter-1".to_owned(), "chapter-2".to_owned()]);
    let mut transferred = BTreeSet::new();
    transferred.append(&mut owner.completed_chapter_idrefs);
    let mut cleanup = PendingRuntimeChapterContinuationCleanup::new(owner);

    assert_eq!(drive_q1(&mut cleanup, 41), 41);
    assert_eq!(transferred.len(), 2);
}

#[test]
fn one_empty_unpublished_page_has_exact_units() {
    let pages = vec![LayoutRuntimePage::new(0, 320.0, 120.0, None, Vec::new())];
    let mut cleanup =
        PendingRuntimeChapterContinuationCleanup::new(current(Vec::new(), pages, false));

    assert_eq!(drive_q1(&mut cleanup, 46), 46);
}

#[test]
fn completed_chapter_idrefs_compose_with_active_chapter_retirement() {
    let mut owner = current(Vec::new(), Vec::new(), false);
    owner.completed_chapter_idrefs = BTreeSet::from([
        "chapter-1".to_owned(),
        "chapter-2".to_owned(),
        "chapter-3".to_owned(),
    ]);
    let mut cleanup = PendingRuntimeChapterContinuationCleanup::new(owner);

    assert_eq!(drive_q1(&mut cleanup, 44), 44);
}

#[test]
fn wide_completed_idrefs_drain_after_partial_and_unwind_drops() {
    drop(PendingRuntimeChapterContinuationCleanup::new(
        current_with_completed_idrefs(DEEP_OWNER_COUNT),
    ));

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeChapterContinuationCleanup::new(
            current_with_completed_idrefs(DEEP_OWNER_COUNT),
        );
        while cleanup.stage != ChapterContinuationCleanupStage::CompletedChapterIdrefs {
            assert_one(&mut cleanup);
        }
        for _ in 0..128 {
            assert_one(&mut cleanup);
        }
        assert_eq!(
            cleanup.stage,
            ChapterContinuationCleanupStage::CompletedChapterIdrefs
        );
        panic!("force completed-idref cleanup during unwind");
    }));

    assert!(result.is_err());
}

#[test]
fn deep_unpublished_page_and_pending_session_compose_exactly() {
    let pages = vec![page(vec![deep_block(DEEP_OWNER_COUNT, None)])];
    let nodes = vec![deep_node_tree(DEEP_OWNER_COUNT)];
    let mut cleanup = PendingRuntimeChapterContinuationCleanup::new(current(nodes, pages, false));
    let expected = DEEP_OWNER_COUNT * 4 + 46;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);
}

#[test]
fn unpublished_payload_is_released_before_the_session_source() {
    let source: Arc<str> = Arc::from("unpublished page source");
    let pages = vec![page(vec![block(vec![RuntimeChild::Line(line(
        Arc::clone(&source),
    ))])])];
    let mut cleanup =
        PendingRuntimeChapterContinuationCleanup::new(current(Vec::new(), pages, false));

    assert_one(&mut cleanup);
    assert_eq!(cleanup.stage, ChapterContinuationCleanupStage::Unpublished);
    while Arc::strong_count(&source) > 1 {
        assert_eq!(cleanup.stage, ChapterContinuationCleanupStage::Unpublished);
        assert_one(&mut cleanup);
    }
    assert_eq!(cleanup.stage, ChapterContinuationCleanupStage::Unpublished);
}

#[test]
fn immediate_and_partial_unwind_drops_drain_both_deep_owners() {
    drop(PendingRuntimeChapterContinuationCleanup::new(deep_current()));

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeChapterContinuationCleanup::new(deep_current());
        let progress =
            cleanup.advance(NonZeroUsize::new(128).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force active-chapter cleanup during unwind");
    }));

    assert!(result.is_err());
}

#[test]
fn unpublished_retirement_and_session_source_boundaries_are_drop_safe() {
    for consumed in [3, 4, 5] {
        let mut cleanup = PendingRuntimeChapterContinuationCleanup::new(current(
            vec![deep_node_tree(DEEP_OWNER_COUNT)],
            Vec::new(),
            false,
        ));
        let progress =
            cleanup.advance(NonZeroUsize::new(consumed).expect("test cleanup budget is non-zero"));

        assert_eq!(progress.consumed_units, consumed);
        assert!(!progress.complete);
        drop(cleanup);
    }
}

fn drive_q1(cleanup: &mut PendingRuntimeChapterContinuationCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(
            steps < expected,
            "active chapter exceeded its expected bound"
        );
        assert_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_one(cleanup: &mut PendingRuntimeChapterContinuationCleanup) {
    let progress = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(progress.consumed_units, 1);
}

fn deep_current() -> RuntimeChapterContinuation {
    current(
        vec![deep_node_tree(DEEP_OWNER_COUNT)],
        vec![page(vec![deep_block(DEEP_OWNER_COUNT, None)])],
        false,
    )
}

fn current_with_completed_idrefs(count: usize) -> RuntimeChapterContinuation {
    let mut owner = current(Vec::new(), Vec::new(), false);
    owner.completed_chapter_idrefs = (0..count).map(|index| format!("chapter-{index}")).collect();
    owner
}

fn current(
    nodes: Vec<StyledNode>,
    unpublished_pages: Vec<LayoutRuntimePage>,
    has_published_pages: bool,
) -> RuntimeChapterContinuation {
    RuntimeChapterContinuation {
        idref: "chapter".to_owned(),
        session: chapter_session(nodes),
        completed_chapter_idrefs: BTreeSet::new(),
        unpublished_pages,
        has_published_pages,
        chapter_complete: false,
        total_block_count: 0,
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

fn page(content: Vec<RuntimeBlock<LineBox>>) -> LayoutRuntimePage {
    LayoutRuntimePage::new(0, 320.0, 120.0, None, content)
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
        runs: vec![LineRun::Text(TextRunBox {
            text: "text".to_owned(),
            text_mapping: RunTextMapping::synthetic(),
            x: 0.0,
            y: 0.0,
            width: 20.0,
            height: 12.0,
            font_size: 12.0,
            interaction_geometry: None,
            paint: RunPaint::from_test_wire_value(json!({ "color": "#000" })),
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: Some(source),
            source_text_offset: Some(0),
            inline_margin_right: None,
            ruby_annotation: None,
            shape: RunShape::unavailable(
                RunShapeUnavailableReason::FixtureCompatibleMeasurement,
                20.0,
            ),
        })],
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
