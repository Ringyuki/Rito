use crate::interaction::text::{TextInteractionUnavailableReason, TextSelectionBoundary};

use super::{adjacent_index, FocusMovement};
use crate::interaction::text::movement::context::{same_flow, MovementCaret, MovementDirection};

pub(super) struct LineRange {
    key: (usize, usize, usize),
    pub(super) start: usize,
    pub(super) end: usize,
}

pub(super) fn move_line(
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
    Ok(FocusMovement::Resolved(target, Some(preferred), None))
}

pub(super) fn move_line_boundary(
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
        Ok(FocusMovement::Resolved(target, None, None))
    }
}

pub(super) fn line_ranges(positions: &[MovementCaret]) -> Vec<LineRange> {
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

pub(super) fn line_direction(
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

pub(super) fn focus_line(
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
