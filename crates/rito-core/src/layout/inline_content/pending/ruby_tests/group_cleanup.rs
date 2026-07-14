use super::*;

#[test]
fn suspended_group_discard_drops_a_deep_ignored_tree_iteratively() {
    let mut ignored = text("ignored");
    for _ in 0..16_384 {
        ignored = block("block", vec![ignored]);
    }
    let pending = suspend_after_q1(vec![ruby(vec![ignored])], 5);

    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::Gathering(_)
    ));
    drop(pending);
}

#[test]
fn planning_reserving_gathering_and_next_seed_cancel_stack_safely() {
    // One, three, and four q1 advances suspend the same direct base in
    // Planning, Reserving, and Gathering respectively.
    for advances in [1, 3, 4] {
        let deep = deep_inline(4_096);
        let pending = suspend_after_q1(vec![ruby(vec![deep])], advances);
        assert!(match advances {
            1 => matches!(
                active_ruby_state(&pending),
                super::super::RubyState::Planning(_)
            ),
            3 => matches!(
                active_ruby_state(&pending),
                super::super::RubyState::Reserving(_)
            ),
            4 => matches!(
                active_ruby_state(&pending),
                super::super::RubyState::Gathering(_)
            ),
            _ => unreachable!("the test covers three suspension states"),
        });
        drop(pending);
    }

    // The sixth q1 advance has consumed the `rb` boundary and retains its
    // replacement as AfterGroup::NextSeed behind the ready "A" group.
    let deep_seed = deep_inline(16_384);
    let pending = suspend_after_q1(vec![ruby(vec![text("A"), rb(vec![deep_seed])])], 6);
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
    let pending = suspend_after_q1(vec![ruby(vec![deep_boundary_base, rt(Vec::new())])], 5);
    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::AtBoundary(_)
    ));
    drop(pending);

    let deep_waiting_base = deep_inline(16_384);
    let pending = suspend_after_q1(vec![ruby(vec![deep_waiting_base])], 6);
    assert!(matches!(
        active_ruby_state(&pending),
        super::super::RubyState::WaitingGroup(_)
    ));
    drop(pending);
}

fn suspend_after_q1(nodes: Vec<StyledNode>, advances: usize) -> PendingInlineCandidateCollector {
    let mut pending = PendingInlineCandidateCollector::new(nodes, None, None);
    for _ in 0..advances {
        let mut work = TextWorkMeter::new(limited_budget(1, 1));
        assert!(pending.advance(&mut work).is_err());
    }
    pending
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
