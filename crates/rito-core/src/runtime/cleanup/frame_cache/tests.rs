use std::{
    collections::BTreeMap,
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use super::super::test_support::{cached_frame, frame_cache_owner, packed_only_cached_frame};
use super::{PendingRuntimeCachedFrameCleanup, PendingRuntimeFrameCacheCleanup};

#[test]
fn single_cached_frame_has_one_exact_unit() {
    for frame in [
        cached_frame(0, 0),
        cached_frame(0, 16_384),
        packed_only_cached_frame(0, 0),
        packed_only_cached_frame(0, 16_384),
    ] {
        let mut cleanup = PendingRuntimeCachedFrameCleanup::new(frame);
        let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

        assert_eq!(progress.consumed_units, 1);
        assert!(progress.complete);
        assert!(!cleanup.advance_one());
        assert_eq!(cleanup.advance(NonZeroUsize::MIN).consumed_units, 0);
    }
}

#[test]
fn immediate_single_cached_frame_drop_uses_the_same_guard() {
    drop(PendingRuntimeCachedFrameCleanup::new(cached_frame(
        0, 16_384,
    )));
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
fn each_cached_frame_has_one_structural_unit() {
    let frames = BTreeMap::from([
        (9, cached_frame(9, 0)),
        (2, packed_only_cached_frame(2, 3)),
        (5, cached_frame(5, 127)),
    ]);
    let mut cleanup = PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(frames));

    assert_eq!(drive_q1(&mut cleanup, 6), 6);
}

#[test]
fn generated_payload_size_is_an_explicit_atomic_residual() {
    let small = BTreeMap::from([(0, cached_frame(0, 0))]);
    let large = BTreeMap::from([(0, cached_frame(0, 16_384))]);

    for frames in [small, large] {
        let mut cleanup = PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(frames));
        assert_eq!(drive_q1(&mut cleanup, 4), 4);
    }
}

#[test]
fn partial_drop_drains_unread_frames() {
    let frames = (0..12)
        .map(|spread_index| (spread_index, cached_frame(spread_index, 512)))
        .collect();
    let mut cleanup = PendingRuntimeFrameCacheCleanup::new(frame_cache_owner(frames));

    assert_one(&mut cleanup);
    assert_one(&mut cleanup);
    drop(cleanup);
}

#[test]
fn immediate_and_panic_unwind_drops_drain_the_cache_owner() {
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
        for _ in 0..4 {
            assert_one(&mut cleanup);
        }
        panic!("force frame-cache cleanup during unwind");
    }));

    assert!(result.is_err());
}

fn drive_q1(cleanup: &mut PendingRuntimeFrameCacheCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "frame-cache cleanup exceeded its bound");
        assert_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_one(cleanup: &mut PendingRuntimeFrameCacheCleanup) {
    let progress = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(progress.consumed_units, 1);
}
