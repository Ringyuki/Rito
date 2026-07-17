use std::sync::Arc;

use crate::layout::LogicalTextFlow;

use super::context::{same_flow, MovementCaret, PositionGroup};
use crate::interaction::text::{
    collect::CollectedTextRun, paragraph_selection::paragraph_bounds, LayoutTextPageRange,
    LayoutTextSelectionMovementTarget, TextInteractionUnavailableReason, TextSelectionBoundary,
    TextSelectionMovement,
};

mod horizontal;
mod line;
mod page;

use horizontal::move_horizontal_focus;
use line::{move_line, move_line_boundary};
use page::move_page_focus;

pub(super) enum FocusMovement {
    Resolved(MovementCaret, Option<f64>, Option<f64>),
    Boundary(TextSelectionBoundary),
}

#[derive(Debug, Clone, Copy)]
pub(super) struct FocusMovementInput<'a> {
    pub(super) movement: TextSelectionMovement,
    pub(super) language: Option<&'a str>,
    pub(super) preferred_inline_position: Option<f64>,
    pub(super) preferred_block_position: Option<f64>,
    pub(super) target: LayoutTextSelectionMovementTarget,
}

pub(super) fn move_focus(
    runs: &[CollectedTextRun<'_>],
    positions: &[MovementCaret],
    groups: &[PositionGroup],
    focus: &MovementCaret,
    input: FocusMovementInput<'_>,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    match input.movement {
        TextSelectionMovement::CharacterLeft
        | TextSelectionMovement::CharacterRight
        | TextSelectionMovement::WordLeft
        | TextSelectionMovement::WordRight
        | TextSelectionMovement::WordStartRight => {
            move_horizontal_focus(positions, focus, input.movement, input.language)
        }
        TextSelectionMovement::LineUp | TextSelectionMovement::LineDown => {
            let down = input.movement == TextSelectionMovement::LineDown;
            move_line(positions, focus, down, input.preferred_inline_position)
        }
        TextSelectionMovement::LineStart | TextSelectionMovement::LineEnd => {
            let end = input.movement == TextSelectionMovement::LineEnd;
            move_line_boundary(positions, focus, end)
        }
        TextSelectionMovement::PageUp | TextSelectionMovement::PageDown => {
            move_page_target(positions, focus, input)
        }
        TextSelectionMovement::ParagraphBackward | TextSelectionMovement::ParagraphForward => {
            let forward = input.movement == TextSelectionMovement::ParagraphForward;
            move_paragraph(runs, groups, focus, forward)
        }
        TextSelectionMovement::ParagraphPreviousStart
        | TextSelectionMovement::ParagraphNextStart => {
            let forward = input.movement == TextSelectionMovement::ParagraphNextStart;
            move_adjacent_paragraph_start(runs, groups, focus, forward)
        }
        TextSelectionMovement::ChapterStart | TextSelectionMovement::DocumentStart => {
            move_scope_target(groups, focus, input.target, false)
        }
        TextSelectionMovement::ChapterEnd | TextSelectionMovement::DocumentEnd => {
            move_scope_target(groups, focus, input.target, true)
        }
    }
}

fn move_page_target(
    positions: &[MovementCaret],
    focus: &MovementCaret,
    input: FocusMovementInput<'_>,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    match input.target {
        LayoutTextSelectionMovementTarget::Page(target) => move_page_focus(
            positions,
            focus,
            target,
            input.movement == TextSelectionMovement::PageDown,
            input.preferred_inline_position,
            input.preferred_block_position,
        ),
        LayoutTextSelectionMovementTarget::Boundary { boundary, .. } => {
            Ok(FocusMovement::Boundary(boundary))
        }
        LayoutTextSelectionMovementTarget::Scope(_) => {
            Err(TextInteractionUnavailableReason::InvalidCaret)
        }
    }
}

fn move_scope_target(
    groups: &[PositionGroup],
    focus: &MovementCaret,
    target: LayoutTextSelectionMovementTarget,
    end: bool,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    let LayoutTextSelectionMovementTarget::Scope(scope) = target else {
        return Err(TextInteractionUnavailableReason::InvalidCaret);
    };
    move_scope(groups, focus, scope, end)
}

