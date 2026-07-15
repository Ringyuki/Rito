use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
    rc::Rc,
};

use super::{
    RuntimeCleanupProbe, RuntimeCleanupQueue, FRAME_BACKLOG_HIGH_WATER, RUNTIME_CLEANUP_QUANTUM,
};
use crate::{
    layout::{
        create_empty_runtime_layout, create_layout_config,
        image_size::ImageSizeIndex,
        pagination_session::{LayoutAdvanceStatus, LayoutWorkBudget},
        runtime_session::RuntimeChapterLayoutSession,
        LayoutConfig, LayoutConfigInput, LineBreaking, MarginInput, PaginationFlowChapterRange,
        SpreadMode, TextMeasurementFonts,
    },
    runtime::{
        cleanup::test_support::cached_frame,
        continuation::{RuntimeChapterContinuation, RuntimeContinuationRecord},
        frame::{
            RuntimeChapterTextIndexSource, RuntimeFrameCacheOwner, RuntimeRevision,
            RuntimeRevisionInteractions, FRAME_CACHE_CAPACITY,
        },
    },
};

const EMPTY_MATERIALIZED_FRAME_UNITS: usize = 13;
const LARGE_FRAME_PAYLOAD_COUNT: usize = 16_384;
const REAL_JOB_FIXTURE_UNITS: usize = 12 + 42 + 32 + 4 + (EMPTY_MATERIALIZED_FRAME_UNITS + 1) + 7;

#[test]
fn empty_queue_reports_complete_without_consuming_budget() {
    let mut queue = RuntimeCleanupQueue::default();
    let progress = queue.advance(NonZeroUsize::MIN);

    assert_eq!(progress.consumed_units, 0);
    assert!(progress.complete);
}

#[test]
fn regular_jobs_advance_round_robin_at_unit_quanta() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(1, 3, 0, &log));
    queue.enqueue_probe(probe(2, 3, 0, &log));

    let progress = queue.advance(NonZeroUsize::new(8).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 8);
    assert!(progress.complete);
    assert_eq!(*log.borrow(), [1, 2, 1, 2, 1, 2]);
}

#[test]
fn low_frame_backlog_alternates_with_regular_work() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(1, 3, 3, &log));
    queue.enqueue_probe(probe(2, 3, 0, &log));

    queue.advance(NonZeroUsize::new(8).expect("test budget is non-zero"));

    assert_eq!(*log.borrow(), [1, 2, 1, 2, 1, 2]);
}

#[test]
fn high_frame_backlog_is_prioritized_in_bounded_bursts() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(1, 32, 32, &log));
    queue.enqueue_probe(probe(2, 2, 0, &log));

    for _ in 0..9 {
        queue.advance(NonZeroUsize::MIN);
    }

    assert_eq!(*log.borrow(), [1, 1, 1, 1, 1, 1, 1, 1, 2]);
    assert_eq!(queue.pending_frame_owner_count(), 24);
}

#[test]
fn default_quantum_advances_wide_frame_backlog_without_false_retirement() {
    let mut queue = RuntimeCleanupQueue::default();
    for spread_index in 0..100 {
        queue.enqueue_cached_frame(cached_frame(spread_index, 0));
    }

    let budget = NonZeroUsize::new(RUNTIME_CLEANUP_QUANTUM).expect("cleanup quantum is non-zero");
    let first = queue.advance(budget);
    assert_eq!(first.consumed_units, RUNTIME_CLEANUP_QUANTUM);
    assert_eq!(queue.pending_frame_owner_count(), 100);
    assert_eq!(queue.job_count(), 100);

    let mut consumed_units = first.consumed_units;
    while !queue.is_empty() {
        consumed_units += queue.advance(budget).consumed_units;
    }
    assert_eq!(consumed_units, 100 * (EMPTY_MATERIALIZED_FRAME_UNITS + 1));
    assert_eq!(queue.pending_frame_owner_count(), 0);
}

