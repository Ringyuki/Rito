use std::{
    collections::BTreeMap,
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use super::super::test_support::{cached_frame, frame_cache_owner, wide_resource_cached_frame};
use super::{PendingRuntimeCachedFrameCleanup, PendingRuntimeFrameCacheCleanup};
use crate::runtime::frame::RuntimeCachedFrame;

const WIDE_OWNER_COUNT: usize = 16_384;

type FrameFactory = fn(usize) -> RuntimeCachedFrame;

#[test]
fn synthetic_cached_frames_have_exact_q1_costs() {
    for count in [0, 3, WIDE_OWNER_COUNT] {
        // The command buffer's bytes are one unit whatever their length,
        // so a frame with one font family and no resources costs 6.
        let expected = 6;

        assert_eq!(
            drive_cached_q1(
                &mut PendingRuntimeCachedFrameCleanup::new(cached_frame(0, count)),
                expected,
            ),
            expected
        );
    }
}

#[test]
fn every_resource_and_font_source_contributes_one_unit_per_owner() {
    for (factory, fixed_units) in frame_factories() {
        let expected = WIDE_OWNER_COUNT + fixed_units;
        let mut cleanup = PendingRuntimeCachedFrameCleanup::new(factory(WIDE_OWNER_COUNT));

        assert_eq!(drive_cached_q1(&mut cleanup, expected), expected);
    }
}

#[test]
fn wide_payload_sources_are_immediate_partial_and_unwind_drop_safe() {
    for (factory, _fixed_units) in frame_factories() {
        drop(PendingRuntimeCachedFrameCleanup::new(factory(
            WIDE_OWNER_COUNT,
        )));

        let mut partial = PendingRuntimeCachedFrameCleanup::new(factory(WIDE_OWNER_COUNT));
        let progress = partial
            .advance(NonZeroUsize::new(128).expect("test cached-frame cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        assert_eq!(partial.pending_frame_owner_count(), 1);
        drop(partial);

        let result = catch_unwind(AssertUnwindSafe(|| {
            let mut cleanup = PendingRuntimeCachedFrameCleanup::new(factory(WIDE_OWNER_COUNT));
            let progress = cleanup.advance(
                NonZeroUsize::new(128).expect("test cached-frame cleanup budget is non-zero"),
            );
            assert_eq!(progress.consumed_units, 128);
            assert!(!progress.complete);
            assert_eq!(cleanup.pending_frame_owner_count(), 1);
            panic!("force cached-frame cleanup during unwind");
        }));

        assert!(result.is_err());
    }
}

#[test]
fn empty_cache_has_three_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(BTreeMap::new()));
    let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 3);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
    assert_eq!(cleanup.advance(NonZeroUsize::MIN).consumed_units, 0);
}

#[test]
fn frame_cache_composes_nested_frame_costs_exactly() {
    let frames = BTreeMap::from([
        (9, cached_frame(9, 0)),
        (2, cached_frame(2, 3)),
        (5, wide_resource_cached_frame(5, 127)),
    ]);
    let mut cleanup = PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(frames));

    // 3 cache-shell units plus one retirement unit after each nested cost:
    // frame(0) = 6, frame(3) = 6, wide(127) = 5 + 127 + 1 (its font) = 133.
    assert_eq!(drive_cache_q1(&mut cleanup, 151), 151);
}

