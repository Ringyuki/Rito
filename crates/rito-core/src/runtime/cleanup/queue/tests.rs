use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
    rc::Rc,
};

use super::{RuntimeCleanupProbe, RuntimeCleanupQueue, RUNTIME_CLEANUP_QUANTUM};
use crate::{
    layout::{create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode},
    runtime::{
        fragment_backend::FragmentBuiltLayout,
        frame::{RuntimeRevision, RuntimeRevisionCoordinateSpace, RuntimeRevisionInteractions},
    },
};

/// What releasing an empty revision costs, without the unit that retires
/// its job from the queue.
const EMPTY_REVISION_UNITS: usize = 7;

#[test]
fn empty_queue_reports_complete_without_consuming_budget() {
    let mut queue = RuntimeCleanupQueue::default();
    let progress = queue.advance(NonZeroUsize::MIN);

    assert_eq!(progress.consumed_units, 0);
    assert!(progress.complete);
}

#[test]
fn jobs_advance_round_robin_at_unit_quanta() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(1, 3, &log));
    queue.enqueue_probe(probe(2, 3, &log));

    let progress = queue.advance(NonZeroUsize::new(8).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 8);
    assert!(progress.complete);
    assert_eq!(*log.borrow(), [1, 2, 1, 2, 1, 2]);
}

#[test]
fn each_job_has_a_separate_queue_retirement_unit() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_revision(empty_revision());
    queue.enqueue_probe(probe(1, 3, &log));
    let all_units = (EMPTY_REVISION_UNITS + 1) + (3 + 1);

    let progress =
        queue.advance(NonZeroUsize::new(all_units - 1).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, all_units - 1);
    assert!(!progress.complete);
    assert_eq!(queue.job_count(), 1);
    let retirement = queue.advance(NonZeroUsize::MIN);
    assert_eq!(retirement.consumed_units, 1);
    assert!(retirement.complete);
}

#[test]
fn repeated_revisions_do_not_accumulate_behind_a_long_job() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(999, 10_000, &log));
    let budget = NonZeroUsize::new(RUNTIME_CLEANUP_QUANTUM).expect("cleanup quantum is non-zero");

    for _ in 0..128 {
        queue.enqueue_revision(empty_revision());
        queue.advance(budget);
        assert!(
            queue.job_count() <= 2,
            "one 8-unit arrival per 64-unit service must remain bounded"
        );
    }
}

#[test]
fn queue_drop_drains_every_remaining_job_directly() {
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_probe(probe(1, 3, &log));
    queue.enqueue_probe(probe(2, 2, &log));
    queue.advance(NonZeroUsize::MIN);

    drop(queue);

    let log = log.borrow();
    assert_eq!(log.len(), 5);
    assert_eq!(log.iter().filter(|id| **id == 1).count(), 3);
    assert_eq!(log.iter().filter(|id| **id == 2).count(), 2);
}

#[test]
fn unwind_drains_a_partially_released_revision() {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut queue = RuntimeCleanupQueue::default();
        queue.enqueue_revision(empty_revision());
        queue.enqueue_revision(empty_revision());
        queue.advance(NonZeroUsize::new(5).expect("test budget is non-zero"));
        panic!("force cleanup queue drop during unwind");
    }));

    assert!(result.is_err());
}

fn empty_revision() -> RuntimeRevision {
    RuntimeRevision::new(
        RuntimeRevisionCoordinateSpace::Absolute,
        test_layout(),
        BTreeMap::new(),
        None,
        RuntimeRevisionInteractions {
            publication_footnotes: None,
            footnotes: BTreeMap::new(),
            pending_footnote_keys: crate::interaction::FootnoteTargetSet::default(),
            footnote_index_complete: false,
            completed_chapter_idrefs: BTreeSet::new(),
        },
        FragmentBuiltLayout::empty(),
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
        device_pixel_ratio: 1.0,
    })
}

fn probe(id: usize, remaining_units: usize, log: &Rc<RefCell<Vec<usize>>>) -> RuntimeCleanupProbe {
    RuntimeCleanupProbe {
        id,
        remaining_units,
        log: Rc::clone(log),
    }
}
