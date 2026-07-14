use std::num::NonZeroUsize;

use serde_json::Map;

use super::{checked_post_frame_depth, PendingNodeDiscard};
use crate::{
    layout::text_work::{
        AtomicTextOperationKind, TextWorkBudget, TextWorkMeter, TextWorkPermitResult,
    },
    style::{StyledNode, StyledNodeKind},
};

#[path = "discard_tests/integration.rs"]
mod integration;

#[test]
fn initial_frame_waits_for_atomic_admission_without_moving_nodes() {
    let mut pending = PendingNodeDiscard::new(vec![leaf("root")]);
    let mut work = meter(8, 1);
    exhaust_atomic_slot(&mut work);

    assert!(pending.advance(&mut work).is_err());
    assert!(pending.initial_frame.is_some());
    assert!(pending.frames.is_empty());
    assert_eq!(work.utf16_units_remaining(), 8);
}

#[test]
fn admitted_initial_frame_survives_unit_yield_without_replaying() {
    let mut pending = PendingNodeDiscard::new(vec![leaf("root")]);
    let mut reserve = meter(1, 1);

    assert!(pending.advance(&mut reserve).is_err());
    assert!(pending.initial_frame.is_none());
    assert_eq!(pending.frames.len(), 1);
    assert_eq!(pending.frames[0].as_slice().len(), 1);
    assert_eq!(reserve.utf16_units_remaining(), 0);
    assert_eq!(reserve.atomic_operations_remaining(), 0);

    let capacity = pending.frames.capacity();
    let mut retry = meter(1, 1);
    exhaust_atomic_slot(&mut retry);
    assert!(!pending
        .advance(&mut retry)
        .expect("the root node is discarded"));
    assert_eq!(pending.frames[0].as_slice().len(), 0);
    assert_eq!(pending.frames.capacity(), capacity);
}

#[test]
fn full_child_stack_preflights_before_node_and_unit_consumption() {
    let mut pending = discard_with_exact_frames(vec![branch(leaf("child"))], 1);
    let original_capacity = pending.frames.capacity();
    let mut work = meter(8, 1);
    exhaust_atomic_slot(&mut work);

    assert!(pending.advance(&mut work).is_err());
    assert_eq!(pending.frames.len(), 1);
    assert_eq!(pending.frames[0].as_slice().len(), 1);
    assert_eq!(pending.frames.capacity(), original_capacity);
    assert_eq!(work.utf16_units_remaining(), 8);
}

#[test]
fn child_reserve_survives_unit_yield_and_push_never_grows() {
    let mut pending = discard_with_exact_frames(vec![branch(leaf("child"))], 1);
    let mut reserve = meter(2, 1);

    assert!(pending.advance(&mut reserve).is_err());
    assert_eq!(pending.frames.len(), 1);
    assert_eq!(pending.frames[0].as_slice().len(), 1);
    assert!(pending.frame_slot_available());
    assert_eq!(reserve.utf16_units_remaining(), 0);
    assert_eq!(reserve.atomic_operations_remaining(), 0);

    let capacity = pending.frames.capacity();
    let mut retry = meter(1, 1);
    exhaust_atomic_slot(&mut retry);
    assert!(!pending
        .advance(&mut retry)
        .expect("the branch is discarded"));
    assert_eq!(pending.frames.len(), 2);
    assert!(pending.frames[0].as_slice().is_empty());
    assert_eq!(pending.frames[1].as_slice().len(), 1);
    assert_eq!(pending.frames.capacity(), capacity);
}

#[test]
fn spare_child_slot_skips_atomic_admission() {
    let mut pending = PendingNodeDiscard {
        initial_frame: None,
        frames: Vec::with_capacity(2),
    };
    pending.frames.push(vec![branch(leaf("child"))].into_iter());
    assert_eq!(pending.frames.capacity(), 2);
    let mut work = meter(1, 1);
    exhaust_atomic_slot(&mut work);

    assert!(!pending.advance(&mut work).expect("the branch is discarded"));
    assert_eq!(pending.frames.len(), 2);
    assert_eq!(pending.frames.capacity(), 2);
    assert_eq!(work.atomic_operations_remaining(), 0);
}

#[test]
fn oversized_growth_waits_for_a_fresh_quantum() {
    let mut pending = discard_with_exact_frames(Vec::new(), 8);
    let original_capacity = pending.frames.capacity();
    let mut non_fresh = meter(4, 1);
    assert_eq!(non_fresh.take_utf16_units(1), 1);

    assert!(pending.ensure_frame_slot(&mut non_fresh).is_err());
    assert_eq!(pending.frames.capacity(), original_capacity);
    assert_eq!(non_fresh.atomic_operations_remaining(), 1);

    let mut fresh = meter(4, 1);
    pending
        .ensure_frame_slot(&mut fresh)
        .expect("fresh work admits oversized discard growth");
    assert!(pending.frame_slot_available());
    assert_eq!(fresh.utf16_units_remaining(), 0);
    assert_eq!(fresh.atomic_operations_remaining(), 0);
}

#[test]
fn post_depth_is_checked_and_empty_frame_pop_is_paid() {
    assert_eq!(checked_post_frame_depth(3), Some(4));
    assert_eq!(checked_post_frame_depth(usize::MAX), None);

    let mut pending = discard_with_exact_frames(Vec::new(), 1);
    let mut work = meter(1, 1);
    assert!(pending
        .advance(&mut work)
        .expect("the empty root completes"));
    assert!(pending.frames.is_empty());
    assert_eq!(work.utf16_units_remaining(), 0);
    assert_eq!(work.atomic_operations_remaining(), 1);
}

fn discard_with_exact_frames(nodes: Vec<StyledNode>, depth: usize) -> PendingNodeDiscard {
    assert!(depth > 0);
    let mut frames = (0..depth)
        .map(|_| Vec::new().into_iter())
        .collect::<Vec<_>>();
    *frames.last_mut().expect("a non-empty frame stack exists") = nodes.into_iter();
    let frames = frames.into_boxed_slice().into_vec();
    assert_eq!(frames.len(), frames.capacity());
    PendingNodeDiscard {
        initial_frame: None,
        frames,
    }
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

fn branch(child: StyledNode) -> StyledNode {
    node(StyledNodeKind::Block, vec![child], None)
}

fn leaf(content: &str) -> StyledNode {
    node(StyledNodeKind::Text, Vec::new(), Some(content))
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
