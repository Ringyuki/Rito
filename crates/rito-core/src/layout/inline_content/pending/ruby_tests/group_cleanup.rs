use super::*;
use crate::layout::text_work::{AtomicTextOperationKind, TextWorkPermitResult};

#[test]
fn suspended_group_discard_drops_a_deep_ignored_tree_iteratively() {
    let mut ignored = text("ignored");
    for _ in 0..16_384 {
        ignored = block("block", vec![ignored]);
    }
    let pending = suspend_when(vec![ruby(vec![ignored])], |state| {
        matches!(
            state,
            super::super::RubyState::Gathering(build) if build.has_pending_discard()
        )
    });

    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::Gathering(build) if build.has_pending_discard()
    ));
    drop(pending);
}

#[test]
fn suspended_annotation_discard_drops_deep_text_children_iteratively() {
    let mut ignored = text("ignored");
    for _ in 0..16_384 {
        ignored = block("block", vec![ignored]);
    }
    let mut raw = text("");
    raw.children.push(ignored);
    let pending = suspend_when(vec![ruby(vec![text("base"), rt(vec![raw])])], |state| {
        matches!(
            state,
            super::super::RubyState::Extracting(group)
                if group.extraction.has_pending_discard()
        )
    });

    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::Extracting(group)
            if group.extraction.has_pending_discard()
    ));
    drop(pending);
}

#[test]
fn planning_reserving_gathering_and_next_seed_cancel_stack_safely() {
    for target in [
        TargetState::Planning,
        TargetState::Reserving,
        TargetState::Gathering,
    ] {
        let deep = deep_inline(4_096);
        let pending = suspend_when(vec![ruby(vec![deep])], |state| match target {
            TargetState::Planning => matches!(state, super::super::RubyState::Planning(_)),
            TargetState::Reserving => matches!(state, super::super::RubyState::Reserving(_)),
            TargetState::Gathering => matches!(state, super::super::RubyState::Gathering(_)),
        });
        drop(pending);
    }

    let deep_seed = deep_inline(16_384);
    let pending = suspend_when(vec![ruby(vec![text("A"), rb(vec![deep_seed])])], |state| {
        matches!(
            state,
            super::super::RubyState::ReadyGroup(group)
                if matches!(&group.after, super::super::AfterGroup::NextSeed(seed) if seed.len() == 1)
        )
    });
    let super::super::RubyState::ReadyGroup(group) = active_ruby_state(&pending) else {
        panic!("the first group must retain its replacement seed while ready");
    };
    assert!(matches!(
        &group.after,
        super::super::AfterGroup::NextSeed(seed) if seed.len() == 1
    ));
    drop(pending);
}

#[test]
fn boundary_and_waiting_group_cancel_stack_safely() {
    let deep_boundary_base = deep_inline(16_384);
    let pending = suspend_when(
        vec![ruby(vec![deep_boundary_base, rt(Vec::new())])],
        |state| matches!(state, super::super::RubyState::AtBoundary(_)),
    );
    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::AtBoundary(_)
    ));
    drop(pending);

    let deep_waiting_base = deep_inline(16_384);
    let pending = suspend_when(vec![ruby(vec![deep_waiting_base])], |state| {
        matches!(state, super::super::RubyState::WaitingGroup(_))
    });
    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::WaitingGroup(_)
    ));
    drop(pending);
}

#[test]
fn capacity_blocked_ready_group_resumes_without_replaying_and_drops_iteratively() {
    let deep_base = deep_inline(16_384);
    let mut pending = suspend_when(vec![ruby(vec![deep_base])], |state| {
        matches!(state, super::super::RubyState::ReadyGroup(_))
    });
    pending.frames = std::mem::take(&mut pending.frames)
        .into_boxed_slice()
        .into_vec();
    assert_eq!(pending.frames.len(), pending.frames.capacity());

    let mut blocked = TextWorkMeter::new(limited_budget(8, 1));
    assert!(matches!(
        blocked.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
        TextWorkPermitResult::Permit { .. }
    ));
    assert!(pending.advance(&mut blocked).is_err());
    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::ReadyGroup(_)
    ));
    assert_eq!(pending.frames.len(), pending.frames.capacity());

    let previous_capacity = pending.frames.capacity();
    let expected_depth = pending.frames.len() + 1;
    let mut reserve = TextWorkMeter::new(limited_budget(expected_depth, 1));
    assert!(pending.advance(&mut reserve).is_err());
    assert!(pending.frames.capacity() > previous_capacity);
    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::ReadyGroup(_)
    ));
    assert_eq!(reserve.utf16_units_remaining(), 0);
    assert_eq!(reserve.atomic_operations_remaining(), 0);

    let mut publish = TextWorkMeter::new(limited_budget(1, 1));
    assert!(matches!(
        publish.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
        TextWorkPermitResult::Permit { .. }
    ));
    assert!(pending.advance(&mut publish).is_err());
    assert_eq!(pending.frames.len(), expected_depth);
    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::WaitingGroup(_)
    ));
    drop(pending);
}

