use std::num::NonZeroUsize;

use serde_json::{json, Map, Value};

use super::{
    frame::{CollectionFrame, NodeFrame},
    frame_growth::checked_post_frame_depth,
    ruby::{PendingRubyFrame, RubyAction},
    PendingInlineCandidateCollector,
};
use crate::{
    layout::{
        inline_content::collect_inline_content_candidates,
        inline_segment::{InlineSegment, SegmentContext},
        text_work::{AtomicTextOperationKind, TextWorkBudget, TextWorkMeter, TextWorkPermitResult},
    },
    style::{StyledNode, StyledNodeKind},
};

mod cleanup;

#[test]
fn frame_reserve_charges_checked_post_depth_and_provides_a_slot() {
    assert_eq!(checked_post_frame_depth(3), Some(4));
    assert_eq!(checked_post_frame_depth(usize::MAX), None);

    let mut pending = collector_with_exact_frames(Vec::new(), 3);
    let mut work = meter(4, 1);
    pending
        .ensure_frame_slot(&mut work)
        .expect("an exact post-depth admission reserves the stack");

    assert_eq!(work.utf16_units_remaining(), 0);
    assert_eq!(work.atomic_operations_remaining(), 0);
    assert!(pending.frame_slot_available());
}

#[test]
fn oversized_frame_growth_waits_for_a_fresh_quantum() {
    let mut pending = collector_with_exact_frames(Vec::new(), 8);
    let original_capacity = pending.frames.capacity();
    let mut non_fresh = meter(4, 1);
    assert_eq!(non_fresh.take_utf16_units(1), 1);

    assert!(pending.ensure_frame_slot(&mut non_fresh).is_err());
    assert_eq!(pending.frames.capacity(), original_capacity);
    assert_eq!(non_fresh.atomic_operations_remaining(), 1);

    let mut fresh = meter(4, 1);
    pending
        .ensure_frame_slot(&mut fresh)
        .expect("fresh work admits one oversized stack growth");
    assert!(pending.frame_slot_available());
    assert_eq!(fresh.utf16_units_remaining(), 0);
    assert_eq!(fresh.atomic_operations_remaining(), 0);
}

#[test]
fn ordinary_and_ruby_dispatch_preflight_before_consuming_the_parent_node() {
    for node in [inline("span", Vec::new()), ruby(vec![text("base")])] {
        let mut pending = collector_with_exact_frames(vec![node], 1);
        let mut work = meter(8, 1);
        exhaust_atomic_slot(&mut work);

        assert!(pending.advance(&mut work).is_err());
        assert_eq!(pending.frames.len(), 1);
        assert_eq!(current_nodes(&pending), 1);
        assert_eq!(work.utf16_units_remaining(), 8);
    }
}

#[test]
fn successful_reserve_survives_a_unit_yield_without_replaying_admission() {
    let mut pending = collector_with_exact_frames(vec![inline("span", Vec::new())], 1);
    let mut reserve = meter(2, 1);

    assert!(pending.advance(&mut reserve).is_err());
    assert_eq!(reserve.utf16_units_remaining(), 0);
    assert_eq!(reserve.atomic_operations_remaining(), 0);
    assert_eq!(pending.frames.len(), 1);
    assert_eq!(current_nodes(&pending), 1);
    assert!(pending.frame_slot_available());

    let mut retry = meter(1, 1);
    exhaust_atomic_slot(&mut retry);
    assert!(pending.advance(&mut retry).is_err());
    assert_eq!(pending.frames.len(), 2);
    assert_eq!(node_frame(&pending.frames[0]).nodes.as_slice().len(), 0);
}

#[test]
fn spare_frame_capacity_does_not_consume_an_atomic_slot() {
    let mut pending = PendingInlineCandidateCollector::new(Vec::new(), None, None);
    pending.initial_root = None;
    pending.frames = Vec::with_capacity(2);
    pending.frames.push(CollectionFrame::Nodes(NodeFrame::root(
        vec![inline("span", Vec::new())],
        None,
    )));
    let mut work = meter(1, 1);

    assert!(pending.advance(&mut work).is_err());
    assert_eq!(pending.frames.len(), 2);
    assert_eq!(work.atomic_operations_remaining(), 1);
}

