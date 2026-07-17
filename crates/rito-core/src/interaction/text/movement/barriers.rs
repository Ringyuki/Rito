use super::{
    context::{caret_line_key, MovementBarrier, MovementCaret},
    navigation::FocusMovement,
};
use crate::interaction::text::{
    TextInteractionUnavailableReason, TextSelectionBoundary, TextSelectionMovement,
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
) -> Option<TextInteractionUnavailableReason> {
    let barrier = match movement {
        TextSelectionMovement::LineStart => line_edge_barrier(barriers, focus, false),
        TextSelectionMovement::LineEnd => line_edge_barrier(barriers, focus, true),
        TextSelectionMovement::LineUp | TextSelectionMovement::LineDown => {
            vertical_barrier(barriers, focus, outcome)
        }
        TextSelectionMovement::ChapterStart => scope_barrier(barriers, focus, false),
        TextSelectionMovement::ChapterEnd => scope_barrier(barriers, focus, true),
        _ => outcome_barrier(barriers, focus, outcome),
    };
    barrier.map(|barrier| barrier.reason)
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
        FocusMovement::Resolved(target, _) => {
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
        FocusMovement::Resolved(target, _) => between_barrier(barriers, focus, target),
        FocusMovement::Boundary(boundary) => scope_barrier(barriers, focus, is_end(*boundary)),
    }
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
