use super::*;
use crate::layout::{
    inline_content::collect_inline_content_candidates,
    inline_segment::{InlineSegment, SegmentContext},
};

#[test]
fn ordinary_ignored_tree_matches_eager_with_tiny_shared_limits() {
    let nodes = vec![deep_block(256), leaf("tail")];
    assert_collection_matches_eager(nodes);
}

#[test]
fn ruby_group_discard_matches_eager_with_tiny_shared_limits() {
    let nodes = vec![ruby(vec![
        leaf("base"),
        rp(vec![deep_block(256)]),
        rt(vec![leaf("annotation")]),
    ])];
    assert_collection_matches_eager(nodes);
}

#[test]
fn raw_annotation_discard_matches_eager_with_tiny_shared_limits() {
    let mut raw = leaf("annotation");
    raw.children.push(deep_block(256));
    let nodes = vec![ruby(vec![leaf("base"), rt(vec![raw])])];
    assert_collection_matches_eager(nodes);
}

#[test]
fn initial_and_nested_discard_cancellation_drain_deep_trees_iteratively() {
    let initial = PendingNodeDiscard::new(vec![deep_block(16_384)]);
    assert!(initial.initial_frame.is_some());
    assert!(initial.frames.is_empty());
    drop(initial);

    let mut nested = PendingNodeDiscard::new(vec![deep_block(16_384)]);
    for _ in 0..128 {
        let mut work = meter(usize::MAX, usize::MAX);
        assert!(!nested
            .advance(&mut work)
            .expect("discard traversal advances"));
    }
    assert!(nested.initial_frame.is_none());
    assert!(nested.frames.len() >= 128);
    drop(nested);
}

#[test]
fn ordinary_owner_cancels_before_discard_root_admission_stack_safely() {
    let mut pending = super::super::super::PendingInlineCandidateCollector::new(
        vec![deep_block(16_384)],
        None,
        None,
    );
    let mut admit_candidate_root = meter(1, 1);
    assert!(pending.advance(&mut admit_candidate_root).is_err());

    let mut dispatch_ignored_root = meter(1, 1);
    assert!(pending.advance(&mut dispatch_ignored_root).is_err());
    let discard = pending
        .discard
        .as_ref()
        .expect("the ignored block installs a discard traversal");
    assert!(discard.initial_frame.is_some());
    assert!(discard.frames.is_empty());
    drop(pending);
}

fn assert_collection_matches_eager(nodes: Vec<StyledNode>) {
    let expected = collect_inline_content_candidates(&nodes, SegmentContext::default());
    let actual = drive(nodes);
    assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
}

fn drive(nodes: Vec<StyledNode>) -> Vec<InlineSegment> {
    let mut pending = super::super::super::PendingInlineCandidateCollector::new(nodes, None, None);
    for _ in 0..100_000 {
        let mut work = meter(1, 1);
        match pending.advance(&mut work) {
            Ok(output) => return output,
            Err(_) => continue,
        }
    }
    panic!("shared discard traversal must not livelock")
}

fn deep_block(depth: usize) -> StyledNode {
    let mut nested = leaf("ignored");
    for _ in 0..depth {
        nested = branch(nested);
    }
    nested
}

fn ruby(children: Vec<StyledNode>) -> StyledNode {
    inline("ruby", children)
}

fn rt(children: Vec<StyledNode>) -> StyledNode {
    inline("rt", children)
}

fn rp(children: Vec<StyledNode>) -> StyledNode {
    inline("rp", children)
}

fn inline(tag: &str, children: Vec<StyledNode>) -> StyledNode {
    let mut node = node(StyledNodeKind::Inline, children, None);
    node.tag = Some(tag.to_owned());
    node
}
