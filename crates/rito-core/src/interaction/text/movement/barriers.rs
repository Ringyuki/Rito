use super::{
    context::{caret_line_key, MovementBarrier, MovementCaret},
    navigation::FocusMovement,
};
use crate::interaction::text::{
    LayoutTextPageRange, LayoutTextSelectionMovementTarget, TextInteractionUnavailableReason,
    TextSelectionBoundary, TextSelectionMovement,
};

pub(super) fn focus_barrier_reason(
    barriers: &[MovementBarrier],
    focus: &MovementCaret,
) -> Option<TextInteractionUnavailableReason> {
    barriers
        .iter()
        .find(|barrier| barrier.run_order == focus.run_order)
        .map(|barrier| barrier.reason)
}

pub(super) fn blocking_reason(
    barriers: &[MovementBarrier],
    focus: &MovementCaret,
    movement: TextSelectionMovement,
    outcome: &FocusMovement,
    target: LayoutTextSelectionMovementTarget,
) -> Option<TextInteractionUnavailableReason> {
    let barrier = match movement {
        TextSelectionMovement::LineStart => line_edge_barrier(barriers, focus, false),
        TextSelectionMovement::LineEnd => line_edge_barrier(barriers, focus, true),
        TextSelectionMovement::LineUp | TextSelectionMovement::LineDown => {
            vertical_barrier(barriers, focus, outcome)
        }
        TextSelectionMovement::PageUp | TextSelectionMovement::PageDown => {
            page_barrier(barriers, focus, outcome, target)
        }
        TextSelectionMovement::ChapterStart
        | TextSelectionMovement::ChapterEnd
        | TextSelectionMovement::DocumentStart
        | TextSelectionMovement::DocumentEnd => scope_target_barrier(
            barriers,
            focus,
            outcome,
            target,
            matches!(
                movement,
                TextSelectionMovement::ChapterEnd | TextSelectionMovement::DocumentEnd
            ),
        ),
        _ => outcome_barrier(barriers, focus, outcome),
    };
    barrier.map(|barrier| barrier.reason)
}

fn page_barrier<'a>(
    barriers: &'a [MovementBarrier],
    focus: &MovementCaret,
    outcome: &FocusMovement,
    target: LayoutTextSelectionMovementTarget,
) -> Option<&'a MovementBarrier> {
    match target {
        LayoutTextSelectionMovementTarget::Page(target) => barriers
            .iter()
            .find(|barrier| barrier.line_key.0 == target.page_index)
            .or_else(|| resolved_between_barrier(barriers, focus, outcome)),
        LayoutTextSelectionMovementTarget::Boundary { boundary, scope } => {
            range_barrier(barriers, focus, scope, is_end(boundary))
        }
        LayoutTextSelectionMovementTarget::Scope(_) => None,
    }
}

fn scope_target_barrier<'a>(
    barriers: &'a [MovementBarrier],
    focus: &MovementCaret,
    outcome: &FocusMovement,
    target: LayoutTextSelectionMovementTarget,
    forward: bool,
) -> Option<&'a MovementBarrier> {
    let LayoutTextSelectionMovementTarget::Scope(scope) = target else {
        return None;
    };
    match outcome {
        FocusMovement::Resolved(target, ..) => between_barrier(barriers, focus, target),
        FocusMovement::Boundary(_) => range_barrier(barriers, focus, scope, forward),
    }
}

fn line_edge_barrier<'a>(
    barriers: &'a [MovementBarrier],
    focus: &MovementCaret,
    forward: bool,
) -> Option<&'a MovementBarrier> {
    let line_key = caret_line_key(focus);
    directional_barrier(barriers, focus.run_order, forward, |barrier| {
        barrier.line_key == line_key
    })
}

fn vertical_barrier<'a>(
    barriers: &'a [MovementBarrier],
    focus: &MovementCaret,
    outcome: &FocusMovement,
) -> Option<&'a MovementBarrier> {
    match outcome {
        FocusMovement::Resolved(target, ..) => {
            between_barrier(barriers, focus, target).or_else(|| {
                let target_line = caret_line_key(target);
                barriers
                    .iter()
                    .find(|barrier| barrier.line_key == target_line)
            })
        }
        FocusMovement::Boundary(boundary) => scope_barrier(barriers, focus, is_end(*boundary)),
    }
}

fn outcome_barrier<'a>(
    barriers: &'a [MovementBarrier],
    focus: &MovementCaret,
    outcome: &FocusMovement,
) -> Option<&'a MovementBarrier> {
    match outcome {
        FocusMovement::Resolved(target, ..) => between_barrier(barriers, focus, target),
        FocusMovement::Boundary(boundary) => scope_barrier(barriers, focus, is_end(*boundary)),
    }
}

fn resolved_between_barrier<'a>(
    barriers: &'a [MovementBarrier],
    focus: &MovementCaret,
    outcome: &FocusMovement,
) -> Option<&'a MovementBarrier> {
    let FocusMovement::Resolved(target, ..) = outcome else {
        return None;
    };
    between_barrier(barriers, focus, target)
}

fn between_barrier<'a>(
    barriers: &'a [MovementBarrier],
    focus: &MovementCaret,
    target: &MovementCaret,
) -> Option<&'a MovementBarrier> {
    let forward = target.run_order >= focus.run_order;
    let start = focus.run_order.min(target.run_order);
    let end = focus.run_order.max(target.run_order);
    directional_barrier(barriers, focus.run_order, forward, |barrier| {
        (start..=end).contains(&barrier.run_order)
    })
}

fn scope_barrier<'a>(
    barriers: &'a [MovementBarrier],
    focus: &MovementCaret,
    forward: bool,
) -> Option<&'a MovementBarrier> {
    directional_barrier(barriers, focus.run_order, forward, |_| true)
}

fn range_barrier<'a>(
    barriers: &'a [MovementBarrier],
    focus: &MovementCaret,
    scope: LayoutTextPageRange,
    forward: bool,
) -> Option<&'a MovementBarrier> {
    directional_barrier(barriers, focus.run_order, forward, |barrier| {
        (scope.first_page..=scope.last_page).contains(&barrier.line_key.0)
    })
}

fn directional_barrier(
    barriers: &[MovementBarrier],
    origin: usize,
    forward: bool,
    filter: impl Fn(&MovementBarrier) -> bool,
) -> Option<&MovementBarrier> {
    if forward {
        barriers
            .iter()
            .find(|barrier| barrier.run_order >= origin && filter(barrier))
    } else {
        barriers
            .iter()
            .rev()
            .find(|barrier| barrier.run_order <= origin && filter(barrier))
    }
}

fn is_end(boundary: TextSelectionBoundary) -> bool {
    boundary == TextSelectionBoundary::End
}
