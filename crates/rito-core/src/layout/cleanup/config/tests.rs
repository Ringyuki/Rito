use std::{
    collections::BTreeMap,
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use super::{LayoutConfigCleanupStage, PendingLayoutConfigCleanup};
use crate::layout::{
    create_layout_config, FontVerticalMetricSample, LayoutConfig, LayoutConfigInput, MarginInput,
    SpreadMode,
};

const LARGE_ENTRY_COUNT: usize = 16_384;

#[test]
fn empty_maps_cost_exactly_six_units() {
    let mut cleanup = PendingLayoutConfigCleanup::new(test_layout());
    let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 6);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
}

#[test]
fn flat_nested_and_empty_family_maps_have_exact_units() {
    let mut owner = test_layout();
    owner
        .generic_serif_advances
        .extend([("A".to_owned(), 1.0), ("B".to_owned(), 2.0)]);
    owner.font_family_advances.extend([
        ("Empty".to_owned(), BTreeMap::new()),
        (
            "Serif".to_owned(),
            BTreeMap::from([("A".to_owned(), 3.0), ("B".to_owned(), 4.0)]),
        ),
    ]);
    owner
        .generic_serif_pair_adjustments
        .insert("AB".to_owned(), -1.0);
    owner.font_family_pair_adjustments.insert(
        "Serif".to_owned(),
        BTreeMap::from([("AB".to_owned(), -2.0)]),
    );
    owner.font_vertical_metrics.extend([
        FontVerticalMetricSample {
            font_family: "serif".to_owned(),
            font_style: "normal".to_owned(),
            font_weight: 400,
            font_size_px: 16.0,
            top_baseline_ascent_px: 3.0,
            top_baseline_descent_px: 15.0,
        },
        FontVerticalMetricSample {
            font_family: "sans-serif".to_owned(),
            font_style: "italic".to_owned(),
            font_weight: 700,
            font_size_px: 20.0,
            top_baseline_ascent_px: 4.0,
            top_baseline_descent_px: 18.0,
        },
    ]);
    let mut cleanup = PendingLayoutConfigCleanup::new(owner);

    assert_eq!(drive_q1(&mut cleanup, 21), 21);
}

#[test]
fn exhausted_flat_source_has_a_separate_retirement_unit() {
    let mut owner = test_layout();
    owner
        .generic_serif_advances
        .extend([("A".to_owned(), 1.0), ("B".to_owned(), 2.0)]);
    let mut cleanup = PendingLayoutConfigCleanup::new(owner);

    assert_one(&mut cleanup);
    assert_one(&mut cleanup);
    assert_one(&mut cleanup);
    assert_eq!(
        cleanup.stage,
        LayoutConfigCleanupStage::GenericSerifAdvances
    );
    assert_eq!(
        cleanup
            .generic_serif_advances
            .as_ref()
            .map(ExactSizeIterator::len),
        Some(0)
    );
    assert_one(&mut cleanup);
    assert_eq!(cleanup.stage, LayoutConfigCleanupStage::FontFamilyAdvances);
}

#[test]
fn large_partial_and_unwind_drops_drain_remaining_entries() {
    drop(PendingLayoutConfigCleanup::new(large_layout()));

    let mut partial = PendingLayoutConfigCleanup::new(large_layout());
    let progress = partial.advance(NonZeroUsize::new(127).expect("test budget is non-zero"));
    assert_eq!(progress.consumed_units, 127);
    assert!(!progress.complete);
    drop(partial);

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingLayoutConfigCleanup::new(large_layout());
        let progress = cleanup
            .advance(NonZeroUsize::new(LARGE_ENTRY_COUNT / 2).expect("test budget is non-zero"));
        assert!(!progress.complete);
        panic!("force layout-config cleanup during unwind");
    }));
    assert!(result.is_err());
}

fn drive_q1(cleanup: &mut PendingLayoutConfigCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "layout-config cleanup exceeded its bound");
        assert_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_one(cleanup: &mut PendingLayoutConfigCleanup) {
    let progress = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(progress.consumed_units, 1);
}

fn large_layout() -> LayoutConfig {
    let mut layout = test_layout();
    layout.generic_serif_advances = (0..LARGE_ENTRY_COUNT)
        .map(|index| (format!("glyph-{index}"), index as f64))
        .collect();
    layout
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
