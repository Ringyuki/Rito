use std::{num::NonZeroUsize, sync::Arc};

use serde_json::Map;

use super::{CleanupPhase, PendingRubyAnnotationCleanup};
use crate::{
    layout::inline_content::pending::{
        discard::PendingNodeDiscard,
        ruby_text::{PendingScalar, RubyAnnotation},
    },
    style::{StyledNode, StyledNodeKind},
};

use super::super::{text_scan::PendingTextScan, PendingRubyAnnotation};

const MANY_OWNERS: usize = 16_384;
const DEEP_TREE_DEPTH: usize = 16_384;

#[test]
fn q1_cleanup_bounds_empty_frames_and_individual_parts() {
    let mut owner = PendingRubyAnnotation::new(Vec::new());
    owner.frames = (0..MANY_OWNERS).map(|_| Vec::new().into_iter()).collect();
    owner.parts = (0..MANY_OWNERS).map(|_| String::new()).collect();
    let mut cleanup = PendingRubyAnnotationCleanup::new(Box::new(owner));
    let mut steps = 0;

    while !cleanup.is_complete() {
        let progress = cleanup.advance(q1());
        assert_eq!(progress.consumed_units, 1);
        steps += 1;
    }

    assert_eq!(steps, MANY_OWNERS * 2 + 7);
}

#[test]
fn partial_drop_drains_an_active_deep_tree_and_remaining_frame() {
    let mut owner = PendingRubyAnnotation::new(Vec::new());
    owner.initial_frame = None;
    owner.frames = vec![
        vec![deep_branch(DEEP_TREE_DEPTH)].into_iter(),
        vec![deep_branch(DEEP_TREE_DEPTH)].into_iter(),
    ];
    let mut cleanup = PendingRubyAnnotationCleanup::new(Box::new(owner));

    assert_one(&mut cleanup); // Empty initial-frame ownership slot.
    assert_one(&mut cleanup); // Last frame source transition.
    assert_one(&mut cleanup); // First structural descent.
    assert_eq!(cleanup.owner().frames.len(), 1);
    assert!(cleanup.nodes.is_some());

    drop(cleanup);
}

#[test]
fn ownership_slots_release_at_distinct_q1_boundaries() {
    let probe = Arc::new(());
    let mut completed = RubyAnnotation::new("complete".to_owned(), 8);
    completed.release_probe = Some(Arc::clone(&probe));

    let mut owner = PendingRubyAnnotation::new(Vec::new());
    owner.frames.push(Vec::new().into_iter());
    owner.active_text = Some(PendingTextScan::new("active".to_owned()));
    owner.parts = vec!["first".to_owned(), "second".to_owned()];
    owner.output = Some("output".to_owned());
    owner.completed = Some(completed);
    owner.scalar = Some(PendingScalar::new('x'));
    let mut cleanup = PendingRubyAnnotationCleanup::new(Box::new(owner));

    assert_eq!(Arc::strong_count(&probe), 2);
    assert_one(&mut cleanup);
    assert!(cleanup.owner().initial_frame.is_none());
    assert_eq!(cleanup.owner().frames.len(), 1);

    assert_one(&mut cleanup);
    assert!(cleanup.owner().frames.is_empty());
    assert_eq!(cleanup.phase, CleanupPhase::Frames);

    assert_one(&mut cleanup);
    assert_eq!(cleanup.phase, CleanupPhase::ActiveText);
    assert!(cleanup.owner().active_text.is_some());

    assert_one(&mut cleanup);
    assert!(cleanup.owner().active_text.is_none());
    assert_eq!(cleanup.owner().parts.len(), 2);

    assert_one(&mut cleanup);
    assert_eq!(cleanup.owner().parts.len(), 1);
    assert_one(&mut cleanup);
    assert!(cleanup.owner().parts.is_empty());

    assert_one(&mut cleanup);
    assert!(cleanup.owner().output.is_none());
    assert!(cleanup.owner().completed.is_some());
    assert_eq!(Arc::strong_count(&probe), 2);

    assert_one(&mut cleanup);
    assert!(cleanup.owner().completed.is_none());
    assert!(cleanup.owner().scalar.is_some());
    assert_eq!(Arc::strong_count(&probe), 1);

    assert_one(&mut cleanup);
    assert!(cleanup.owner().scalar.is_none());
    assert!(!cleanup.is_complete());

    assert_one(&mut cleanup);
    assert!(cleanup.is_complete());
    assert!(cleanup.owner.is_none());
    assert_eq!(Arc::strong_count(&probe), 1);
}

#[test]
fn discard_slot_transition_does_not_hide_nested_cleanup_units() {
    let mut owner = PendingRubyAnnotation::new(Vec::new());
    owner.discard = Some(PendingNodeDiscard::new(vec![bare_node()]));
    let mut cleanup = PendingRubyAnnotationCleanup::new(Box::new(owner));

    assert_one(&mut cleanup);
    assert_one(&mut cleanup);
    assert!(cleanup.owner().discard.is_none());
    assert!(cleanup.discard.is_some());
    assert!(cleanup.owner().active_text.is_none());

    let mut nested_steps = 0;
    while cleanup.discard.is_some() {
        assert_one(&mut cleanup);
        nested_steps += 1;
    }
    assert!(nested_steps > 0);
    assert_eq!(cleanup.phase, CleanupPhase::ActiveText);
}

#[test]
fn oversized_budget_reports_only_the_remaining_tail() {
    let mut cleanup =
        PendingRubyAnnotationCleanup::new(Box::new(PendingRubyAnnotation::new(Vec::new())));

    let progress = cleanup.advance(NonZeroUsize::new(64).expect("budget is non-zero"));

    assert_eq!(progress.consumed_units, 7);
    assert!(progress.complete);
}

#[test]
fn completed_cleanup_is_stable_and_consumes_no_more_units() {
    let mut cleanup =
        PendingRubyAnnotationCleanup::new(Box::new(PendingRubyAnnotation::new(Vec::new())));
    cleanup.drain();

    assert!(!cleanup.advance_one());
    let progress = cleanup.advance(q1());
    assert_eq!(progress.consumed_units, 0);
    assert!(progress.complete);
    cleanup.drain();
    assert!(cleanup.is_complete());
}

fn assert_one(cleanup: &mut PendingRubyAnnotationCleanup) {
    let progress = cleanup.advance(q1());
    assert_eq!(progress.consumed_units, 1);
}

fn q1() -> NonZeroUsize {
    NonZeroUsize::new(1).expect("cleanup budget is non-zero")
}

fn deep_branch(depth: usize) -> StyledNode {
    let mut nested = bare_node();
    for _ in 0..depth {
        nested = StyledNode {
            node_type: StyledNodeKind::Inline,
            children: vec![nested],
            ..bare_node()
        };
    }
    nested
}

fn bare_node() -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Text,
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
        children: Vec::new(),
        source_ref: None,
    }
}

impl PendingRubyAnnotationCleanup {
    fn owner(&self) -> &PendingRubyAnnotation {
        self.owner
            .as_deref()
            .expect("an incomplete annotation cleanup owns its extraction")
    }
}