fn move_paragraph(
    runs: &[CollectedTextRun<'_>],
    groups: &[PositionGroup],
    focus: &MovementCaret,
    forward: bool,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    let flows = ordered_flows(groups);
    let current = flows
        .iter()
        .position(|flow| same_flow(flow, &focus.flow))
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)?;
    let (start, end) = paragraph_bounds(runs, &focus.flow)?;
    let (target_flow, target_offset) = if forward && focus.logical_offset < end {
        (&focus.flow, end)
    } else if !forward && focus.logical_offset > start {
        (&focus.flow, start)
    } else {
        let Some(target) = adjacent_index(current, flows.len(), forward) else {
            return Ok(FocusMovement::Boundary(boundary(forward)));
        };
        let bounds = paragraph_bounds(runs, &flows[target])?;
        (&flows[target], if forward { bounds.1 } else { bounds.0 })
    };
    let group = groups
        .iter()
        .find(|group| same_flow(&group.flow, target_flow) && group.logical_offset == target_offset)
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)?;
    Ok(FocusMovement::Resolved(
        directional_caret(group, forward),
        None,
        None,
    ))
}

fn move_adjacent_paragraph_start(
    runs: &[CollectedTextRun<'_>],
    groups: &[PositionGroup],
    focus: &MovementCaret,
    forward: bool,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    paragraph_bounds(runs, &focus.flow)?;
    let flows = ordered_flows(groups);
    let current = flows
        .iter()
        .position(|flow| same_flow(flow, &focus.flow))
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)?;
    let Some(target) = adjacent_index(current, flows.len(), forward) else {
        return Ok(FocusMovement::Boundary(boundary(forward)));
    };
    let target_flow = &flows[target];
    let (target_start, _) = paragraph_bounds(runs, target_flow)?;
    let group = groups
        .iter()
        .find(|group| same_flow(&group.flow, target_flow) && group.logical_offset == target_start)
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)?;
    Ok(FocusMovement::Resolved(
        directional_caret(group, forward),
        None,
        None,
    ))
}

fn move_scope(
    groups: &[PositionGroup],
    focus: &MovementCaret,
    scope: LayoutTextPageRange,
    end: bool,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    if !scope_contains(scope, focus.caret.address.page_index) {
        return Err(TextInteractionUnavailableReason::InvalidCaret);
    }
    let mut scoped = groups.iter().filter(|group| {
        group
            .carets
            .iter()
            .any(|caret| scope_contains(scope, caret.caret.address.page_index))
    });
    let target = if end {
        scoped.next_back()
    } else {
        scoped.next()
    }
    .ok_or(TextInteractionUnavailableReason::SourceUnavailable)?;
    if same_flow(&target.flow, &focus.flow) && target.logical_offset == focus.logical_offset {
        Ok(FocusMovement::Boundary(boundary(end)))
    } else {
        Ok(FocusMovement::Resolved(
            directional_caret_in_scope(target, scope, end)?,
            None,
            None,
        ))
    }
}

fn directional_caret_in_scope(
    group: &PositionGroup,
    scope: LayoutTextPageRange,
    forward: bool,
) -> Result<MovementCaret, TextInteractionUnavailableReason> {
    let mut carets = group
        .carets
        .iter()
        .filter(|caret| scope_contains(scope, caret.caret.address.page_index));
    let caret = if forward {
        carets.next()
    } else {
        carets.next_back()
    };
    caret
        .cloned()
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)
}

fn scope_contains(scope: LayoutTextPageRange, page_index: usize) -> bool {
    scope.first_page <= page_index && page_index <= scope.last_page
}

fn ordered_flows(groups: &[PositionGroup]) -> Vec<Arc<LogicalTextFlow>> {
    let mut flows = Vec::new();
    for group in groups {
        if !flows.iter().any(|flow| same_flow(flow, &group.flow)) {
            flows.push(Arc::clone(&group.flow));
        }
    }
    flows
}

fn directional_caret(group: &PositionGroup, forward: bool) -> MovementCaret {
    if forward {
        group.carets.first()
    } else {
        group.carets.last()
    }
    .expect("position groups are non-empty")
    .clone()
}

fn adjacent_index(index: usize, len: usize, forward: bool) -> Option<usize> {
    if forward {
        index.checked_add(1).filter(|next| *next < len)
    } else {
        index.checked_sub(1)
    }
}

fn boundary(forward: bool) -> TextSelectionBoundary {
    if forward {
        TextSelectionBoundary::End
    } else {
        TextSelectionBoundary::Start
    }
}
