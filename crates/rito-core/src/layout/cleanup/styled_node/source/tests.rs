use std::{
    collections::VecDeque,
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use serde_json::Map;

use super::PendingStyledNodeIterDrop;
use crate::style::{StyledNode, StyledNodeKind};

const LARGE_NODE_COUNT: usize = 16_384;

#[test]
fn empty_iterator_completes_without_consuming_budget() {
    let mut pending = vector_cursor(Vec::new());

    let progress = pending.advance(NonZeroUsize::MIN);

    assert_eq!(progress.consumed_units, 0);
    assert!(progress.complete);
    assert!(pending.is_complete());
}

#[test]
fn unit_quantum_matches_exact_forest_structural_steps() {
    let forest = exact_vec(vec![
        leaf(),
        branch(exact_vec(vec![leaf(), branch(vec![leaf(), leaf()])])),
        branch(vec![leaf()]),
    ]);
    let mut pending = vector_cursor(forest);
    let mut consumed = 0;

    while !pending.is_complete() {
        let progress = pending.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        consumed += progress.consumed_units;
    }

    assert_eq!(consumed, 11);
}

#[test]
fn pending_advance_consumes_its_budget_without_exceeding_it() {
    let mut pending = vector_cursor(vec![branch(vec![leaf(), leaf(), leaf(), leaf()])]);
    let budget = NonZeroUsize::new(3).expect("test cleanup budget is non-zero");

    let progress = pending.advance(budget);

    assert_eq!(progress.consumed_units, budget.get());
    assert!(!progress.complete);
}

#[test]
fn budget_larger_than_remaining_reports_actual_steps_and_completion() {
    let mut pending = vector_cursor(vec![leaf(), leaf()]);
    let budget = NonZeroUsize::new(3).expect("test cleanup budget is non-zero");

    let progress = pending.advance(budget);

    assert_eq!(progress.consumed_units, 2);
    assert!(progress.complete);

    let repeated = pending.advance(NonZeroUsize::MIN);
    assert_eq!(repeated.consumed_units, 0);
    assert!(repeated.complete);
}

#[test]
fn deep_iterator_resumes_one_unit_at_a_time_without_carrier_growth() {
    let mut pending = vector_cursor(vec![deep_tree()]);
    let mut consumed = 0;

    while !pending.is_complete() {
        let progress = pending.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        consumed += 1;
    }

    assert_eq!(consumed, LARGE_NODE_COUNT * 2 - 1);
    assert_eq!(pending.carrier_push_stats(), (LARGE_NODE_COUNT - 1, 0));
}

#[test]
fn dropping_a_partially_advanced_iterator_uses_the_same_drain_cursor() {
    let mut pending = vector_cursor(vec![deep_tree(), deep_tree()]);
    let budget = NonZeroUsize::new(128).expect("test cleanup budget is non-zero");

    let progress = pending.advance(budget);

    assert_eq!(progress.consumed_units, budget.get());
    assert!(!progress.complete);
    assert_eq!(pending.nodes.len(), 1, "the second deep root is owned");
    drop(pending);
}

#[test]
fn empty_deque_completes_without_consuming_budget() {
    let mut pending = deque_cursor(VecDeque::new());

    let progress = pending.advance(NonZeroUsize::MIN);

    assert_eq!(progress.consumed_units, 0);
    assert!(progress.complete);
}

#[test]
fn wrapped_deque_source_matches_structural_units_without_collecting() {
    let mut nodes = VecDeque::with_capacity(4);
    nodes.extend([leaf(), leaf(), leaf(), leaf()]);
    drop(nodes.pop_front());
    drop(nodes.pop_front());
    nodes.push_back(branch(vec![leaf(), leaf()]));
    nodes.push_back(leaf());
    let (front, back) = nodes.as_slices();
    assert!(!front.is_empty() && !back.is_empty(), "test deque wraps");
    let mut pending = deque_cursor(nodes);
    let mut consumed = 0;

    while !pending.is_complete() {
        assert_eq!(pending.advance(NonZeroUsize::MIN).consumed_units, 1);
        consumed += 1;
    }

    assert_eq!(consumed, 7);
}

#[test]
fn deque_budget_reports_actual_tail_and_repeated_completion_is_free() {
    let mut pending = deque_cursor(VecDeque::from([leaf(), leaf()]));
    let progress = pending.advance(NonZeroUsize::new(3).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 2);
    assert!(progress.complete);
    assert_eq!(pending.advance(NonZeroUsize::MIN).consumed_units, 0);
}

#[test]
fn partial_deque_drop_drains_active_and_unread_deep_roots() {
    let nodes = VecDeque::from([deep_tree(), deep_tree()]);
    let mut pending = deque_cursor(nodes);
    let progress = pending.advance(NonZeroUsize::new(128).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 128);
    assert!(!progress.complete);
    assert_eq!(pending.nodes.len(), 1, "the second deep root is owned");
    drop(pending);
}

#[test]
fn unwind_drains_a_partial_deque_without_recursive_drop() {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let nodes = VecDeque::from([deep_tree(), deep_tree()]);
        let mut pending = deque_cursor(nodes);
        let progress = pending.advance(NonZeroUsize::new(128).expect("test budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        panic!("force cleanup during unwind");
    }));

    assert!(result.is_err());
}

fn vector_cursor(nodes: Vec<StyledNode>) -> PendingStyledNodeIterDrop {
    PendingStyledNodeIterDrop::new(nodes.into_iter())
}

fn deque_cursor(
    nodes: VecDeque<StyledNode>,
) -> PendingStyledNodeIterDrop<std::collections::vec_deque::IntoIter<StyledNode>> {
    PendingStyledNodeIterDrop::new(nodes.into_iter())
}

fn exact_vec(nodes: Vec<StyledNode>) -> Vec<StyledNode> {
    nodes.into_boxed_slice().into_vec()
}

fn leaf() -> StyledNode {
    branch(Vec::new())
}

fn deep_tree() -> StyledNode {
    let mut root = leaf();
    for _ in 1..LARGE_NODE_COUNT {
        root = branch(vec![root]);
    }
    root
}

fn branch(children: Vec<StyledNode>) -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Inline,
        tag: None,
        content: None,
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
