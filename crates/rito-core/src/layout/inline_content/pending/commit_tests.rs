use std::{num::NonZeroUsize, sync::Arc};

use serde_json::Map;

use super::{
    commit::{checked_post_commit_len, PendingSegmentCommit},
    frame::TextSegmentSummary,
};
use crate::layout::{
    inline_segment::{AtomSegment, InlineSegment, TextSegment},
    text_mapping::TextSegmentMapping,
    text_work::{AtomicTextOperationKind, TextWorkBudget, TextWorkMeter, TextWorkPermitResult},
};

mod integration;

#[test]
fn spare_capacity_commits_after_the_atomic_slot_is_exhausted() {
    let mut output = Vec::with_capacity(2);
    output.push(atom_segment("seed"));
    let mut commit = PendingSegmentCommit::new(text_segment("tail"));
    let mut work = meter(2, 1);
    exhaust_atomic_slot(&mut work);

    let text_index = commit
        .advance(&mut output, &mut work)
        .expect("spare capacity needs no atomic admission");

    assert_eq!(text_index, Some(1));
    assert_eq!(output.len(), 2);
    assert_eq!(work.atomic_operations_remaining(), 0);
}

#[test]
fn full_capacity_admission_is_not_replayed_after_the_append_yields() {
    let mut output = Vec::new();
    let mut commit = PendingSegmentCommit::new(text_segment("tail"));
    let mut first = meter(1, 1);

    assert!(commit.advance(&mut output, &mut first).is_err());
    assert!(matches!(commit, PendingSegmentCommit::Ready(_)));
    assert!(output.is_empty());
    assert_eq!(first.atomic_operations_remaining(), 0);

    let mut second = meter(1, 1);
    assert_eq!(
        commit
            .advance(&mut output, &mut second)
            .expect("ready commits do not repeat capacity admission"),
        Some(0)
    );
    assert_eq!(output.len(), 1);
    assert_eq!(second.atomic_operations_remaining(), 1);
}

#[test]
fn full_nonempty_capacity_charges_the_post_commit_length() {
    let mut output = exact_segments((0..3).map(|index| atom_segment(&index.to_string())));
    let mut commit = PendingSegmentCommit::new(text_segment("tail"));
    let mut reserve = meter(4, 1);

    assert!(
        commit.advance(&mut output, &mut reserve).is_err(),
        "a post-commit length of four must leave no append unit"
    );
    assert!(matches!(commit, PendingSegmentCommit::Ready(_)));
    assert_eq!(output.len(), 3);
    assert_eq!(reserve.utf16_units_remaining(), 0);

    let mut append = meter(1, 1);
    assert_eq!(
        commit
            .advance(&mut output, &mut append)
            .expect("the retained commit appends without another admission"),
        Some(3)
    );
    assert_eq!(output.len(), 4);
    assert_eq!(append.atomic_operations_remaining(), 1);
}

#[test]
fn oversized_growth_waits_for_fresh_work_then_retains_ready_state() {
    let mut output = exact_segments((0..8).map(|index| atom_segment(&index.to_string())));
    let mut commit = PendingSegmentCommit::new(atom_segment("tail"));

    let mut non_fresh = meter(4, 1);
    assert_eq!(non_fresh.take_utf16_units(1), 1);
    assert!(commit.advance(&mut output, &mut non_fresh).is_err());
    assert!(matches!(commit, PendingSegmentCommit::Reserving { .. }));
    assert_eq!(output.len(), 8);
    assert_eq!(non_fresh.atomic_operations_remaining(), 1);

    let mut fresh = meter(4, 1);
    assert!(commit.advance(&mut output, &mut fresh).is_err());
    assert!(matches!(commit, PendingSegmentCommit::Ready(_)));
    assert_eq!(output.len(), 8);
    assert_eq!(fresh.atomic_operations_remaining(), 0);
    assert_eq!(fresh.utf16_units_remaining(), 0);

    let mut append = meter(1, 1);
    assert_eq!(
        commit
            .advance(&mut output, &mut append)
            .expect("the retained ready state appends exactly once"),
        None
    );
    assert_eq!(output.len(), 9);
    assert_eq!(append.atomic_operations_remaining(), 1);
}

#[test]
fn exhausted_slot_keeps_the_reserving_state_for_a_later_quantum() {
    let mut output = Vec::new();
    let mut commit = PendingSegmentCommit::new(atom_segment("tail"));
    let mut exhausted = meter(2, 1);
    exhaust_atomic_slot(&mut exhausted);

    assert!(commit.advance(&mut output, &mut exhausted).is_err());
    assert!(matches!(commit, PendingSegmentCommit::Reserving { .. }));
    assert!(output.is_empty());

    let mut retry = meter(2, 1);
    assert_eq!(
        commit
            .advance(&mut output, &mut retry)
            .expect("a later quantum admits and appends the retained segment"),
        None
    );
    assert_eq!(output.len(), 1);
    assert_eq!(retry.atomic_operations_remaining(), 0);
}

