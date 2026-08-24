use std::num::NonZeroUsize;

use super::{PendingReserve, ReserveStep, Transition};
use crate::layout::{
    text_mapping::finalize::pending::{FlowCounts, FlowDraft},
    text_work::{AtomicTextOperationKind, TextWorkBudget, TextWorkMeter, TextWorkPermitResult},
};

#[test]
fn non_fresh_growth_denial_preserves_the_reserve_and_its_buffers() {
    let mut pending = PendingReserve::new(counts(24, 8, 2, 3));
    let before = allocations(draft(&pending));
    let mut work = meter(8, 2);
    assert_eq!(work.take_utf16_units(1), 1);

    assert!(pending.advance(&mut work).is_err());

    assert_eq!(pending.step, ReserveStep::Text);
    assert_eq!(allocations(draft(&pending)), before);
    assert_eq!(work.utf16_units_remaining(), 7);
    assert_eq!(work.atomic_operations_remaining(), 2);
}

#[test]
fn fresh_oversized_growth_admits_only_one_reserve_step() {
    let mut pending = PendingReserve::new(counts(36, 12, 4, 3));
    let mut work = meter(8, 2);

    assert!(matches!(pending.advance(&mut work), Ok(Transition::Stay)));
    assert_eq!(pending.step, ReserveStep::NonBoundaries);
    assert!(draft(&pending).text.capacity() >= 36);
    assert_eq!(draft(&pending).non_boundaries.capacity(), 0);
    assert_eq!(work.utf16_units_remaining(), 0);
    assert_eq!(work.atomic_operations_remaining(), 1);

    let after_text = allocations(draft(&pending));
    assert!(pending.advance(&mut work).is_err());
    assert_eq!(pending.step, ReserveStep::NonBoundaries);
    assert_eq!(allocations(draft(&pending)), after_text);
    assert_eq!(work.atomic_operations_remaining(), 1);
}

#[test]
fn retry_never_recharges_or_moves_completed_reserve_steps() {
    let mut pending = PendingReserve::new(counts(36, 12, 4, 3));
    let after_text = admit_growth(&mut pending, 8, ReserveStep::NonBoundaries);

    let mut denied = meter(4, 2);
    assert_eq!(denied.take_utf16_units(1), 1);
    assert!(pending.advance(&mut denied).is_err());
    assert_eq!(pending.step, ReserveStep::NonBoundaries);
    assert_eq!(allocations(draft(&pending)), after_text);
    assert_eq!(denied.atomic_operations_remaining(), 2);

    let after_boundaries = admit_growth(&mut pending, 4, ReserveStep::Spans);
    assert_eq!(after_boundaries.text, after_text.text);

    let after_spans = admit_growth(&mut pending, 3, ReserveStep::Assignments);
    assert_eq!(after_spans.text, after_text.text);
    assert_eq!(after_spans.non_boundaries, after_boundaries.non_boundaries);

    let mut assignment_work = meter(3, 1);
    let assembled = take_assembled(&mut pending, &mut assignment_work);
    assert_eq!(assignment_work.atomic_operations_remaining(), 0);
    let final_allocations = allocations(&assembled);
    assert_eq!(final_allocations.text, after_text.text);
    assert_eq!(
        final_allocations.non_boundaries,
        after_boundaries.non_boundaries
    );
    assert_eq!(final_allocations.spans, after_spans.spans);
    assert!(assembled.assignments.capacity() >= 3);
}

#[test]
fn text_growth_is_admitted_by_utf16_units_not_utf8_bytes() {
    let mut pending = PendingReserve::new(counts(12, 4, 0, 1));
    let mut work = meter(12, 1);
    assert_eq!(work.take_utf16_units(8), 8);

    assert!(matches!(pending.advance(&mut work), Ok(Transition::Stay)));

    assert_eq!(pending.step, ReserveStep::NonBoundaries);
    assert!(draft(&pending).text.capacity() >= 12);
    assert_eq!(work.utf16_units_remaining(), 0);
    assert_eq!(work.atomic_operations_remaining(), 0);
}

