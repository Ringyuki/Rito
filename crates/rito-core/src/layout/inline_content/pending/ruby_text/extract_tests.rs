use std::num::NonZeroUsize;

use serde_json::Map;

use super::{
    growth::{checked_post_frame_depth, checked_post_part_count},
    text_scan::PendingTextScan,
    PendingRubyAnnotation,
};
use crate::{
    layout::text_work::{
        AtomicTextOperationKind, TextWorkBudget, TextWorkMeter, TextWorkPermitResult,
    },
    style::{StyledNode, StyledNodeKind},
};

#[test]
fn initial_frame_denial_retains_the_root_and_consumes_no_units() {
    let mut pending = PendingRubyAnnotation::new(vec![text("root")]);
    let mut work = meter(8, 1);
    exhaust_atomic_slot(&mut work);

    assert!(pending.advance_scan(&mut work).is_err());
    assert!(pending.has_initial_frame());
    assert!(pending.frames.is_empty());
    assert_eq!(work.utf16_units_remaining(), 8);
}

#[test]
fn initial_frame_admission_survives_unit_yield_and_push_never_grows() {
    let mut pending = PendingRubyAnnotation::new(vec![bare_text()]);
    let mut reserve = meter(1, 1);

    assert!(pending.advance_scan(&mut reserve).is_err());
    assert!(!pending.has_initial_frame());
    assert_eq!(pending.frames.len(), 1);
    assert_eq!(pending.frames[0].as_slice().len(), 1);
    assert_eq!(reserve.atomic_operations_remaining(), 0);
    let capacity = pending.frames.capacity();

    let mut retry = meter(1, 1);
    exhaust_atomic_slot(&mut retry);
    assert!(pending.advance_scan(&mut retry).is_err());
    assert!(pending.frames[0].as_slice().is_empty());
    assert_eq!(pending.frames.capacity(), capacity);
}

#[test]
fn draining_an_unadmitted_root_preserves_all_owned_nodes() {
    let mut pending = PendingRubyAnnotation::new(vec![text("first"), text("second")]);
    let mut drained = Vec::new();

    pending.drain_nodes_into(&mut drained);

    assert!(!pending.has_initial_frame());
    assert_eq!(drained.len(), 2);
    assert_eq!(drained[0].content.as_deref(), Some("first"));
    assert_eq!(drained[1].content.as_deref(), Some("second"));
}

#[test]
fn child_frame_denial_precedes_unit_and_parent_consumption() {
    let mut pending = annotation_with_exact_frames(vec![branch(Vec::new())], 1);
    let capacity = pending.frames.capacity();
    let mut work = meter(8, 1);
    exhaust_atomic_slot(&mut work);

    assert!(pending.advance_scan(&mut work).is_err());
    assert_eq!(pending.frames.len(), 1);
    assert_eq!(pending.frames[0].as_slice().len(), 1);
    assert_eq!(pending.frames.capacity(), capacity);
    assert_eq!(work.utf16_units_remaining(), 8);
}

#[test]
fn child_frame_reserve_survives_unit_yield_and_empty_children_still_push() {
    let mut pending = annotation_with_exact_frames(vec![branch(Vec::new())], 1);
    let mut reserve = meter(2, 1);

    assert!(pending.advance_scan(&mut reserve).is_err());
    assert_eq!(pending.frames.len(), 1);
    assert_eq!(pending.frames[0].as_slice().len(), 1);
    assert!(pending.frame_slot_available());
    let capacity = pending.frames.capacity();

    let mut retry = meter(1, 1);
    exhaust_atomic_slot(&mut retry);
    assert!(pending.advance_scan(&mut retry).is_err());
    assert_eq!(pending.frames.len(), 2);
    assert!(pending
        .frames
        .iter()
        .all(|frame| frame.as_slice().is_empty()));
    assert_eq!(pending.frames.capacity(), capacity);
}

#[test]
fn spare_child_frame_capacity_costs_no_atomic_operation() {
    let mut pending = PendingRubyAnnotation::new(Vec::new());
    pending.initial_frame = None;
    pending.frames = Vec::with_capacity(2);
    pending.frames.push(vec![branch(Vec::new())].into_iter());
    let capacity = pending.frames.capacity();
    let mut work = meter(1, 1);
    exhaust_atomic_slot(&mut work);

    assert!(pending.advance_scan(&mut work).is_err());
    assert_eq!(pending.frames.len(), 2);
    assert_eq!(pending.frames.capacity(), capacity);
    assert_eq!(work.atomic_operations_remaining(), 0);
}

#[test]
fn oversized_child_growth_waits_for_fresh_work_and_pushes_without_growth() {
    let mut pending = annotation_with_exact_frames(Vec::new(), 8);
    let original_capacity = pending.frames.capacity();
    let mut non_fresh = meter(4, 1);
    assert_eq!(non_fresh.take_utf16_units(1), 1);

    assert!(pending.ensure_frame_slot(&mut non_fresh).is_err());
    assert_eq!(pending.frames.capacity(), original_capacity);
    assert_eq!(non_fresh.atomic_operations_remaining(), 1);

    let mut fresh = meter(4, 1);
    pending
        .ensure_frame_slot(&mut fresh)
        .expect("fresh work admits oversized annotation frame growth");
    let capacity = pending.frames.capacity();
    pending.push_reserved_frame(Vec::new().into_iter());
    assert_eq!(pending.frames.len(), 9);
    assert_eq!(pending.frames.capacity(), capacity);
    assert_eq!(fresh.utf16_units_remaining(), 0);
    assert_eq!(fresh.atomic_operations_remaining(), 0);
}

