use std::{num::NonZeroUsize, sync::Arc};

use super::PendingInlineCandidateCleanup;
use crate::{
    layout::{
        image_size::ImageSizeIndex,
        inline_content::pending::{
            atomic::{AtomicNodeKind, PendingAtomicNode},
            commit::PendingSegmentCommit,
            context::OwnedInlineContext,
            discard::PendingNodeDiscard,
            frame::{CollectionFrame, NodeFrame},
            ruby::PendingRubyFrame,
            text::PendingTextSegment,
            ActiveCollection, PendingInlineCandidateCollector,
        },
        text_work::{TextWorkBudget, TextWorkMeter},
    },
    style::StyledNodeKind,
};

#[path = "tests/support.rs"]
mod support;

use support::*;

#[test]
fn empty_collector_has_exact_stable_budget_accounting() {
    let mut q1_cleanup = PendingInlineCandidateCleanup::new(PendingInlineCandidateCollector::new(
        Vec::new(),
        None,
        None,
    ));
    for step in 0..18 {
        let progress = q1_cleanup.advance(q1());
        assert_eq!(progress.consumed_units, 1);
        assert_eq!(progress.complete, step == 17);
    }
    assert!(!q1_cleanup.advance_one());
    let repeated = q1_cleanup.advance(q1());
    assert_eq!(repeated.consumed_units, 0);
    assert!(repeated.complete);

    let mut oversized = PendingInlineCandidateCleanup::new(PendingInlineCandidateCollector::new(
        Vec::new(),
        None,
        None,
    ));
    let progress = oversized.advance(NonZeroUsize::new(64).expect("budget is non-zero"));
    assert_eq!(progress.consumed_units, 18);
    assert!(progress.complete);
}

#[test]
fn deep_initial_root_resumes_at_unit_quanta_without_recursive_drop() {
    let mut cleanup = PendingInlineCandidateCleanup::new(PendingInlineCandidateCollector::new(
        vec![deep_inline(LARGE_NODE_COUNT)],
        None,
        None,
    ));

    let steps = drive_q1(&mut cleanup, LARGE_NODE_COUNT * 3);

    assert_eq!(steps, LARGE_NODE_COUNT * 2 + 17);
}

#[test]
fn sixteen_thousand_empty_frames_are_popped_one_at_a_time() {
    let mut owner = PendingInlineCandidateCollector::new(Vec::new(), None, None);
    owner.initial_root = None;
    owner.frames = (0..LARGE_NODE_COUNT)
        .map(|_| CollectionFrame::Nodes(NodeFrame::root(Vec::new(), None)))
        .collect();
    let mut cleanup = PendingInlineCandidateCleanup::new(owner);

    let steps = drive_q1(&mut cleanup, LARGE_NODE_COUNT * 10);

    assert_eq!(steps, LARGE_NODE_COUNT * 9 + 10);
}

#[test]
fn active_text_and_atomic_payloads_retain_every_cleanup_boundary() {
    let mut text_owner = collector_without_root();
    let text = PendingTextSegment::new(
        text_node("active"),
        &OwnedInlineContext::root(None),
        &mut text_owner.whitespace,
    )
    .expect("non-empty text creates active work");
    text_owner.active = Some(ActiveCollection::Text(Box::new(text)));
    let mut text_cleanup = PendingInlineCandidateCleanup::new(text_owner);
    for _ in 0..4 {
        assert_one(&mut text_cleanup);
    }
    assert!(text_cleanup.owner().active.is_none());
    assert_eq!(drive_q1(&mut text_cleanup, 16), 8);

    let mut atomic_owner = collector_without_root();
    atomic_owner.active = Some(ActiveCollection::Atomic(Box::new(PendingAtomicNode {
        kind: AtomicNodeKind::Image,
        node: leaf(StyledNodeKind::Image),
        context: OwnedInlineContext::root(None),
        image_sizes_enabled: true,
    })));
    let mut atomic_cleanup = PendingInlineCandidateCleanup::new(atomic_owner);
    for _ in 0..4 {
        assert_one(&mut atomic_cleanup);
    }
    assert!(atomic_cleanup.owner().active.is_none());
    assert_eq!(drive_q1(&mut atomic_cleanup, 32), 14);
}

#[test]
fn commit_output_and_image_arcs_release_at_distinct_q1_boundaries() {
    let commit_probe: Arc<str> = Arc::from("pending commit");
    let output_probe: Arc<str> = Arc::from("output");
    let image_probe = Arc::new(ImageSizeIndex::new(&[]));
    let mut owner = collector_without_root();
    owner.pending_commit = Some(PendingSegmentCommit::new(text_segment_with_source(
        Arc::clone(&commit_probe),
    )));
    owner
        .output
        .push(text_segment_with_source(Arc::clone(&output_probe)));
    owner.image_sizes = Some(Arc::clone(&image_probe));
    let mut cleanup = PendingInlineCandidateCleanup::new(owner);

    for _ in 0..4 {
        assert_one(&mut cleanup);
    }
    assert_eq!(Arc::strong_count(&commit_probe), 2);
    assert_eq!(Arc::strong_count(&output_probe), 2);
    assert_eq!(Arc::strong_count(&image_probe), 2);

    assert_one(&mut cleanup);
    assert_eq!(Arc::strong_count(&commit_probe), 1);
    assert_eq!(Arc::strong_count(&output_probe), 2);
    assert_one(&mut cleanup);
    assert_one(&mut cleanup);
    assert_eq!(Arc::strong_count(&output_probe), 1);
    assert_one(&mut cleanup);
    assert_one(&mut cleanup);
    assert_eq!(Arc::strong_count(&image_probe), 2);
    assert_one(&mut cleanup);
    assert_eq!(Arc::strong_count(&image_probe), 1);
    assert_one(&mut cleanup);
    assert!(cleanup.is_complete());
}

