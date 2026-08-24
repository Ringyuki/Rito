use super::*;

#[test]
fn initial_root_waits_for_capacity_and_drop_drains_it_iteratively() {
    let mut nested = inline("span", Vec::new());
    for _ in 0..16_384 {
        nested = inline("span", vec![nested]);
    }
    let mut pending = PendingInlineCandidateCollector::new(vec![nested], None, None);
    assert!(pending.frames.is_empty());
    assert!(pending.initial_root.is_some());

    let mut exhausted = meter(8, 1);
    exhaust_atomic_slot(&mut exhausted);
    assert!(pending.advance(&mut exhausted).is_err());
    assert!(pending.frames.is_empty());
    assert!(pending.initial_root.is_some());
    assert_eq!(exhausted.utf16_units_remaining(), 8);

    drop(pending);
}

#[test]
fn denied_inline_preflight_retains_a_deep_child_for_iterative_drop() {
    let mut deep = text("deep");
    for _ in 0..16_384 {
        deep = inline("span", vec![deep]);
    }
    let mut pending = collector_with_exact_frames(vec![inline("span", vec![deep])], 1);
    let mut work = meter(8, 1);
    exhaust_atomic_slot(&mut work);

    assert!(pending.advance(&mut work).is_err());
    assert_eq!(current_nodes(&pending), 1);
    drop(pending);
}

#[test]
fn suspended_discard_and_pushed_inline_frame_drop_iteratively() {
    let mut discarded = bare_node(StyledNodeKind::Block, Vec::new());
    for _ in 0..16_384 {
        discarded = bare_node(StyledNodeKind::Block, vec![discarded]);
    }
    let mut pending = PendingInlineCandidateCollector::new(vec![discarded], None, None);
    advance_until(&mut pending, |pending| pending.discard.is_some());
    drop(pending);

    let mut nested = inline("span", Vec::new());
    for _ in 0..16_384 {
        nested = inline("span", vec![nested]);
    }
    let mut pending = PendingInlineCandidateCollector::new(vec![nested], None, None);
    advance_until(&mut pending, |pending| pending.frames.len() >= 2);
    drop(pending);
}

#[test]
fn active_atomic_and_its_suspended_discard_drop_iteratively() {
    let mut discarded = text("discarded");
    for _ in 0..16_384 {
        discarded = bare_node(StyledNodeKind::Block, vec![discarded]);
    }
    let image = bare_node(StyledNodeKind::Image, vec![discarded]);
    let mut pending = PendingInlineCandidateCollector::new(vec![image], None, None);
    let mut work = meter(2, 1);

    assert!(pending.advance(&mut work).is_err());
    assert!(matches!(
        pending.active,
        Some(super::super::ActiveCollection::Atomic(_))
    ));
    assert!(pending.discard.is_some());

    drop(pending);
}