#[test]
fn parent_cache_keeps_active_owner_until_nested_completion_and_retires_it_separately() {
    let frame = stripped_frame(0);
    let mut cleanup =
        PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(BTreeMap::from([(0, frame)])));

    assert_eq!(cleanup.pending_frame_owner_count(), 1);
    assert_cache_one(&mut cleanup); // Frame-map source.
    assert_eq!(cleanup.pending_frame_owner_count(), 1);
    assert!(cleanup.frame.is_none());

    assert_cache_one(&mut cleanup); // Activates the frame and consumes its source unit.
    assert_eq!(cleanup.pending_frame_owner_count(), 1);
    assert!(cleanup.frame.is_some());

    for _ in 1..4 {
        assert_cache_one(&mut cleanup);
        assert_eq!(cleanup.pending_frame_owner_count(), 1);
    }
    assert_cache_one(&mut cleanup); // Releases the command-buffer shell.
    assert_eq!(cleanup.pending_frame_owner_count(), 0);
    assert!(cleanup
        .frame
        .as_ref()
        .is_some_and(PendingRuntimeCachedFrameCleanup::is_complete));

    assert_cache_one(&mut cleanup); // Retires the completed nested cursor.
    assert!(cleanup.frame.is_none());
    assert!(!cleanup.is_complete());
    assert_cache_one(&mut cleanup); // Exhausted frame-map source.
    assert_cache_one(&mut cleanup); // Cache order.
    assert!(cleanup.is_complete());
    assert!(!cleanup.advance_one());
}

#[test]
fn parent_cache_budget_stops_inside_a_wide_active_frame() {
    let frames = (0..12)
        .map(|spread_index| {
            (
                spread_index,
                wide_resource_cached_frame(spread_index, WIDE_OWNER_COUNT),
            )
        })
        .collect();
    let mut cleanup = PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(frames));

    let progress = cleanup
        .advance(NonZeroUsize::new(64).expect("test frame-cache cleanup budget is non-zero"));

    assert_eq!(progress.consumed_units, 64);
    assert!(!progress.complete);
    assert_eq!(cleanup.pending_frame_owner_count(), 12);
    assert!(cleanup.frame.is_some());
    drop(cleanup);
}

#[test]
fn immediate_and_panic_unwind_drops_drain_the_parent_cache() {
    let frames = || {
        (0..12)
            .map(|spread_index| (spread_index, wide_resource_cached_frame(spread_index, 512)))
            .collect()
    };
    drop(PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(
        frames(),
    )));

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(frames()));
        let progress = cleanup
            .advance(NonZeroUsize::new(128).expect("test frame-cache cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force frame-cache cleanup during unwind");
    }));

    assert!(result.is_err());
}

fn frame_factories() -> [(FrameFactory, usize); 2] {
    [
        (packed_resource_table_frame, 5),
        (packed_font_families_frame, 5),
    ]
}

fn packed_resource_table_frame(count: usize) -> RuntimeCachedFrame {
    let mut frame = stripped_frame(0);
    frame.command_buffer.metadata.resource_table = strings("packed-resource", count);
    frame
}

fn packed_font_families_frame(count: usize) -> RuntimeCachedFrame {
    let mut frame = stripped_frame(0);
    frame.command_buffer.metadata.font_families = strings("packed-font", count);
    frame
}

/// A frame with empty tables and no bytes: the five fixed units alone.
fn stripped_frame(spread_index: usize) -> RuntimeCachedFrame {
    let mut frame = cached_frame(spread_index, 0);
    let metadata = &mut frame.command_buffer.metadata;
    metadata.resource_table.clear();
    metadata.font_families.clear();
    frame.command_buffer.bytes.clear();
    frame
}

fn strings(prefix: &str, count: usize) -> Vec<String> {
    (0..count)
        .map(|index| format!("{prefix}-{index}"))
        .collect()
}

fn drive_cached_q1(cleanup: &mut PendingRuntimeCachedFrameCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "cached-frame cleanup exceeded its bound");
        let progress = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        assert_eq!(
            cleanup.pending_frame_owner_count(),
            usize::from(!progress.complete)
        );
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    assert_eq!(cleanup.advance(NonZeroUsize::MIN).consumed_units, 0);
    steps
}

fn drive_cache_q1(cleanup: &mut PendingRuntimeFrameCacheCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "frame-cache cleanup exceeded its bound");
        assert_cache_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_cache_one(cleanup: &mut PendingRuntimeFrameCacheCleanup) {
    let progress = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(progress.consumed_units, 1);
}
