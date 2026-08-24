use super::super::{
    group::{PendingRubyBoundary, PendingRubyGroupPlan, RubyGroupBoundaryKind, RubyGroupSpec},
    AfterGroup, PendingAnnotatedGroup, PendingRubyFrame, RubyGroup, RubyState, WaitingGroup,
};
use super::*;
use crate::layout::inline_content::pending::{
    context::OwnedInlineContext,
    ruby_text::{PendingAnnotationApply, PendingRubyAnnotation, RubyAnnotation},
};

const DEEP_STATE_NODES: usize = 16_384;

#[test]
fn direct_ruby_frame_drop_drains_children_and_every_state_owned_forest() {
    drop(PendingRubyFrame::new(
        ruby(vec![deep_inline(DEEP_STATE_NODES)]),
        &root_context(),
    ));

    drop_frame_with_state(RubyState::Planning(PendingRubyGroupPlan::new(vec![
        deep_inline(DEEP_STATE_NODES),
    ])));
    drop_frame_with_state(RubyState::Reserving(spec_with_deep_seed()));
    drop_frame_with_state(RubyState::Gathering(
        spec_with_deep_seed()
            .reserve(&mut unlimited_meter())
            .expect("a retained seed needs no growth"),
    ));
    drop_frame_with_state(RubyState::AtBoundary(PendingRubyBoundary {
        nodes: vec![deep_inline(DEEP_STATE_NODES)],
        kind: RubyGroupBoundaryKind::End,
    }));
    drop_frame_with_state(RubyState::Extracting(PendingAnnotatedGroup {
        nodes: vec![deep_inline(DEEP_STATE_NODES)],
        extraction: Box::new(PendingRubyAnnotation::new(vec![deep_inline(
            DEEP_STATE_NODES,
        )])),
    }));
    drop_frame_with_state(RubyState::ReadyGroup(RubyGroup {
        nodes: vec![deep_inline(DEEP_STATE_NODES)],
        annotation: None,
        after: AfterGroup::NextSeed(vec![deep_inline(DEEP_STATE_NODES)]),
    }));
    drop_frame_with_state(RubyState::WaitingGroup(WaitingGroup {
        output_start: 0,
        annotation: None,
        after: AfterGroup::NextSeed(vec![deep_inline(DEEP_STATE_NODES)]),
    }));
    drop_frame_with_state(RubyState::Applying(
        PendingAnnotationApply::new(Arc::new(RubyAnnotation::new("x".to_owned(), 1)), 0, 0),
        AfterGroup::NextSeed(vec![deep_inline(DEEP_STATE_NODES)]),
    ));
}

fn drop_frame_with_state(state: RubyState) {
    let mut frame = PendingRubyFrame::new(ruby(Vec::new()), &root_context());
    frame.state = state;
    drop(frame);
}

fn spec_with_deep_seed() -> RubyGroupSpec {
    let mut plan = PendingRubyGroupPlan::new(vec![deep_inline(DEEP_STATE_NODES)]);
    plan.advance(&[], &mut unlimited_meter())
        .expect("an empty direct-child suffix completes the retained seed")
}

fn root_context() -> OwnedInlineContext {
    OwnedInlineContext::root(None)
}

fn unlimited_meter() -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(NonZeroUsize::MAX, NonZeroUsize::MAX))
}

fn deep_inline(depth: usize) -> StyledNode {
    let mut node = text("deep");
    for _ in 0..depth {
        node = inline("span", vec![node]);
    }
    node
}
