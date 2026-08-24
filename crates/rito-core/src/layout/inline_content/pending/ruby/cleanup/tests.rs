use std::{num::NonZeroUsize, sync::Arc};

use serde_json::Map;

use super::PendingRubyFrameCleanup;
use crate::{
    layout::{
        inline_content::pending::{
            context::OwnedInlineContext,
            ruby::{
                group::{
                    PendingRubyBoundary, PendingRubyGroupBuild, PendingRubyGroupPlan,
                    RubyGroupBoundaryKind, RubyGroupSpec,
                },
                AfterGroup, PendingAnnotatedGroup, PendingRubyFrame, RubyGroup, RubyState,
                WaitingGroup,
            },
            ruby_text::{PendingAnnotationApply, PendingRubyAnnotation, RubyAnnotation},
        },
        text_work::{TextWorkBudget, TextWorkMeter},
    },
    style::{StyledNode, StyledNodeKind},
};

#[test]
fn complete_and_empty_planning_frames_charge_every_empty_source_transition() {
    // Complete owns an empty children source, then retires children, state,
    // base context, summary and the final frame owner: seven exact units.
    assert_exact_unit_steps(frame_with_state(RubyState::Complete), 7);

    // Planning adds an empty seed source plus its retirement transition.
    assert_exact_unit_steps(
        frame_with_state(RubyState::Planning(PendingRubyGroupPlan::new(Vec::new()))),
        9,
    );
}

#[test]
fn every_ruby_state_variant_completes_at_unit_quanta() {
    let states = vec![
        RubyState::Planning(PendingRubyGroupPlan::new(vec![text("plan")])),
        RubyState::Reserving(spec_with_seed("reserve")),
        RubyState::Gathering(gathering_with_pending_discard()),
        RubyState::AtBoundary(PendingRubyBoundary {
            nodes: vec![text("boundary")],
            kind: RubyGroupBoundaryKind::End,
        }),
        RubyState::Extracting(PendingAnnotatedGroup {
            nodes: vec![text("base")],
            extraction: Box::new(PendingRubyAnnotation::new(vec![text("annotation")])),
        }),
        RubyState::ReadyGroup(RubyGroup {
            nodes: vec![text("ready")],
            annotation: None,
            after: AfterGroup::NextSeed(vec![text("next")]),
        }),
        RubyState::WaitingGroup(WaitingGroup {
            output_start: 0,
            annotation: None,
            after: AfterGroup::NextSeed(vec![text("waiting")]),
        }),
        RubyState::Applying(
            PendingAnnotationApply::new(annotation("apply"), 0, 0),
            AfterGroup::NextSeed(vec![text("after")]),
        ),
        RubyState::Complete,
        RubyState::Transition,
    ];

    for state in states {
        let mut cleanup = PendingRubyFrameCleanup::new(frame_with_state(state));
        let mut steps = 0;
        while !cleanup.is_complete() {
            let progress = cleanup.advance(NonZeroUsize::MIN);
            assert_eq!(progress.consumed_units, 1);
            steps += 1;
            assert!(steps < 1_000, "ruby cleanup must not livelock");
        }
    }
}

#[test]
fn large_budget_reports_only_the_remaining_tail() {
    let mut cleanup = PendingRubyFrameCleanup::new(frame_with_state(RubyState::Planning(
        PendingRubyGroupPlan::new(Vec::new()),
    )));
    let first = cleanup.advance(NonZeroUsize::new(8).expect("test budget is non-zero"));
    assert_eq!(first.consumed_units, 8);
    assert!(!first.complete);

    let tail = cleanup.advance(NonZeroUsize::new(64).expect("test budget is non-zero"));
    assert_eq!(tail.consumed_units, 1);
    assert!(tail.complete);
}

#[test]
fn shared_annotation_and_apply_payloads_release_exactly_once() {
    let ready_annotation = annotation("ready");
    let mut ready =
        PendingRubyFrameCleanup::new(frame_with_state(RubyState::ReadyGroup(RubyGroup {
            nodes: Vec::new(),
            annotation: Some(Arc::clone(&ready_annotation)),
            after: AfterGroup::Complete,
        })));
    assert_eq!(Arc::strong_count(&ready_annotation), 2);
    advance_until_payload_release(&mut ready, &ready_annotation);
    ready.drain();
    assert_eq!(Arc::strong_count(&ready_annotation), 1);

    let apply_annotation = annotation("apply");
    let mut applying = PendingRubyFrameCleanup::new(frame_with_state(RubyState::Applying(
        PendingAnnotationApply::new(Arc::clone(&apply_annotation), 0, 0),
        AfterGroup::Complete,
    )));
    assert_eq!(Arc::strong_count(&apply_annotation), 2);
    advance_until_payload_release(&mut applying, &apply_annotation);
    applying.drain();
    assert_eq!(Arc::strong_count(&apply_annotation), 1);
}