#[test]
fn capacity_admitted_ruby_base_completes_annotation_summary_and_outer_exit() {
    let mut outer = inline(
        "span",
        vec![ruby(vec![text("base"), rt(vec![text("annotation")])])],
    );
    outer.style.extend([
        ("marginLeft".to_owned(), json!(7)),
        ("marginRight".to_owned(), json!(8)),
        ("borderTop".to_owned(), border()),
    ]);
    let nodes = vec![text("before"), outer];
    let expected = collect_inline_content_candidates(&nodes, SegmentContext::default());
    let mut pending = suspend_when(nodes, |state| {
        matches!(state, super::super::RubyState::ReadyGroup(_))
    });
    assert_eq!(pending.output.len(), 1, "the preceding run commits first");
    pending.frames = std::mem::take(&mut pending.frames)
        .into_boxed_slice()
        .into_vec();
    assert_eq!(pending.frames.len(), pending.frames.capacity());

    let expected_depth = pending.frames.len() + 1;
    let mut reserve = TextWorkMeter::new(limited_budget(expected_depth, 1));
    assert!(pending.advance(&mut reserve).is_err());
    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::ReadyGroup(_)
    ));
    assert_eq!(reserve.utf16_units_remaining(), 0);
    assert_eq!(reserve.atomic_operations_remaining(), 0);

    let mut publish = TextWorkMeter::new(limited_budget(1, 1));
    assert!(matches!(
        publish.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
        TextWorkPermitResult::Permit { .. }
    ));
    assert!(pending.advance(&mut publish).is_err());
    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::WaitingGroup(_)
    ));

    let actual = finish_pending(pending);
    assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
    let text = text_segments(&actual);
    assert_eq!(text[1].text, "base");
    assert_eq!(text[1].ruby_annotation.as_deref(), Some("annotation"));
    assert_eq!(text[1].inline_margin_left, Some(7.0));
    assert_eq!(text[1].inline_margin_right, Some(8.0));
    assert!(text[1].border_start && text[1].border_end);
}

fn suspend_when(
    nodes: Vec<StyledNode>,
    predicate: impl Fn(&super::super::RubyState) -> bool,
) -> PendingInlineCandidateCollector {
    let mut pending = PendingInlineCandidateCollector::new(nodes, None, None);
    for _ in 0..128 {
        let mut work = TextWorkMeter::new(limited_budget(1, 1));
        assert!(pending.advance(&mut work).is_err());
        if try_active_ruby_state(&pending).is_some_and(&predicate) {
            return pending;
        }
    }
    panic!("ruby collection did not reach the requested suspension state")
}

fn finish_pending(mut pending: PendingInlineCandidateCollector) -> Vec<InlineSegment> {
    for _ in 0..256 {
        let mut work = TextWorkMeter::new(limited_budget(1, 1));
        match pending.advance(&mut work) {
            Ok(output) => return output,
            Err(_) => continue,
        }
    }
    panic!("ruby collection did not complete after capacity admission")
}

#[derive(Clone, Copy)]
enum TargetState {
    Planning,
    Reserving,
    Gathering,
}

fn deep_inline(depth: usize) -> StyledNode {
    let mut node = text("deep");
    for _ in 0..depth {
        node = inline("span", vec![node]);
    }
    node
}

fn limited_budget(quantum: usize, atomic_operations: usize) -> TextWorkBudget {
    TextWorkBudget::new(
        NonZeroUsize::new(quantum).expect("text quantum is non-zero"),
        NonZeroUsize::new(atomic_operations).expect("atomic operation limit is non-zero"),
    )
}
