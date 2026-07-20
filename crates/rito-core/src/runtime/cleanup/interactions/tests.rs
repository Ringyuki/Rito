use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use super::{PendingRuntimeRevisionInteractionsCleanup, RuntimeRevisionInteractionsCleanupStage};
use crate::{
    interaction::{FootnoteEntry, FootnoteKind},
    runtime::{
        frame::{RuntimeChapterTextIndexSource, RuntimeRevisionInteractions},
        RuntimeChapterTextIndex, RuntimeChapterTextSpan,
    },
};

const WIDE_OWNER_COUNT: usize = 16_384;

#[test]
fn empty_full_document_has_five_exact_units() {
    let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
        BTreeMap::new(),
        RuntimeChapterTextIndexSource::FullDocument,
        BTreeSet::new(),
    ));

    assert_eq!(drive_q1(&mut cleanup, 5), 5);
}

#[test]
fn empty_materialized_source_has_six_exact_units() {
    let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
        BTreeMap::new(),
        RuntimeChapterTextIndexSource::Materialized(BTreeMap::new()),
        BTreeSet::new(),
    ));

    assert_eq!(drive_q1(&mut cleanup, 6), 6);
}

#[test]
fn mixed_materialized_payload_matches_the_composed_formula() {
    let footnotes = footnotes(2);
    let completed = completed_idrefs(3);
    let indices = BTreeMap::from([
        ("empty".to_owned(), chapter_index(0, 0)),
        ("populated".to_owned(), chapter_index(1, 3)),
    ]);
    let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
        footnotes,
        RuntimeChapterTextIndexSource::Materialized(indices),
        completed,
    ));

    let expected = 2 + 3 + 6 + 6 + 9;
    assert_eq!(drive_q1(&mut cleanup, expected), expected);
}

#[test]
fn sources_and_nested_retirement_have_separate_units() {
    let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
        footnotes(1),
        RuntimeChapterTextIndexSource::FullDocument,
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
        RuntimeRevisionInteractionsCleanupStage::ChapterTextIndices
    );

    assert_one(&mut cleanup);
    assert!(cleanup
        .chapter_text_indices
        .as_ref()
        .is_some_and(|source| source.is_complete()));
    assert_one(&mut cleanup);
    assert!(cleanup.chapter_text_indices.is_none());
    assert_eq!(
        cleanup.stage,
        RuntimeRevisionInteractionsCleanupStage::CompletedChapterIdrefs
    );
    assert_eq!(drive_q1(&mut cleanup, 2), 2);
}

#[test]
fn wide_payload_is_exact_under_single_unit_scheduling() {
    let indices = (0..WIDE_OWNER_COUNT)
        .map(|index| (format!("chapter-{index}"), chapter_index(index, 1)))
        .collect();
    let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(interactions(
        footnotes(WIDE_OWNER_COUNT),
        RuntimeChapterTextIndexSource::Materialized(indices),
        completed_idrefs(WIDE_OWNER_COUNT),
    ));
    let expected = WIDE_OWNER_COUNT * 2 + 6 + WIDE_OWNER_COUNT * 7;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);
}

#[test]
fn immediate_and_partial_unwind_drops_drain_deep_span_sources() {
    drop(PendingRuntimeRevisionInteractionsCleanup::new(
        deep_span_interactions(),
    ));

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeRevisionInteractionsCleanup::new(deep_span_interactions());
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
    chapter_text_indices: RuntimeChapterTextIndexSource,
    completed_chapter_idrefs: BTreeSet<String>,
) -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        publication_footnotes: None,
        footnotes,
        pending_footnote_keys: crate::interaction::FootnoteTargetSet::default(),
        footnote_index_complete: false,
        chapter_text_indices,
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

fn chapter_index(index: usize, span_count: usize) -> RuntimeChapterTextIndex {
    RuntimeChapterTextIndex {
        href: format!("chapter-{index}.xhtml"),
        normalized_text: format!("normalized-{index}"),
        spans: (0..span_count).map(text_span).collect(),
    }
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

fn deep_span_interactions() -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        publication_footnotes: None,
        footnotes: BTreeMap::new(),
        pending_footnote_keys: crate::interaction::FootnoteTargetSet::default(),
        footnote_index_complete: false,
        chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(BTreeMap::from([(
            "deep".to_owned(),
            chapter_index(0, WIDE_OWNER_COUNT),
        )])),
        completed_chapter_idrefs: BTreeSet::new(),
    }
}