#[test]
fn bmp_zero_non_boundary_reserve_uses_a_unit_but_no_atomic_slot() {
    let mut pending = PendingReserve::new(counts(4, 4, 0, 1));
    let mut text_work = meter(4, 1);
    assert!(matches!(
        pending.advance(&mut text_work),
        Ok(Transition::Stay)
    ));
    assert_eq!(pending.step, ReserveStep::NonBoundaries);

    let mut work = meter(1, 1);
    assert!(matches!(
        work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
        TextWorkPermitResult::Permit { .. }
    ));
    assert_eq!(work.atomic_operations_remaining(), 0);

    assert!(matches!(pending.advance(&mut work), Ok(Transition::Stay)));
    assert_eq!(pending.step, ReserveStep::Spans);
    assert_eq!(draft(&pending).non_boundaries.capacity(), 0);
    assert_eq!(work.utf16_units_remaining(), 0);
    assert_eq!(work.atomic_operations_remaining(), 0);
}

#[test]
fn existing_spare_capacity_keeps_every_pointer_and_skips_atomic_work() {
    let counts = counts(8, 8, 2, 2);
    let mut pending = fully_reserved(counts);
    let before = allocations(draft(&pending));
    let mut work = meter(4, 1);
    exhaust_atomic_slot(&mut work);

    for expected in [
        ReserveStep::NonBoundaries,
        ReserveStep::Spans,
        ReserveStep::Assignments,
    ] {
        advance_stay(&mut pending, &mut work, expected);
        assert_eq!(allocations(draft(&pending)), before);
        assert_eq!(work.atomic_operations_remaining(), 0);
    }
    let assembled = take_assembled(&mut pending, &mut work);
    assert_eq!(allocations(&assembled), before);
    assert_eq!(work.utf16_units_remaining(), 0);
    assert_eq!(work.atomic_operations_remaining(), 0);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Allocation {
    pointer: usize,
    capacity: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DraftAllocations {
    text: Allocation,
    non_boundaries: Allocation,
    spans: Allocation,
    assignments: Allocation,
}

fn allocations(draft: &FlowDraft) -> DraftAllocations {
    DraftAllocations {
        text: Allocation {
            pointer: draft.text.as_ptr() as usize,
            capacity: draft.text.capacity(),
        },
        non_boundaries: Allocation {
            pointer: draft.non_boundaries.as_ptr() as usize,
            capacity: draft.non_boundaries.capacity(),
        },
        spans: Allocation {
            pointer: draft.spans.as_ptr() as usize,
            capacity: draft.spans.capacity(),
        },
        assignments: Allocation {
            pointer: draft.assignments.as_ptr() as usize,
            capacity: draft.assignments.capacity(),
        },
    }
}

fn draft(pending: &PendingReserve) -> &FlowDraft {
    pending.draft.as_ref().expect("reserve draft")
}

fn fully_reserved(counts: FlowCounts) -> PendingReserve {
    let mut pending = PendingReserve::new(counts);
    let draft = pending.draft.as_mut().expect("reserve draft");
    draft.text = String::with_capacity(counts.text_bytes);
    draft.non_boundaries = Vec::with_capacity(counts.non_boundaries);
    draft.spans = Vec::with_capacity(counts.candidate_count);
    draft.assignments = Vec::with_capacity(counts.candidate_count);
    pending
}

fn admit_growth(
    pending: &mut PendingReserve,
    utf16_units: usize,
    expected_step: ReserveStep,
) -> DraftAllocations {
    let mut work = meter(utf16_units, 1);
    advance_stay(pending, &mut work, expected_step);
    assert_eq!(work.atomic_operations_remaining(), 0);
    allocations(draft(pending))
}

fn advance_stay(
    pending: &mut PendingReserve,
    work: &mut TextWorkMeter,
    expected_step: ReserveStep,
) {
    assert!(matches!(pending.advance(work), Ok(Transition::Stay)));
    assert_eq!(pending.step, expected_step);
}

fn take_assembled(pending: &mut PendingReserve, work: &mut TextWorkMeter) -> FlowDraft {
    match pending.advance(work) {
        Ok(Transition::Assemble(draft)) => draft,
        _ => panic!("the final reserve must publish its draft"),
    }
}

fn exhaust_atomic_slot(work: &mut TextWorkMeter) {
    assert!(matches!(
        work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
        TextWorkPermitResult::Permit { .. }
    ));
}

const fn counts(
    text_bytes: usize,
    utf16_len: u32,
    non_boundaries: usize,
    candidate_count: usize,
) -> FlowCounts {
    FlowCounts {
        text_bytes,
        utf16_len,
        non_boundaries,
        candidate_count,
    }
}

fn meter(max_utf16_units: usize, max_atomic_operations: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(max_utf16_units).expect("UTF-16 budget is non-zero"),
        NonZeroUsize::new(max_atomic_operations).expect("atomic budget is non-zero"),
    ))
}