#[test]
fn checked_frame_depth_rejects_overflow() {
    assert_eq!(checked_post_frame_depth(3), Some(4));
    assert_eq!(checked_post_frame_depth(usize::MAX), None);
}

#[test]
fn part_denial_retains_completed_text_and_retry_does_not_recount_it() {
    let mut pending = annotation_with_completed_candidate("😀", exact_vec(Vec::<String>::new()));
    let mut denied = meter(2, 1);
    exhaust_atomic_slot(&mut denied);

    assert!(pending.advance_scan(&mut denied).is_err());
    assert!(pending.has_completed_text_waiting_for_part_capacity());
    assert!(pending.parts.is_empty());
    assert_eq!((pending.byte_len, pending.utf16_len), (4, 2));

    let mut retry = meter(1, 1);
    assert!(pending.advance_scan(&mut retry).is_err());
    assert!(pending.active_text.is_none());
    assert_eq!(pending.parts, ["😀"]);
    assert_eq!((pending.byte_len, pending.utf16_len), (4, 2));
    assert_eq!(retry.atomic_operations_remaining(), 0);
}

#[test]
fn spare_part_capacity_costs_no_atomic_operation() {
    let mut parts = Vec::with_capacity(1);
    let capacity = parts.capacity();
    let mut pending = annotation_with_completed_candidate("x", std::mem::take(&mut parts));
    let mut work = meter(1, 1);
    exhaust_atomic_slot(&mut work);

    assert!(pending.advance_scan(&mut work).is_err());
    assert!(pending.active_text.is_none());
    assert_eq!(pending.parts, ["x"]);
    assert_eq!(pending.parts.capacity(), capacity);
    assert_eq!(work.atomic_operations_remaining(), 0);
}

#[test]
fn oversized_part_growth_waits_for_fresh_work_and_pushes_without_growth() {
    let mut pending = PendingRubyAnnotation::new(Vec::new());
    pending.parts = exact_vec((0..8).map(|index| index.to_string()).collect());
    let original_capacity = pending.parts.capacity();
    let mut non_fresh = meter(4, 1);
    assert_eq!(non_fresh.take_utf16_units(1), 1);

    assert!(pending.ensure_part_slot(&mut non_fresh).is_err());
    assert_eq!(pending.parts.capacity(), original_capacity);
    assert_eq!(non_fresh.atomic_operations_remaining(), 1);

    let mut fresh = meter(4, 1);
    pending
        .ensure_part_slot(&mut fresh)
        .expect("fresh work admits oversized annotation part growth");
    let capacity = pending.parts.capacity();
    pending.push_reserved_part("tail".to_owned());
    assert_eq!(pending.parts.len(), 9);
    assert_eq!(pending.parts.capacity(), capacity);
    assert_eq!(fresh.utf16_units_remaining(), 0);
    assert_eq!(fresh.atomic_operations_remaining(), 0);
}

#[test]
fn checked_part_count_rejects_overflow() {
    assert_eq!(checked_post_part_count(3), Some(4));
    assert_eq!(checked_post_part_count(usize::MAX), None);
}

fn annotation_with_completed_candidate(content: &str, parts: Vec<String>) -> PendingRubyAnnotation {
    let mut pending = annotation_with_exact_frames(Vec::new(), 1);
    pending.active_text = Some(PendingTextScan::new(content.to_owned()));
    pending.parts = parts;
    pending
}

fn annotation_with_exact_frames(nodes: Vec<StyledNode>, depth: usize) -> PendingRubyAnnotation {
    assert!(depth > 0);
    let mut frames = (0..depth)
        .map(|_| Vec::new().into_iter())
        .collect::<Vec<_>>();
    *frames.last_mut().expect("a non-empty frame stack exists") = nodes.into_iter();
    let mut pending = PendingRubyAnnotation::new(Vec::new());
    pending.initial_frame = None;
    pending.frames = frames.into_boxed_slice().into_vec();
    assert_eq!(pending.frames.len(), pending.frames.capacity());
    pending
}

fn meter(utf16_units: usize, atomic_operations: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(utf16_units).expect("unit budget is non-zero"),
        NonZeroUsize::new(atomic_operations).expect("operation budget is non-zero"),
    ))
}

fn exhaust_atomic_slot(work: &mut TextWorkMeter) {
    assert!(matches!(
        work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
        TextWorkPermitResult::Permit { .. }
    ));
}

fn exact_vec<T>(items: Vec<T>) -> Vec<T> {
    items.into_boxed_slice().into_vec()
}

fn branch(children: Vec<StyledNode>) -> StyledNode {
    node(StyledNodeKind::Block, children, None)
}

fn text(content: &str) -> StyledNode {
    node(StyledNodeKind::Text, Vec::new(), Some(content))
}

fn bare_text() -> StyledNode {
    node(StyledNodeKind::Text, Vec::new(), None)
}

fn node(node_type: StyledNodeKind, children: Vec<StyledNode>, content: Option<&str>) -> StyledNode {
    StyledNode {
        node_type,
        tag: None,
        content: content.map(ToOwned::to_owned),
        source_text: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: Map::new(),
        children,
        source_ref: None,
    }
}
