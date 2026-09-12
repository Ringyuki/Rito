use std::{
    collections::BTreeMap,
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use super::{ContinuationRecordCleanupStage, PendingRuntimeContinuationRecordCleanup};
use crate::layout::{
    create_layout_config, LayoutConfig, LayoutConfigInput, LineBreaking, MarginInput, SpreadMode,
};
use crate::runtime::RuntimeSourceLocator;

use super::super::super::state::RuntimeContinuationRecord;

const LARGE_ADVANCE_COUNT: usize = 16_384;

#[test]
fn record_has_eleven_exact_units_for_all_scalar_values() {
    for line_breaking in [LineBreaking::Greedy, LineBreaking::Optimal] {
        let mut owner = record(line_breaking);
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
    let mut owner = record(LineBreaking::Greedy);
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
fn record_enters_layout_config_before_identity_fields() {
    let mut owner = record(LineBreaking::Greedy);
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
fn large_layout_config_is_exact_and_immediate_drop_is_linear() {
    let mut cleanup = PendingRuntimeContinuationRecordCleanup::new(large_record());
    let expected = LARGE_ADVANCE_COUNT + 11;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);
    drop(PendingRuntimeContinuationRecordCleanup::new(large_record()));
}

#[test]
fn partial_unwind_and_decomposition_boundary_drops_drain_the_large_owner() {
    let mut decomposition_boundary = PendingRuntimeContinuationRecordCleanup::new(large_record());
    assert_one(&mut decomposition_boundary);
    drop(decomposition_boundary);

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeContinuationRecordCleanup::new(large_record());
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

fn large_record() -> RuntimeContinuationRecord {
    let mut owner = record(LineBreaking::Greedy);
    for index in 0..LARGE_ADVANCE_COUNT {
        owner
            .layout_config
            .generic_serif_advances
            .insert(format!("glyph-{index}"), 16.0);
    }
    owner
}

fn record(line_breaking: LineBreaking) -> RuntimeContinuationRecord {
    RuntimeContinuationRecord::new(
        "revision".to_owned(),
        "layout-key".to_owned(),
        test_layout(),
        line_breaking,
        1,
    )
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