#[test]
fn ruby_ready_group_requests_capacity_without_moving_its_nodes_or_unit_budget() {
    let mut frame = PendingRubyFrame::new(
        ruby(vec![text("base"), rt(vec![text("annotation")])]),
        &super::context::OwnedInlineContext::root(None),
    );
    let mut output = Vec::new();
    let mut prepare = meter(usize::MAX, usize::MAX);
    assert!(matches!(
        frame
            .advance(&mut output, 0, false, &mut prepare)
            .expect("ruby preparation reaches a capacity boundary"),
        RubyAction::NeedBaseFrameCapacity
    ));

    let mut blocked = meter(1, 1);
    assert!(matches!(
        frame
            .advance(&mut output, 0, false, &mut blocked)
            .expect("the ready group remains intact"),
        RubyAction::NeedBaseFrameCapacity
    ));
    assert_eq!(blocked.utf16_units_remaining(), 1);
    assert_eq!(blocked.atomic_operations_remaining(), 1);

    let mut publish = meter(1, 1);
    let RubyAction::PushBase(nodes) = frame
        .advance(&mut output, 0, true, &mut publish)
        .expect("the retained group publishes once a frame slot exists")
    else {
        panic!("the ruby base must publish");
    };
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].content.as_deref(), Some("base"));
    assert_eq!(publish.utf16_units_remaining(), 0);
}

#[test]
fn mixed_ordinary_and_ruby_frames_match_eager_at_tiny_quanta() {
    let nodes = vec![inline(
        "span",
        vec![
            text("before "),
            inline("span", vec![text("nested")]),
            ruby(vec![text("base"), rt(vec![text("ruby")])]),
            text(" after"),
        ],
    )];
    let expected = collect_inline_content_candidates(&nodes, SegmentContext::default());

    for quantum in [1, 2, usize::MAX] {
        let actual = drive(nodes.clone(), quantum);
        assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
    }
}

fn collector_with_exact_frames(
    current_nodes: Vec<StyledNode>,
    depth: usize,
) -> PendingInlineCandidateCollector {
    assert!(depth > 0);
    let mut pending = PendingInlineCandidateCollector::new(Vec::new(), None, None);
    pending.initial_root = None;
    let mut frames = (0..depth)
        .map(|_| CollectionFrame::Nodes(NodeFrame::root(Vec::new(), None)))
        .collect::<Vec<_>>();
    *frames.last_mut().expect("a non-empty frame stack exists") =
        CollectionFrame::Nodes(NodeFrame::root(current_nodes, None));
    pending.frames = frames.into_boxed_slice().into_vec();
    assert_eq!(pending.frames.len(), pending.frames.capacity());
    pending
}

fn current_nodes(pending: &PendingInlineCandidateCollector) -> usize {
    let frame = pending.frames.last().expect("a current node frame exists");
    node_frame(frame).nodes.as_slice().len()
}

fn drive(nodes: Vec<StyledNode>, quantum: usize) -> Vec<InlineSegment> {
    let mut pending = PendingInlineCandidateCollector::new(nodes, None, None);
    loop {
        let mut work = meter(quantum, usize::MAX);
        match pending.advance(&mut work) {
            Ok(output) => return output,
            Err(_) => continue,
        }
    }
}

fn advance_until(
    pending: &mut PendingInlineCandidateCollector,
    predicate: impl Fn(&PendingInlineCandidateCollector) -> bool,
) {
    for _ in 0..32 {
        let mut work = meter(1, usize::MAX);
        assert!(pending.advance(&mut work).is_err());
        if predicate(pending) {
            return;
        }
    }
    panic!("inline collection did not reach the requested suspension state")
}

fn exhaust_atomic_slot(work: &mut TextWorkMeter) {
    assert!(matches!(
        work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
        TextWorkPermitResult::Permit { .. }
    ));
}

fn meter(utf16_units: usize, atomic_operations: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(utf16_units).expect("test unit budget is non-zero"),
        NonZeroUsize::new(atomic_operations).expect("test operation budget is non-zero"),
    ))
}

fn ruby(children: Vec<StyledNode>) -> StyledNode {
    inline("ruby", children)
}

fn rt(children: Vec<StyledNode>) -> StyledNode {
    inline("rt", children)
}

fn inline(tag: &str, children: Vec<StyledNode>) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Inline, children);
    node.tag = Some(tag.to_owned());
    node
}

fn text(content: &str) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Text, Vec::new());
    node.content = Some(content.to_owned());
    node
}

fn bare_node(node_type: StyledNodeKind, children: Vec<StyledNode>) -> StyledNode {
    StyledNode {
        node_type,
        tag: None,
        content: None,
        source_text: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: Map::from_iter([
            ("whiteSpace".to_owned(), Value::String("normal".to_owned())),
            ("textTransform".to_owned(), Value::String("none".to_owned())),
            ("fontSize".to_owned(), json!(16)),
            ("lineHeight".to_owned(), json!(1.2)),
        ]),
        children,
        source_ref: None,
    }
}

fn node_frame(frame: &CollectionFrame) -> &NodeFrame {
    match frame {
        CollectionFrame::Nodes(frame) => frame,
        CollectionFrame::Ruby(_) => panic!("the test expects a node frame"),
    }
}