#[test]
fn each_job_has_a_separate_queue_retirement_unit() {
    let mut queue = RuntimeCleanupQueue::default();
    enqueue_real_job_fixtures(&mut queue);

    let progress = queue
        .advance(NonZeroUsize::new(REAL_JOB_FIXTURE_UNITS - 1).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, REAL_JOB_FIXTURE_UNITS - 1);
    assert!(!progress.complete);
    let retirement = queue.advance(NonZeroUsize::MIN);
    assert_eq!(retirement.consumed_units, 1);
    assert!(retirement.complete);
}

#[test]
fn cached_frame_owner_and_queue_retirement_are_distinct() {
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_cached_frame(cached_frame(0, 0));

    let partial = queue.advance(
        NonZeroUsize::new(EMPTY_MATERIALIZED_FRAME_UNITS - 1).expect("cleanup budget is non-zero"),
    );
    assert_eq!(partial.consumed_units, EMPTY_MATERIALIZED_FRAME_UNITS - 1);
    assert!(!partial.complete);
    assert_eq!(queue.pending_frame_owner_count(), 1);
    assert_eq!(queue.job_count(), 1);

    let owner = queue.advance(NonZeroUsize::MIN);
    assert_eq!(owner.consumed_units, 1);
    assert!(!owner.complete);
    assert_eq!(queue.pending_frame_owner_count(), 0);
    assert_eq!(queue.job_count(), 1);

    let retirement = queue.advance(NonZeroUsize::MIN);
    assert_eq!(retirement.consumed_units, 1);
    assert!(retirement.complete);
}

#[test]
fn large_cached_frame_remains_one_resumable_frame_job() {
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_cached_frame(cached_frame(0, LARGE_FRAME_PAYLOAD_COUNT));
    let budget = NonZeroUsize::new(RUNTIME_CLEANUP_QUANTUM).expect("cleanup budget is non-zero");

    let first = queue.advance(budget);

    assert_eq!(first.consumed_units, RUNTIME_CLEANUP_QUANTUM);
    assert!(!first.complete);
    assert_eq!(queue.pending_frame_owner_count(), 1);
    assert_eq!(queue.job_count(), 1);

    let remaining = queue.advance(NonZeroUsize::MAX);
    let queue_units = 3 * LARGE_FRAME_PAYLOAD_COUNT + EMPTY_MATERIALIZED_FRAME_UNITS + 1;
    assert_eq!(
        remaining.consumed_units,
        queue_units - RUNTIME_CLEANUP_QUANTUM
    );
    assert!(remaining.complete);
    assert_eq!(queue.pending_frame_owner_count(), 0);
}

#[test]
fn completed_chapter_owner_and_queue_retirement_are_distinct() {
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_completed_chapter(empty_completed_chapter());

    let owner = queue.advance(NonZeroUsize::new(41).expect("cleanup budget is non-zero"));
    assert_eq!(owner.consumed_units, 41);
    assert!(!owner.complete);
    assert_eq!(queue.job_count(), 1);

    let retirement = queue.advance(NonZeroUsize::MIN);
    assert_eq!(retirement.consumed_units, 1);
    assert!(retirement.complete);
}

#[test]
fn high_water_threshold_changes_the_second_service_choice() {
    let low_log = Rc::new(RefCell::new(Vec::new()));
    let mut low = RuntimeCleanupQueue::default();
    low.enqueue_probe(probe(
        1,
        FRAME_BACKLOG_HIGH_WATER + 8,
        FRAME_BACKLOG_HIGH_WATER - 1,
        &low_log,
    ));
    low.enqueue_probe(probe(2, 2, 0, &low_log));
    low.advance(NonZeroUsize::new(2).expect("test budget is non-zero"));
    assert_eq!(*low_log.borrow(), [1, 2]);

    let high_log = Rc::new(RefCell::new(Vec::new()));
    let mut high = RuntimeCleanupQueue::default();
    high.enqueue_probe(probe(
        1,
        FRAME_BACKLOG_HIGH_WATER + 8,
        FRAME_BACKLOG_HIGH_WATER,
        &high_log,
    ));
    high.enqueue_probe(probe(2, 2, 0, &high_log));
    high.advance(NonZeroUsize::new(2).expect("test budget is non-zero"));
    assert_eq!(*high_log.borrow(), [1, 1]);
}

