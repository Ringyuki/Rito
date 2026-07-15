use std::{
    collections::{BTreeMap, BTreeSet},
    panic::{catch_unwind, AssertUnwindSafe},
};

use super::PendingRuntimeRevisionInteractionsVectorCleanup;
use crate::runtime::{
    frame::{RuntimeChapterTextIndexSource, RuntimeRevisionInteractions},
    RuntimeChapterTextIndex, RuntimeChapterTextSpan,
};

const DEEP_SPAN_COUNT: usize = 16_384;

#[test]
fn empty_vector_has_two_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingRuntimeRevisionInteractionsVectorCleanup::new(Vec::new());

    assert_eq!(drive_q1(&mut cleanup, 2), 2);
    assert!(!cleanup.advance_one());
}

#[test]
fn single_empty_materialized_owner_has_nine_exact_units() {
    let mut cleanup =
        PendingRuntimeRevisionInteractionsVectorCleanup::new(vec![interactions(BTreeMap::new())]);

    assert_eq!(drive_q1(&mut cleanup, 9), 9);
}

#[test]
fn production_shaped_materialized_owners_match_the_composed_formula() {
    let owners = vec![interactions(indices(0)), interactions(indices(3))];
    let mut cleanup = PendingRuntimeRevisionInteractionsVectorCleanup::new(owners);

    assert_eq!(drive_q1(&mut cleanup, 31), 31);
}

#[test]
fn nested_completion_and_vector_retirement_are_separate_units() {
    let mut cleanup =
        PendingRuntimeRevisionInteractionsVectorCleanup::new(vec![interactions(BTreeMap::new())]);

    advance_units(&mut cleanup, 7);
    assert!(!cleanup.is_complete());
    assert!(cleanup
        .active
        .as_ref()
        .is_some_and(|active| active.is_complete()));

    assert_one(&mut cleanup);
    assert!(cleanup.active.is_none());
    assert!(!cleanup.is_complete());

    assert_one(&mut cleanup);
    assert!(cleanup.is_complete());
}

#[test]
fn partial_drop_and_unwind_drain_active_and_unread_deep_span_owners() {
    let mut cleanup = PendingRuntimeRevisionInteractionsVectorCleanup::new(deep_owners());
    advance_units(&mut cleanup, 128);
    assert!(!cleanup.is_complete());
    drop(cleanup);

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeRevisionInteractionsVectorCleanup::new(deep_owners());
        advance_units(&mut cleanup, 128);
        assert!(!cleanup.is_complete());
        panic!("force interactions-vector cleanup during unwind");
    }));

    assert!(result.is_err());
}

fn drive_q1(
    cleanup: &mut PendingRuntimeRevisionInteractionsVectorCleanup,
    expected: usize,
) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "interactions vector exceeded its bound");
        assert_one(cleanup);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn assert_one(cleanup: &mut PendingRuntimeRevisionInteractionsVectorCleanup) {
    assert!(cleanup.advance_one());
}

fn advance_units(cleanup: &mut PendingRuntimeRevisionInteractionsVectorCleanup, units: usize) {
    for _ in 0..units {
        assert_one(cleanup);
    }
}

fn interactions(
    chapter_text_indices: BTreeMap<String, RuntimeChapterTextIndex>,
) -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        footnotes: BTreeMap::new(),
        chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(chapter_text_indices),
        completed_chapter_idrefs: BTreeSet::new(),
    }
}

fn indices(span_count: usize) -> BTreeMap<String, RuntimeChapterTextIndex> {
    BTreeMap::from([(
        "chapter".to_owned(),
        RuntimeChapterTextIndex {
            href: "chapter.xhtml".to_owned(),
            normalized_text: "normalized".to_owned(),
            spans: (0..span_count).map(text_span).collect(),
        },
    )])
}

fn text_span(index: usize) -> RuntimeChapterTextSpan {
    RuntimeChapterTextSpan {
        node_path: vec![index, index + 1],
        source_start: index,
        source_end: index + 1,
        normalized_start: index,
        normalized_end: index + 1,
    }
}

fn deep_owners() -> Vec<RuntimeRevisionInteractions> {
    vec![
        interactions(indices(DEEP_SPAN_COUNT)),
        interactions(indices(DEEP_SPAN_COUNT)),
    ]
}
