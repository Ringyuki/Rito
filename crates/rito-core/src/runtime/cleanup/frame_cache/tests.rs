use std::{
    collections::BTreeMap,
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use serde_json::json;

use super::super::test_support::{cached_frame, frame_cache_owner, packed_only_cached_frame};
use super::{PendingRuntimeCachedFrameCleanup, PendingRuntimeFrameCacheCleanup};
use crate::runtime::frame::RuntimeCachedFrame;

const WIDE_OWNER_COUNT: usize = 16_384;

type FrameFactory = fn(usize) -> RuntimeCachedFrame;

#[test]
fn synthetic_cached_frames_have_exact_q1_costs() {
    for count in [0, 3, WIDE_OWNER_COUNT] {
        let materialized_expected = 13 + count * 3;
        let packed_expected = 8 + count * 2;

        assert_eq!(
            drive_cached_q1(
                &mut PendingRuntimeCachedFrameCleanup::new(cached_frame(0, count)),
                materialized_expected,
            ),
            materialized_expected
        );
        assert_eq!(
            drive_cached_q1(
                &mut PendingRuntimeCachedFrameCleanup::new(packed_only_cached_frame(0, count)),
                packed_expected,
            ),
            packed_expected
        );
    }
}

#[test]
fn every_resource_font_and_payload_source_contributes_one_unit_per_owner() {
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
        (2, packed_only_cached_frame(2, 3)),
        (5, cached_frame(5, 127)),
    ]);
    let mut cleanup = PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(frames));

    // 3 cache-shell units plus one retirement unit after each nested cost:
    // cached(0) = 13, packed(3) = 14, cached(127) = 394.
    assert_eq!(drive_cache_q1(&mut cleanup, 427), 427);
}

#[test]
fn parent_cache_keeps_active_owner_until_nested_completion_and_retires_it_separately() {
    let frame = stripped_packed_frame(0);
    let mut cleanup =
        PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(BTreeMap::from([(0, frame)])));

    assert_eq!(cleanup.pending_frame_owner_count(), 1);
    assert_cache_one(&mut cleanup); // Frame-map source.
    assert_eq!(cleanup.pending_frame_owner_count(), 1);
    assert!(cleanup.frame.is_none());

    assert_cache_one(&mut cleanup); // Activates the frame and consumes its source unit.
    assert_eq!(cleanup.pending_frame_owner_count(), 1);
    assert!(cleanup.frame.is_some());

    for _ in 1..6 {
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
        .map(|spread_index| (spread_index, cached_frame(spread_index, WIDE_OWNER_COUNT)))
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
            .map(|spread_index| (spread_index, cached_frame(spread_index, 512)))
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

fn frame_factories() -> [(FrameFactory, usize); 7] {
    [
        (legacy_commands_frame, 11),
        (legacy_resource_images_frame, 11),
        (legacy_font_families_frame, 11),
        (packed_resource_table_frame, 7),
        (packed_font_families_frame, 7),
        (packed_string_table_frame, 7),
        (packed_payload_table_frame, 7),
    ]
}

fn legacy_commands_frame(count: usize) -> RuntimeCachedFrame {
    let mut frame = stripped_materialized_frame(0);
    frame
        .frame
        .as_mut()
        .expect("materialized test frame exists")
        .commands = (0..count).map(|index| json!({ "index": index })).collect();
    frame
}

fn legacy_resource_images_frame(count: usize) -> RuntimeCachedFrame {
    let mut frame = stripped_materialized_frame(0);
    frame
        .frame
        .as_mut()
        .expect("materialized test frame exists")
        .resource_refs
        .images = strings("legacy-resource", count);
    frame
}

fn legacy_font_families_frame(count: usize) -> RuntimeCachedFrame {
    let mut frame = stripped_materialized_frame(0);
    frame
        .frame
        .as_mut()
        .expect("materialized test frame exists")
        .font_families = strings("legacy-font", count);
    frame
}

fn packed_resource_table_frame(count: usize) -> RuntimeCachedFrame {
    let mut frame = stripped_packed_frame(0);
    frame.command_buffer.metadata.resource_table = strings("packed-resource", count);
    frame
}

fn packed_font_families_frame(count: usize) -> RuntimeCachedFrame {
    let mut frame = stripped_packed_frame(0);
    frame.command_buffer.metadata.font_families = strings("packed-font", count);
    frame
}

fn packed_string_table_frame(count: usize) -> RuntimeCachedFrame {
    let mut frame = stripped_packed_frame(0);
    frame.command_buffer.metadata.string_table = strings("packed-string", count);
    frame
}

fn packed_payload_table_frame(count: usize) -> RuntimeCachedFrame {
    let mut frame = stripped_packed_frame(0);
    frame.command_buffer.metadata.payload_table = strings("packed-payload", count);
    frame
}

fn stripped_materialized_frame(spread_index: usize) -> RuntimeCachedFrame {
    let mut frame = cached_frame(spread_index, 0);
    let legacy = frame
        .frame
        .as_mut()
        .expect("materialized test frame exists");
    legacy.commands.clear();
    legacy.resource_refs.images.clear();
    legacy.font_families.clear();
    strip_packed_tables(&mut frame);
    frame
}

fn stripped_packed_frame(spread_index: usize) -> RuntimeCachedFrame {
    let mut frame = packed_only_cached_frame(spread_index, 0);
    strip_packed_tables(&mut frame);
    frame
}

fn strip_packed_tables(frame: &mut RuntimeCachedFrame) {
    let metadata = &mut frame.command_buffer.metadata;
    metadata.resource_table.clear();
    metadata.font_families.clear();
    metadata.string_table.clear();
    metadata.payload_table.clear();
    frame.command_buffer.bytes.clear();
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