#[test]
fn frame_lane_is_round_robin_between_jobs() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(1, 3, 3, &log));
    queue.enqueue_probe(probe(2, 3, 3, &log));

    queue.advance(NonZeroUsize::new(4).expect("test budget is non-zero"));

    assert_eq!(*log.borrow(), [1, 2, 1, 2]);
    assert_eq!(queue.pending_frame_owner_count(), 2);
}

#[test]
fn one_fixed_service_makes_progress_without_claiming_frame_backpressure() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(999, RUNTIME_CLEANUP_QUANTUM, 0, &log));
    let budget = NonZeroUsize::new(RUNTIME_CLEANUP_QUANTUM).expect("cleanup quantum is non-zero");

    for spread_index in 0..FRAME_CACHE_CAPACITY {
        queue.enqueue_cached_frame(cached_frame(spread_index, 0));
    }
    let first = queue.advance(budget);

    assert_eq!(first.consumed_units, RUNTIME_CLEANUP_QUANTUM);
    assert_eq!(queue.pending_frame_owner_count(), FRAME_CACHE_CAPACITY);
    assert_eq!(queue.job_count(), FRAME_CACHE_CAPACITY + 1);

    let mut consumed_units = first.consumed_units;
    while !queue.is_empty() {
        consumed_units += queue.advance(budget).consumed_units;
    }
    assert_eq!(
        consumed_units,
        RUNTIME_CLEANUP_QUANTUM + 1 + FRAME_CACHE_CAPACITY * (EMPTY_MATERIALIZED_FRAME_UNITS + 1)
    );
    assert_eq!(queue.pending_frame_owner_count(), 0);
}

#[test]
fn repeated_completed_chapters_do_not_accumulate_behind_regular_backlog() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(999, 10_000, 0, &log));
    let budget = NonZeroUsize::new(RUNTIME_CLEANUP_QUANTUM).expect("cleanup quantum is non-zero");

    for _ in 0..128 {
        queue.enqueue_completed_chapter(empty_completed_chapter());
        queue.advance(budget);
        assert!(
            queue.job_count() <= 3,
            "one 42-unit arrival per 64-unit service must remain bounded"
        );
    }
}

#[test]
fn default_quantum_resumes_a_large_persistent_layout_config() {
    let mut layout_config = test_layout();
    layout_config.generic_serif_advances = (0..256)
        .map(|index| (format!("glyph-{index}"), index as f64))
        .collect();
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_continuation(RuntimeContinuationRecord::new(
        "revision".to_owned(),
        "layout".to_owned(),
        layout_config,
        LineBreaking::Greedy,
        0,
    ));
    let budget = NonZeroUsize::new(RUNTIME_CLEANUP_QUANTUM).expect("cleanup quantum is non-zero");

    let first = queue.advance(budget);

    assert_eq!(first.consumed_units, RUNTIME_CLEANUP_QUANTUM);
    assert!(!first.complete);
    assert_eq!(queue.pending_frame_owner_count(), 0);
    assert_eq!(queue.job_count(), 1);

    let mut consumed_units = first.consumed_units;
    while !queue.is_empty() {
        consumed_units += queue.advance(budget).consumed_units;
    }
    assert_eq!(consumed_units, 268);
}

#[test]
fn default_quantum_resumes_a_large_runtime_summary_chapter_map() {
    let mut revision = empty_revision();
    for chapter_index in 0..256 {
        revision.layout.summary.pagination_flow.chapter_map.insert(
            format!("chapter-{chapter_index}"),
            PaginationFlowChapterRange {
                start_page: chapter_index,
                end_page: chapter_index,
                page_count: 1,
                block_count: 1,
            },
        );
    }
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_revision(revision);
    let budget = NonZeroUsize::new(RUNTIME_CLEANUP_QUANTUM).expect("cleanup quantum is non-zero");

    let first = queue.advance(budget);

    assert_eq!(first.consumed_units, RUNTIME_CLEANUP_QUANTUM);
    assert!(!first.complete);
    assert_eq!(queue.pending_frame_owner_count(), 0);
    assert_eq!(queue.job_count(), 1);

    let mut consumed_units = first.consumed_units;
    while !queue.is_empty() {
        consumed_units += queue.advance(budget).consumed_units;
    }
    assert_eq!(consumed_units, 256 + 32);
}