#[test]
fn deep_and_wide_empty_children_resume_at_unit_quanta() {
    const NODE_COUNT: usize = 16_384;

    let deep = PendingRubyFrame::new(
        ruby(vec![deep_inline(NODE_COUNT)]),
        &OwnedInlineContext::root(None),
    );
    let deep_steps = drive_unit_quanta(&mut PendingRubyFrameCleanup::new(deep), NODE_COUNT * 3);
    assert!(deep_steps > NODE_COUNT * 2);

    let empty_children = (0..NODE_COUNT)
        .map(|_| node(StyledNodeKind::Inline, Vec::new()))
        .collect();
    let wide = PendingRubyFrame::new(ruby(empty_children), &OwnedInlineContext::root(None));
    let wide_steps = drive_unit_quanta(&mut PendingRubyFrameCleanup::new(wide), NODE_COUNT * 2);
    assert!(wide_steps > NODE_COUNT);
}

#[test]
fn dropping_a_partially_advanced_cleanup_drains_the_same_cursor() {
    let mut frame = PendingRubyFrame::new(
        ruby(vec![deep_inline(16_384)]),
        &OwnedInlineContext::root(None),
    );
    frame.state = RubyState::WaitingGroup(WaitingGroup {
        output_start: 0,
        annotation: None,
        after: AfterGroup::NextSeed(vec![deep_inline(16_384)]),
    });
    let mut cleanup = PendingRubyFrameCleanup::new(frame);
    let progress = cleanup.advance(NonZeroUsize::new(128).expect("test budget is non-zero"));
    assert_eq!(progress.consumed_units, 128);
    assert!(!progress.complete);

    drop(cleanup);
}

fn advance_until_payload_release(
    cleanup: &mut PendingRubyFrameCleanup,
    annotation: &Arc<RubyAnnotation>,
) {
    for _ in 0..128 {
        assert_eq!(Arc::strong_count(annotation), 2);
        let progress = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        if Arc::strong_count(annotation) == 1 {
            return;
        }
    }
    panic!("ruby cleanup did not release the shared annotation payload");
}

fn assert_exact_unit_steps(frame: PendingRubyFrame, expected_steps: usize) {
    let mut cleanup = PendingRubyFrameCleanup::new(frame);
    for step in 0..expected_steps {
        let progress = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        assert_eq!(progress.complete, step + 1 == expected_steps);
    }
    let repeated = cleanup.advance(NonZeroUsize::MIN);
    assert_eq!(repeated.consumed_units, 0);
    assert!(repeated.complete);
    assert!(!cleanup.advance_one());
}

fn frame_with_state(state: RubyState) -> PendingRubyFrame {
    let mut frame = PendingRubyFrame::new(ruby(Vec::new()), &OwnedInlineContext::root(None));
    frame.state = state;
    frame
}

fn spec_with_seed(content: &str) -> RubyGroupSpec {
    let mut plan = PendingRubyGroupPlan::new(vec![text(content)]);
    plan.advance(&[], &mut unlimited_meter())
        .expect("an empty suffix completes the seed")
}

fn gathering_with_pending_discard() -> PendingRubyGroupBuild {
    let children = vec![block(vec![deep_inline(8)])];
    let mut plan = PendingRubyGroupPlan::new(Vec::new());
    let spec = plan
        .advance(&children, &mut unlimited_meter())
        .expect("the ignored direct child completes group planning");
    let mut build = spec
        .reserve(&mut unlimited_meter())
        .expect("an empty group output needs no growth");
    let mut children = children.into_iter();
    let mut work = TextWorkMeter::new(TextWorkBudget::new(NonZeroUsize::MIN, NonZeroUsize::MIN));
    assert!(build.advance(&mut children, &mut work).is_err());
    assert!(build.has_pending_discard());
    build
}

fn drive_unit_quanta(cleanup: &mut PendingRubyFrameCleanup, limit: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        let progress = cleanup.advance(NonZeroUsize::MIN);
        assert_eq!(progress.consumed_units, 1);
        steps += 1;
        assert!(steps < limit, "ruby cleanup must not livelock");
    }
    steps
}

fn annotation(content: &str) -> Arc<RubyAnnotation> {
    Arc::new(RubyAnnotation::new(
        content.to_owned(),
        content.encode_utf16().count(),
    ))
}

fn unlimited_meter() -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(NonZeroUsize::MAX, NonZeroUsize::MAX))
}

fn ruby(children: Vec<StyledNode>) -> StyledNode {
    let mut node = node(StyledNodeKind::Inline, children);
    node.tag = Some("ruby".to_owned());
    node
}

fn text(content: &str) -> StyledNode {
    let mut node = node(StyledNodeKind::Text, Vec::new());
    node.content = Some(content.to_owned());
    node
}

fn block(children: Vec<StyledNode>) -> StyledNode {
    node(StyledNodeKind::Block, children)
}

fn deep_inline(depth: usize) -> StyledNode {
    let mut nested = text("deep");
    for _ in 0..depth {
        nested = node(StyledNodeKind::Inline, vec![nested]);
    }
    nested
}

fn node(node_type: StyledNodeKind, children: Vec<StyledNode>) -> StyledNode {
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
        style: Map::new(),
        children,
        source_ref: None,
    }
}
