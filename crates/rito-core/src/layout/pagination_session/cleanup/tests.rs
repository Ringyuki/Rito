use std::{
    collections::VecDeque,
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::Arc,
};

use serde_json::{json, Map};

use super::PendingContinuousLayoutSessionCleanup;
use crate::{
    layout::{
        content::RuntimeBlock,
        continuous_layout::{
            test_container_cursor, test_empty_leaf_cursor, ContinuousLayoutCursor,
        },
        image_size::ImageSizeIndex,
        line::LineBox,
        pagination_session::ContinuousLayoutSession,
        LineBreaking,
    },
    style::{StyledNode, StyledNodeKind},
};

const DEEP_CONTAINER_COUNT: usize = 16_384;

#[test]
fn empty_session_has_exact_units_and_repeated_completion_is_free() {
    let mut cleanup = PendingContinuousLayoutSessionCleanup::new(empty_session());
    let progress = cleanup.advance(NonZeroUsize::new(99).expect("test budget is non-zero"));

    assert_eq!(progress.consumed_units, 14);
    assert!(progress.complete);
    assert!(!cleanup.advance_one());
    assert_eq!(cleanup.advance(NonZeroUsize::MIN).consumed_units, 0);
}

#[test]
fn every_node_field_composes_its_exact_forest_units() {
    let mut session = empty_session();
    session.pending_nodes = wrapped_nodes();
    session.ready_nodes = VecDeque::from([branch(vec![leaf()])]);
    session.anonymous_inline_run = vec![leaf()];
    let mut cleanup = PendingContinuousLayoutSessionCleanup::new(session);

    assert_eq!(drive_q1(&mut cleanup, 25), 25);
}

#[test]
fn one_empty_container_layer_adds_nineteen_units() {
    let child = empty_session();
    let parent = container_parent(child, None);
    let mut cleanup = PendingContinuousLayoutSessionCleanup::new(parent);

    assert_eq!(drive_q1(&mut cleanup, 33), 33);
}

#[test]
fn empty_leaf_active_state_composes_source_and_retirement_units() {
    let session = session_with_cursor(test_empty_leaf_cursor(leaf()));
    let mut cleanup = PendingContinuousLayoutSessionCleanup::new(session);

    assert_eq!(drive_q1(&mut cleanup, 20), 20);
}

#[test]
fn container_tail_composes_block_cleanup_before_child_handoff() {
    let child = empty_session();
    let parent = container_parent(child, Some(empty_block()));
    let mut cleanup = PendingContinuousLayoutSessionCleanup::new(parent);

    assert_eq!(drive_q1(&mut cleanup, 37), 37);
}

#[test]
fn deep_container_chain_is_exact_and_stack_safe_at_unit_quanta() {
    let session = deep_container_session(DEEP_CONTAINER_COUNT);
    let mut cleanup = PendingContinuousLayoutSessionCleanup::new(session);
    let expected = DEEP_CONTAINER_COUNT * 19 + 14;

    assert_eq!(drive_q1(&mut cleanup, expected), expected);
}

#[test]
fn partial_deep_chain_drop_uses_the_outer_linear_driver_during_unwind() {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let session = deep_container_session(DEEP_CONTAINER_COUNT);
        let mut cleanup = PendingContinuousLayoutSessionCleanup::new(session);
        let progress =
            cleanup.advance(NonZeroUsize::new(128).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, 128);
        assert!(!progress.complete);
        panic!("force session cleanup during unwind");
    }));

    assert!(result.is_err());
}

#[test]
fn immediate_and_child_handoff_boundary_drops_remain_linear() {
    drop(PendingContinuousLayoutSessionCleanup::new(
        deep_container_session(DEEP_CONTAINER_COUNT),
    ));

    for consumed in [10, 11] {
        let session = deep_container_session(DEEP_CONTAINER_COUNT);
        let mut cleanup = PendingContinuousLayoutSessionCleanup::new(session);
        let progress =
            cleanup.advance(NonZeroUsize::new(consumed).expect("test cleanup budget is non-zero"));
        assert_eq!(progress.consumed_units, consumed);
        assert!(!progress.complete);
        drop(cleanup);
    }
}

fn drive_q1(cleanup: &mut PendingContinuousLayoutSessionCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(
            steps < expected,
            "session cleanup exceeded its expected bound"
        );
        let progress = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        steps += 1;
    }
    assert!(!cleanup.advance_one());
    steps
}

fn deep_container_session(count: usize) -> ContinuousLayoutSession {
    let mut session = empty_session();
    for _ in 0..count {
        session = container_parent(session, None);
    }
    session
}

fn container_parent(
    child: ContinuousLayoutSession,
    pending_tail: Option<RuntimeBlock<LineBox>>,
) -> ContinuousLayoutSession {
    session_with_cursor(test_container_cursor(child, pending_tail, leaf()))
}

fn empty_session() -> ContinuousLayoutSession {
    session_with_cursor(ContinuousLayoutCursor::default())
}

fn session_with_cursor(cursor: ContinuousLayoutCursor) -> ContinuousLayoutSession {
    ContinuousLayoutSession::new_with_cursor(
        Vec::new(),
        100.0,
        100.0,
        Arc::new(ImageSizeIndex::new(&[])),
        LineBreaking::Greedy,
        cursor,
    )
}

fn wrapped_nodes() -> VecDeque<StyledNode> {
    let mut nodes = VecDeque::with_capacity(4);
    nodes.extend([leaf(), leaf(), leaf(), leaf()]);
    drop(nodes.pop_front());
    drop(nodes.pop_front());
    nodes.push_back(branch(vec![leaf(), leaf()]));
    nodes.push_back(leaf());
    let (front, back) = nodes.as_slices();
    assert!(!front.is_empty() && !back.is_empty(), "test deque wraps");
    nodes
}

fn leaf() -> StyledNode {
    branch(Vec::new())
}

fn branch(children: Vec<StyledNode>) -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Block,
        tag: Some("div".to_owned()),
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

fn empty_block() -> RuntimeBlock<LineBox> {
    RuntimeBlock {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        semantic_tag: Some("p".to_owned()),
        anchor_id: None,
        paint: Some(json!({ "color": "#000" })),
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: Vec::new(),
    }
}
