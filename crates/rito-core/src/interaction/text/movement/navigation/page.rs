use crate::interaction::text::{LayoutTextPageTarget, TextInteractionUnavailableReason};

use super::{FocusMovement, MovementCaret};

pub(super) fn move_page_focus(
    positions: &[MovementCaret],
    focus: &MovementCaret,
    target: LayoutTextPageTarget,
    down: bool,
    preferred_inline_position: Option<f64>,
    preferred_block_position: Option<f64>,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    let preferred_x = preferred_inline_position.unwrap_or(focus.caret.geometry.x);
    let preferred_y = preferred_block_position.unwrap_or(focus.caret.geometry.y);
    let caret = nearest_page_caret(positions, target, preferred_x, preferred_y, down)
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)?;
    Ok(FocusMovement::Resolved(
        caret,
        Some(preferred_x),
        Some(preferred_y),
    ))
}

fn nearest_page_caret(
    positions: &[MovementCaret],
    target: LayoutTextPageTarget,
    x: f64,
    y: f64,
    down: bool,
) -> Option<MovementCaret> {
    positions
        .iter()
        .enumerate()
        .filter(|(_, candidate)| candidate.caret.address.page_index == target.page_index)
        .min_by(|(left_index, left), (right_index, right)| {
            vertical_distance(left, y)
                .total_cmp(&vertical_distance(right, y))
                .then_with(|| {
                    (left.caret.geometry.x - x)
                        .abs()
                        .total_cmp(&(right.caret.geometry.x - x).abs())
                })
                .then_with(|| {
                    if down {
                        left_index.cmp(right_index)
                    } else {
                        right_index.cmp(left_index)
                    }
                })
        })
        .map(|(_, caret)| caret.clone())
}

fn vertical_distance(caret: &MovementCaret, y: f64) -> f64 {
    let geometry = caret.caret.geometry;
    if y < geometry.y {
        geometry.y - y
    } else if y > geometry.y + geometry.height {
        y - geometry.y - geometry.height
    } else {
        0.0
    }
}
