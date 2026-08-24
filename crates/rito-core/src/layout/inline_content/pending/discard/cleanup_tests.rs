use std::num::NonZeroUsize;

use serde_json::Map;

use super::PendingNodeDiscardCleanup;
use crate::{
    layout::inline_content::pending::discard::PendingNodeDiscard,
    style::{StyledNode, StyledNodeKind},
};

const LARGE_COUNT: usize = 16_384;

#[test]
fn unit_quantum_advances_exactly_one_transition_at_a_time() {
    let owner = PendingNodeDiscard::new(vec![branch(vec![leaf(), leaf()])]);
    let mut cleanup = PendingNodeDiscardCleanup::new(owner);
    let mut consumed = 0;

    while !cleanup.is_complete() {
        let progress = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        consumed += progress.consumed_units;
    }

    // One source transition, four node structural steps, and owner release.
    assert_eq!(consumed, 6);
}

#[test]
fn empty_sources_each_consume_one_unit() {
    let owner = discard_with_empty_frames(LARGE_COUNT);
    let mut cleanup = PendingNodeDiscardCleanup::new(owner);

    for remaining in (1..=LARGE_COUNT).rev() {
        let progress = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        assert!(!progress.complete);
        assert_eq!(
            cleanup
                .owner
                .as_ref()
                .expect("the discard owner remains")
                .frames
                .len(),
            remaining - 1
        );
    }

    let release = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(release.consumed_units, 1);
    assert!(release.complete);
}

#[test]
fn exact_steps_include_every_source_and_final_owner_release() {
    let mut owner = discard_with_empty_frames(2);
    owner.initial_frame = Some(vec![leaf(), branch(vec![leaf()])].into_iter());
    let mut cleanup = PendingNodeDiscardCleanup::new(owner);

    let progress = cleanup.advance(NonZeroUsize::new(16).expect("budget is non-zero"));

    // Three source transitions, four node steps, and final owner release.
    assert_eq!(progress.consumed_units, 8);
    assert!(progress.complete);
}

#[test]
fn pending_advance_makes_progress_without_exceeding_budget() {
    let owner = PendingNodeDiscard::new(vec![deep_tree(LARGE_COUNT)]);
    let mut cleanup = PendingNodeDiscardCleanup::new(owner);
    let budget = NonZeroUsize::new(127).expect("budget is non-zero");

    let progress = cleanup.advance(budget);

    assert_eq!(progress.consumed_units, budget.get());
    assert!(!progress.complete);
}

#[test]
fn completed_cleanup_repeats_without_consuming_budget() {
    let owner = PendingNodeDiscard {
        initial_frame: None,
        frames: Vec::new(),
    };
    let mut cleanup = PendingNodeDiscardCleanup::new(owner);

    let release = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(release.consumed_units, 1);
    assert!(release.complete);

    for _ in 0..2 {
        let repeated = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(repeated.consumed_units, 0);
        assert!(repeated.complete);
    }
}

#[test]
fn dropping_partially_advanced_cleanup_drains_two_deep_trees() {
    let owner = PendingNodeDiscard::new(vec![deep_tree(LARGE_COUNT), deep_tree(LARGE_COUNT)]);
    let mut cleanup = PendingNodeDiscardCleanup::new(owner);
    let budget = NonZeroUsize::new(128).expect("budget is non-zero");

    let progress = cleanup.advance(budget);

    assert_eq!(progress.consumed_units, budget.get());
    assert!(!progress.complete);
    drop(cleanup);
}

fn discard_with_empty_frames(count: usize) -> PendingNodeDiscard {
    let mut frames = Vec::with_capacity(count);
    for _ in 0..count {
        frames.push(Vec::new().into_iter());
    }
    PendingNodeDiscard {
        initial_frame: None,
        frames,
    }
}

fn deep_tree(count: usize) -> StyledNode {
    let mut root = leaf();
    for _ in 1..count {
        root = branch(vec![root]);
    }
    root
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