#[test]
fn text_summary_changes_only_after_a_successful_text_push() {
    let mut output = Vec::new();
    let mut summary = TextSegmentSummary::default();
    let mut commit = PendingSegmentCommit::new(text_segment("text"));
    let mut reserve = meter(1, 1);
    assert!(commit.advance(&mut output, &mut reserve).is_err());

    assert!(output.is_empty());
    assert_eq!((summary.first, summary.last), (None, None));

    let mut append = meter(1, 1);
    if let Some(index) = commit
        .advance(&mut output, &mut append)
        .expect("the text append completes")
    {
        summary.include(index);
    }
    assert_eq!((summary.first, summary.last), (Some(0), Some(0)));

    let mut atom_output = Vec::with_capacity(1);
    let mut atom_work = meter(1, 1);
    assert_eq!(
        PendingSegmentCommit::new(atom_segment("atom"))
            .advance(&mut atom_output, &mut atom_work)
            .expect("spare capacity appends an atom"),
        None
    );
    assert_eq!(atom_output.len(), 1);
    assert_eq!((summary.first, summary.last), (Some(0), Some(0)));
}

#[test]
fn cancelling_reserving_and_ready_states_never_publishes_the_segment() {
    let reserving_source: Arc<str> = Arc::from("reserving owned source");
    let mut reserving_output = Vec::new();
    let mut exhausted = meter(1, 1);
    exhaust_atomic_slot(&mut exhausted);
    let mut reserving = PendingSegmentCommit::new(text_segment_with_source(
        "owned",
        Arc::clone(&reserving_source),
    ));
    assert!(reserving
        .advance(&mut reserving_output, &mut exhausted)
        .is_err());
    assert!(matches!(reserving, PendingSegmentCommit::Reserving { .. }));
    assert_eq!(Arc::strong_count(&reserving_source), 2);
    drop(reserving);
    assert_eq!(Arc::strong_count(&reserving_source), 1);
    assert!(reserving_output.is_empty());

    let ready_source: Arc<str> = Arc::from("ready owned source");
    let mut ready_output = Vec::new();
    let mut reserve = meter(1, 1);
    let mut ready =
        PendingSegmentCommit::new(text_segment_with_source("owned", Arc::clone(&ready_source)));
    assert!(ready.advance(&mut ready_output, &mut reserve).is_err());
    assert!(matches!(ready, PendingSegmentCommit::Ready(_)));
    assert_eq!(Arc::strong_count(&ready_source), 2);
    drop(ready);
    assert_eq!(Arc::strong_count(&ready_source), 1);
    assert!(ready_output.is_empty());
}

#[test]
fn checked_post_commit_length_rejects_overflow() {
    assert_eq!(checked_post_commit_len(0), Some(1));
    assert_eq!(checked_post_commit_len(usize::MAX), None);
}

fn meter(utf16_units: usize, atomic_operations: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(utf16_units).expect("test text budget is non-zero"),
        NonZeroUsize::new(atomic_operations).expect("test atomic budget is non-zero"),
    ))
}

fn exhaust_atomic_slot(work: &mut TextWorkMeter) {
    assert!(matches!(
        work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
        TextWorkPermitResult::Permit { .. }
    ));
}

fn exact_segments(segments: impl IntoIterator<Item = InlineSegment>) -> Vec<InlineSegment> {
    segments
        .into_iter()
        .collect::<Vec<_>>()
        .into_boxed_slice()
        .into_vec()
}

fn text_segment(text: &str) -> InlineSegment {
    InlineSegment::Text(TextSegment {
        text: text.to_owned(),
        mapping: TextSegmentMapping::synthetic(),
        style: Map::new(),
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    })
}

fn text_segment_with_source(text: &str, source_text: Arc<str>) -> InlineSegment {
    let mut segment = text_segment(text);
    let InlineSegment::Text(text) = &mut segment else {
        unreachable!("the helper always creates a text segment")
    };
    text.source_text = Some(source_text);
    segment
}

fn atom_segment(label: &str) -> InlineSegment {
    InlineSegment::Atom(AtomSegment {
        width: 1.0,
        height: 1.0,
        style: Map::new(),
        image_src: Some(label.to_owned()),
        alt: None,
        href: None,
        source_path: None,
    })
}