#[test]
fn default_quantum_resumes_a_large_transient_layout_config() {
    let mut layout_config = test_layout();
    layout_config.generic_serif_advances = (0..256)
        .map(|index| (format!("glyph-{index}"), index as f64))
        .collect();
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_layout_config(layout_config);
    let budget = NonZeroUsize::new(RUNTIME_CLEANUP_QUANTUM).expect("cleanup quantum is non-zero");

    let first = queue.advance(budget);

    assert_eq!(first.consumed_units, RUNTIME_CLEANUP_QUANTUM);
    assert!(!first.complete);
    assert_eq!(queue.pending_frame_owner_count(), 0);
    assert_eq!(queue.job_count(), 1);

    let mut consumed_units = first.consumed_units;
    while !queue.is_empty() {
        consumed_units += queue.advance(budget).consumed_units;
    }
    assert_eq!(consumed_units, 263);
}

#[test]
fn queue_drop_drains_every_remaining_job_directly() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(1, 3, 2, &log));
    queue.enqueue_probe(probe(2, 2, 0, &log));
    queue.advance(NonZeroUsize::MIN);

    drop(queue);

    let log = log.borrow();
    assert_eq!(log.len(), 5);
    assert_eq!(log.iter().filter(|id| **id == 1).count(), 3);
    assert_eq!(log.iter().filter(|id| **id == 2).count(), 2);
}

#[test]
fn unwind_drains_partially_advanced_real_jobs() {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut queue = RuntimeCleanupQueue::default();
        enqueue_real_job_fixtures(&mut queue);
        queue.advance(NonZeroUsize::new(5).expect("test budget is non-zero"));
        panic!("force cleanup queue drop during unwind");
    }));

    assert!(result.is_err());
}

fn enqueue_real_job_fixtures(queue: &mut RuntimeCleanupQueue) {
    queue.enqueue_continuation(empty_continuation());
    queue.enqueue_completed_chapter(empty_completed_chapter());
    queue.enqueue_revision(empty_revision());
    queue.enqueue_frame_cache(RuntimeFrameCacheOwner::default());
    queue.enqueue_cached_frame(cached_frame(0, 0));
    queue.enqueue_layout_config(test_layout());
}

fn empty_completed_chapter() -> RuntimeChapterContinuation {
    let layout = test_layout();
    let mut session = RuntimeChapterLayoutSession::new(
        Vec::new(),
        ImageSizeIndex::new(&[]),
        &layout,
        LineBreaking::Greedy,
        None,
    );
    let advance = session.advance(
        LayoutWorkBudget::new(NonZeroUsize::MIN),
        &TextMeasurementFonts::empty(),
    );
    assert_eq!(advance.status, LayoutAdvanceStatus::Complete);
    RuntimeChapterContinuation::new(
        "chapter".to_owned(),
        session,
        BTreeSet::new(),
        Vec::new(),
        true,
    )
}

fn empty_continuation() -> RuntimeContinuationRecord {
    RuntimeContinuationRecord::new(
        "revision".to_owned(),
        "layout".to_owned(),
        test_layout(),
        LineBreaking::Greedy,
        0,
    )
}

fn empty_revision() -> RuntimeRevision {
    let layout_config = test_layout();
    RuntimeRevision::warming(
        create_empty_runtime_layout(1, &layout_config),
        layout_config,
        None,
        RuntimeRevisionInteractions {
            footnotes: BTreeMap::new(),
            chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(BTreeMap::new()),
            completed_chapter_idrefs: BTreeSet::new(),
        },
    )
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

fn probe(
    id: usize,
    remaining_units: usize,
    pending_frame_owner_count: usize,
    log: &Rc<RefCell<Vec<usize>>>,
) -> RuntimeCleanupProbe {
    RuntimeCleanupProbe {
        id,
        remaining_units,
        pending_frame_owner_count,
        log: Rc::clone(log),
    }
}
