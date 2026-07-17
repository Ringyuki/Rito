use std::sync::Arc;

use crate::layout::LogicalTextFlow;

use super::context::{same_flow, MovementCaret, MovementDirection, PositionGroup};
use crate::interaction::text::{
    collect::CollectedTextRun, paragraph_selection::paragraph_bounds,
    TextInteractionUnavailableReason, TextSelectionBoundary, TextSelectionMovement,
};

mod horizontal;

use horizontal::move_horizontal_focus;

struct LineRange {
    key: (usize, usize, usize),
    start: usize,
    end: usize,
}

pub(super) enum FocusMovement {
    Resolved(MovementCaret, Option<f64>),
    Boundary(TextSelectionBoundary),
}

pub(super) fn move_focus(
    runs: &[CollectedTextRun<'_>],
    positions: &[MovementCaret],
    groups: &[PositionGroup],
    focus: &MovementCaret,
    movement: TextSelectionMovement,
    language: Option<&str>,
    preferred_inline_position: Option<f64>,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    match movement {
        TextSelectionMovement::CharacterLeft
        | TextSelectionMovement::CharacterRight
        | TextSelectionMovement::WordLeft
        | TextSelectionMovement::WordRight
        | TextSelectionMovement::WordStartRight => {
            move_horizontal_focus(positions, focus, movement, language)
        }
        TextSelectionMovement::LineUp => {
            move_line(positions, focus, false, preferred_inline_position)
        }
        TextSelectionMovement::LineDown => {
            move_line(positions, focus, true, preferred_inline_position)
        }
        TextSelectionMovement::LineStart => move_line_boundary(positions, focus, false),
        TextSelectionMovement::LineEnd => move_line_boundary(positions, focus, true),
        TextSelectionMovement::ParagraphBackward => move_paragraph(runs, groups, focus, false),
        TextSelectionMovement::ParagraphForward => move_paragraph(runs, groups, focus, true),
        TextSelectionMovement::ParagraphPreviousStart => {
            move_adjacent_paragraph_start(runs, groups, focus, false)
        }
        TextSelectionMovement::ParagraphNextStart => {
            move_adjacent_paragraph_start(runs, groups, focus, true)
        }
        TextSelectionMovement::ChapterStart => move_chapter(groups, focus, false),
        TextSelectionMovement::ChapterEnd => move_chapter(groups, focus, true),
    }
}

fn move_line(
    positions: &[MovementCaret],
    focus: &MovementCaret,
    down: bool,
    preferred_inline_position: Option<f64>,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    let lines = line_ranges(positions);
    let current = focus_line(&lines, focus)?;
    line_direction(positions, &lines[current])?;
    let Some(target_line) = adjacent_index(current, lines.len(), down) else {
        return Ok(FocusMovement::Boundary(boundary(down)));
    };
    let preferred = preferred_inline_position.unwrap_or(focus.caret.geometry.x);
    let line = &lines[target_line];
    line_direction(positions, line)?;
    let target = positions[line.start..line.end]
        .iter()
        .min_by(|left, right| {
            (left.caret.geometry.x - preferred)
                .abs()
                .total_cmp(&(right.caret.geometry.x - preferred).abs())
        })
        .cloned()
        .ok_or(TextInteractionUnavailableReason::VisualGeometryUnavailable)?;
    Ok(FocusMovement::Resolved(target, Some(preferred)))
}

fn move_line_boundary(
    positions: &[MovementCaret],
    focus: &MovementCaret,
    end: bool,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    let lines = line_ranges(positions);
    let line = &lines[focus_line(&lines, focus)?];
    line_direction(positions, line)?;
    let target = if end {
        positions[line.start..line.end].last()
    } else {
        positions[line.start..line.end].first()
    }
    .cloned()
    .ok_or(TextInteractionUnavailableReason::VisualGeometryUnavailable)?;
    if equivalent_position(&target, focus) {
        Ok(FocusMovement::Boundary(boundary(end)))
    } else {
        Ok(FocusMovement::Resolved(target, None))
    }
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
    ))
}

fn move_chapter(
    groups: &[PositionGroup],
    focus: &MovementCaret,
    end: bool,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    focus_group(groups, focus)?;
    let target = if end { groups.last() } else { groups.first() }
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)?;
    if same_flow(&target.flow, &focus.flow) && target.logical_offset == focus.logical_offset {
        Ok(FocusMovement::Boundary(boundary(end)))
    } else {
        Ok(FocusMovement::Resolved(
            directional_caret(target, end),
            None,
        ))
    }
}

fn line_ranges(positions: &[MovementCaret]) -> Vec<LineRange> {
    let mut lines: Vec<LineRange> = Vec::new();
    for (index, position) in positions.iter().enumerate() {
        let address = position.caret.address;
        let key = (address.page_index, address.block_index, address.line_index);
        if let Some(line) = lines.last_mut().filter(|line| line.key == key) {
            line.end = index + 1;
        } else {
            lines.push(LineRange {
                key,
                start: index,
                end: index + 1,
            });
        }
    }
    lines
}

fn line_direction(
    positions: &[MovementCaret],
    line: &LineRange,
) -> Result<MovementDirection, TextInteractionUnavailableReason> {
    let mut candidates = positions[line.start..line.end].iter();
    let direction = candidates
        .next()
        .map(|candidate| candidate.direction)
        .ok_or(TextInteractionUnavailableReason::ShapeUnavailable)?;
    candidates
        .all(|candidate| candidate.direction == direction)
        .then_some(direction)
        .ok_or(TextInteractionUnavailableReason::ShapeUnavailable)
}

fn focus_line(
    lines: &[LineRange],
    focus: &MovementCaret,
) -> Result<usize, TextInteractionUnavailableReason> {
    let address = focus.caret.address;
    let key = (address.page_index, address.block_index, address.line_index);
    lines
        .iter()
        .position(|line| line.key == key)
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)
}

fn focus_group(
    groups: &[PositionGroup],
    focus: &MovementCaret,
) -> Result<usize, TextInteractionUnavailableReason> {
    groups
        .iter()
        .position(|group| {
            same_flow(&group.flow, &focus.flow) && group.logical_offset == focus.logical_offset
        })
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)
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

fn equivalent_position(left: &MovementCaret, right: &MovementCaret) -> bool {
    same_flow(&left.flow, &right.flow) && left.logical_offset == right.logical_offset
}

fn boundary(forward: bool) -> TextSelectionBoundary {
    if forward {
        TextSelectionBoundary::End
    } else {
        TextSelectionBoundary::Start
    }
}