#[test]
fn large_output_releases_exactly_one_segment_per_q1_unit() {
    let probe: Arc<str> = Arc::from("shared output source");
    let mut owner = collector_without_root();
    owner.output = (0..LARGE_NODE_COUNT)
        .map(|_| text_segment_with_source(Arc::clone(&probe)))
        .collect();
    let mut cleanup = PendingInlineCandidateCleanup::new(owner);
    for _ in 0..6 {
        assert_one(&mut cleanup);
    }

    for remaining in (1..=LARGE_NODE_COUNT).rev() {
        assert_eq!(cleanup.owner().output.len(), remaining);
        assert_eq!(Arc::strong_count(&probe), remaining + 1);
        assert_one(&mut cleanup);
        assert_eq!(Arc::strong_count(&probe), remaining);
    }
    assert!(cleanup.owner().output.is_empty());
    assert_one(&mut cleanup);
    assert_eq!(Arc::strong_count(&probe), 1);
    drop(cleanup);
    assert_eq!(Arc::strong_count(&probe), 1);
}

#[test]
fn reserving_and_ready_commits_release_without_entering_output() {
    for make_ready in [false, true] {
        let probe: Arc<str> = Arc::from(if make_ready { "ready" } else { "reserving" });
        let mut commit = PendingSegmentCommit::new(text_segment_with_source(Arc::clone(&probe)));
        if make_ready {
            let mut unpublished = Vec::new();
            let mut work = TextWorkMeter::new(TextWorkBudget::new(q1(), q1()));
            assert!(commit.advance(&mut unpublished, &mut work).is_err());
            assert!(matches!(commit, PendingSegmentCommit::Ready(_)));
            assert!(unpublished.is_empty());
        } else {
            assert!(matches!(commit, PendingSegmentCommit::Reserving { .. }));
        }

        let mut owner = collector_without_root();
        owner.pending_commit = Some(commit);
        let mut cleanup = PendingInlineCandidateCleanup::new(owner);
        for _ in 0..4 {
            assert_one(&mut cleanup);
        }
        assert!(cleanup.owner().output.is_empty());
        assert_eq!(Arc::strong_count(&probe), 2);

        assert_one(&mut cleanup);
        assert_eq!(Arc::strong_count(&probe), 1);
        assert!(cleanup.owner().output.is_empty());
        drop(cleanup);
        assert_eq!(Arc::strong_count(&probe), 1);
    }
}

#[test]
fn normal_atomic_advance_still_builds_commits_for_both_kinds() {
    for kind in [AtomicNodeKind::Image, AtomicNodeKind::InlineBlock] {
        let mut owner = collector_without_root();
        let node_kind = match kind {
            AtomicNodeKind::Image => StyledNodeKind::Image,
            AtomicNodeKind::InlineBlock => StyledNodeKind::Block,
        };
        let atomic = Box::new(PendingAtomicNode {
            kind,
            node: leaf(node_kind),
            context: OwnedInlineContext::root(None),
            image_sizes_enabled: true,
        });
        owner
            .advance_atomic(atomic, &mut unlimited_meter())
            .expect("unlimited atomic work completes");
        assert!(owner.pending_commit.is_some());
        drop(owner);
    }
}

#[test]
fn partially_advanced_multiroute_cleanup_drains_the_same_cursor() {
    let commit_probe: Arc<str> = Arc::from("commit");
    let output_probe: Arc<str> = Arc::from("output");
    let image_probe = Arc::new(ImageSizeIndex::new(&[]));
    let mut owner = PendingInlineCandidateCollector::new(
        vec![deep_inline(LARGE_NODE_COUNT)],
        Some(Arc::clone(&image_probe)),
        None,
    );
    owner.frames.push(CollectionFrame::Nodes(NodeFrame::root(
        vec![deep_inline(LARGE_NODE_COUNT)],
        None,
    )));
    let ruby = PendingRubyFrame::new(
        ruby_node(vec![deep_inline(LARGE_NODE_COUNT)]),
        &OwnedInlineContext::root(None),
    )
    .with_cleanup_hidden_seed(vec![deep_inline(LARGE_NODE_COUNT)]);
    owner.frames.push(CollectionFrame::Ruby(ruby));
    owner.discard = Some(PendingNodeDiscard::new(vec![deep_inline(LARGE_NODE_COUNT)]));
    owner.active = Some(ActiveCollection::Atomic(Box::new(PendingAtomicNode {
        kind: AtomicNodeKind::Image,
        node: deep_inline(LARGE_NODE_COUNT),
        context: OwnedInlineContext::root(None),
        image_sizes_enabled: true,
    })));
    owner.pending_commit = Some(PendingSegmentCommit::new(text_segment_with_source(
        Arc::clone(&commit_probe),
    )));
    owner
        .output
        .push(text_segment_with_source(Arc::clone(&output_probe)));
    let mut cleanup = PendingInlineCandidateCleanup::new(owner);
    let progress = cleanup.advance(NonZeroUsize::new(40_000).expect("budget is non-zero"));
    assert_eq!(progress.consumed_units, 40_000);
    assert!(!progress.complete);

    drop(cleanup);
    assert_eq!(Arc::strong_count(&commit_probe), 1);
    assert_eq!(Arc::strong_count(&output_probe), 1);
    assert_eq!(Arc::strong_count(&image_probe), 1);
}
