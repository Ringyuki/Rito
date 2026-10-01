use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use super::{PendingRuntimeRevisionInteractionsCleanup, RuntimeRevisionInteractionsCleanupStage};
use crate::{
    interaction::{FootnoteEntry, FootnoteKind},
    runtime::frame::RuntimeRevisionInteractions,
};

const WIDE_OWNER_COUNT: usize = 16_384;

#[test]
fn empty_interactions_have_three_exact_units() {
    let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
        BTreeMap::new(),
        BTreeSet::new(),
    ));

    assert_eq!(drive_q1(&mut cleanup, 3), 3);
}

#[test]
fn mixed_payload_matches_the_formula() {
    let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
        footnotes(2),
        completed_idrefs(3),
    ));

    let expected = 2 + 3 + 3;
    assert_eq!(drive_q1(&mut cleanup, expected), expected);
}

#[test]
fn sources_and_retirement_have_separate_units() {
    let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
        footnotes(1),
        completed_idrefs(1),
    ));

    assert_one(&mut cleanup);
    assert_eq!(
        cleanup.stage,
        RuntimeRevisionInteractionsCleanupStage::Footnotes
    );
    assert_eq!(
        cleanup.footnotes.as_ref().map(ExactSizeIterator::len),
        Some(1)
    );

    assert_one(&mut cleanup);
    assert_eq!(
        cleanup.footnotes.as_ref().map(ExactSizeIterator::len),
        Some(0)
    );
    assert_one(&mut cleanup);
    assert!(cleanup.footnotes.is_none());
    assert_eq!(
        cleanup.stage,
        RuntimeRevisionInteractionsCleanupStage::CompletedChapterIdrefs
    );
    assert_eq!(drive_q1(&mut cleanup, 2), 2);
}

#[test]
fn wide_payload_is_exact_under_single_unit_scheduling() {
    let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
        footnotes(WIDE_OWNER_COUNT),
        completed_idrefs(WIDE_OWNER_COUNT),
    ));
    let expected = WIDE_OWNER_COUNT * 2 + 3;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);
}

#[test]
fn immediate_and_partial_unwind_drops_drain_wide_sources() {
    drop(PendingRuntimeRevisionInteractionsCleanup::new(
        interactions(
            footnotes(WIDE_OWNER_COUNT),
            completed_idrefs(WIDE_OWNER_COUNT),
        ),
    ));

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
            footnotes(WIDE_OWNER_COUNT),
            completed_idrefs(WIDE_OWNER_COUNT),
        ));
        let progress =
            cleanup.advance(NonZeroUsize::new(128).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force interactions cleanup during unwind");
    }));

    assert!(result.is_err());
}

fn drive_q1(cleanup: &mut PendingRuntimeRevisionInteractionsCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "interactions cleanup exceeded its bound");
        assert_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_one(cleanup: &mut PendingRuntimeRevisionInteractionsCleanup) {
    let progress = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(progress.consumed_units, 1);
}

fn interactions(
    footnotes: BTreeMap<String, FootnoteEntry>,
    completed_chapter_idrefs: BTreeSet<String>,
) -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        publication_footnotes: None,
        footnotes,
        pending_footnote_keys: crate::interaction::FootnoteTargetSet::default(),
        footnote_index_complete: false,
        completed_chapter_idrefs,
    }
}

fn footnotes(count: usize) -> BTreeMap<String, FootnoteEntry> {
    (0..count)
        .map(|index| {
            (
                format!("note-{index}"),
                FootnoteEntry {
                    kind: FootnoteKind::Footnote,
                    text: format!("text-{index}"),
                    html: format!("<p>{index}</p>"),
                },
            )
        })
        .collect()
}

fn completed_idrefs(count: usize) -> BTreeSet<String> {
    (0..count).map(|index| format!("done-{index}")).collect()
}
