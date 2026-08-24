use std::{
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use super::{LayoutSummaryCleanupStage, PendingLayoutSummaryCleanup};
use crate::layout::{
    create_empty_runtime_layout, create_layout_config, LayoutConfig, LayoutConfigInput,
    LayoutSummary, MarginInput, PaginationFlowChapterRange, SpreadMode,
};

const WIDE_CHAPTER_COUNT: usize = 16_384;

#[test]
fn empty_summary_has_three_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingLayoutSummaryCleanup::new(runtime_summary(0));
    let progress = cleanup.advance(NonZeroUsize::MAX);

    assert_eq!(progress.consumed_units, 3);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
    assert_eq!(cleanup.advance(NonZeroUsize::MIN).consumed_units, 0);
}

#[test]
fn chapter_map_releases_one_entry_per_unit_before_the_owner() {
    let mut summary = runtime_summary(3);
    summary.inline_segments.full_detail_hash = "detailed remainder".to_owned();
    let mut cleanup = PendingLayoutSummaryCleanup::new(summary);

    assert_one(&mut cleanup);
    assert_eq!(cleanup.stage, LayoutSummaryCleanupStage::ChapterMap);
    assert_eq!(
        cleanup.chapter_map.as_ref().map(ExactSizeIterator::len),
        Some(3)
    );
    assert_eq!(
        cleanup
            .owner
            .as_ref()
            .map(|owner| owner.pagination_flow.chapter_map.len()),
        Some(0)
    );
    assert_eq!(
        cleanup
            .owner
            .as_ref()
            .map(|owner| owner.inline_segments.full_detail_hash.as_str()),
        Some("detailed remainder")
    );

    for expected_remaining in [2, 1, 0] {
        assert_one(&mut cleanup);
        assert_eq!(
            cleanup.chapter_map.as_ref().map(ExactSizeIterator::len),
            Some(expected_remaining)
        );
        assert_eq!(cleanup.stage, LayoutSummaryCleanupStage::ChapterMap);
    }

    assert_one(&mut cleanup);
    assert!(cleanup.chapter_map.is_none());
    assert_eq!(cleanup.stage, LayoutSummaryCleanupStage::Owner);
    assert_one(&mut cleanup);
    assert!(cleanup.is_complete());
}

#[test]
fn wide_summary_is_exact_and_partial_unwind_drains_unread_entries() {
    let mut cleanup = PendingLayoutSummaryCleanup::new(runtime_summary(WIDE_CHAPTER_COUNT));
    assert_eq!(
        drive_q1(&mut cleanup, WIDE_CHAPTER_COUNT + 3),
        WIDE_CHAPTER_COUNT + 3
    );
    drop(PendingLayoutSummaryCleanup::new(runtime_summary(
        WIDE_CHAPTER_COUNT,
    )));

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingLayoutSummaryCleanup::new(runtime_summary(WIDE_CHAPTER_COUNT));
        let progress =
            cleanup.advance(NonZeroUsize::new(128).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force layout-summary cleanup during unwind");
    }));

    assert!(result.is_err());
}

fn drive_q1(cleanup: &mut PendingLayoutSummaryCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(
            steps < expected,
            "summary cleanup exceeded its expected bound"
        );
        assert_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_one(cleanup: &mut PendingLayoutSummaryCleanup) {
    let progress = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(progress.consumed_units, 1);
}

fn runtime_summary(chapter_count: usize) -> LayoutSummary {
    let mut summary = create_empty_runtime_layout(chapter_count, &test_layout()).summary;
    for chapter_index in 0..chapter_count {
        summary.pagination_flow.chapter_map.insert(
            format!("chapter-{chapter_index}"),
            PaginationFlowChapterRange {
                start_page: chapter_index,
                end_page: chapter_index,
                page_count: 1,
                block_count: 1,
            },
        );
    }
    summary
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
