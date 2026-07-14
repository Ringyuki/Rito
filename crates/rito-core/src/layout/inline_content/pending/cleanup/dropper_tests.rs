use serde_json::Map;

use super::{
    drop_styled_node_forest_iteratively, drop_styled_node_iteratively,
    drop_styled_nodes_iteratively, PendingStyledNodeDrop,
};
use crate::style::{StyledNode, StyledNodeKind};

const LARGE_NODE_COUNT: usize = 16_384;

#[test]
fn empty_forest_is_already_complete() {
    let mut pending = PendingStyledNodeDrop::from_forest(Vec::new());

    assert!(pending.is_complete());
    assert!(!pending.advance_one());
    assert_eq!(pending.carrier_push_stats(), (0, 0));
}

#[test]
fn singleton_forest_releases_in_one_structural_step_without_a_carrier() {
    let mut pending = PendingStyledNodeDrop::from_forest(vec![leaf()]);

    assert_eq!(drive(&mut pending), 1);
    assert_eq!(pending.carrier_push_stats(), (0, 0));
}

#[test]
fn deep_tree_has_exact_steps_and_never_grows_a_carrier_frame() {
    let mut root = leaf();
    for _ in 1..LARGE_NODE_COUNT {
        root = branch(vec![root]);
    }
    let mut pending = PendingStyledNodeDrop::from_node(root);

    let steps = drive(&mut pending);

    assert_eq!(steps, LARGE_NODE_COUNT * 2 - 1);
    assert_eq!(pending.carrier_push_stats(), (LARGE_NODE_COUNT - 1, 0));
}

#[test]
fn wide_tree_reuses_every_vacated_child_slot() {
    let children = exact_vec((0..LARGE_NODE_COUNT).map(|_| leaf()).collect());
    let mut pending = PendingStyledNodeDrop::from_node(branch(children));

    let steps = drive(&mut pending);

    assert_eq!(steps, LARGE_NODE_COUNT + 2);
    assert_eq!(pending.carrier_push_stats(), (LARGE_NODE_COUNT, 0));
}

#[test]
fn mixed_forest_uses_n_plus_internal_node_steps() {
    let forest = exact_vec(vec![
        leaf(),
        branch(exact_vec(vec![leaf(), branch(vec![leaf(), leaf()])])),
        branch(vec![leaf()]),
    ]);
    let node_count = 8;
    let internal_node_count = 3;
    let edge_count = node_count - 3;
    let mut pending = PendingStyledNodeDrop::from_forest(forest);

    let steps = drive(&mut pending);

    assert_eq!(steps, node_count + internal_node_count);
    assert_eq!(pending.carrier_push_stats(), (edge_count, 0));
}

#[test]
fn dropping_a_partially_advanced_cursor_finishes_iteratively() {
    let mut root = leaf();
    for _ in 1..LARGE_NODE_COUNT {
        root = branch(vec![root]);
    }
    let mut pending = PendingStyledNodeDrop::from_node(root);
    for _ in 0..128 {
        assert!(pending.advance_one());
    }

    drop(pending);
}

#[test]
fn root_iterator_and_forest_helpers_drain_deep_trees() {
    let mut first = leaf();
    let mut second = leaf();
    let mut third = leaf();
    for _ in 1..LARGE_NODE_COUNT {
        first = branch(vec![first]);
        second = branch(vec![second]);
        third = branch(vec![third]);
    }

    drop_styled_node_iteratively(first);
    drop_styled_nodes_iteratively(vec![second, branch(vec![leaf()])]);
    drop_styled_node_forest_iteratively(vec![third, leaf()]);
}

fn drive(pending: &mut PendingStyledNodeDrop) -> usize {
    let mut steps = 0;
    while pending.advance_one() {
        steps += 1;
    }
    assert!(pending.is_complete());
    steps
}

fn exact_vec(nodes: Vec<StyledNode>) -> Vec<StyledNode> {
    nodes.into_boxed_slice().into_vec()
}

fn leaf() -> StyledNode {
    branch(Vec::new())
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
