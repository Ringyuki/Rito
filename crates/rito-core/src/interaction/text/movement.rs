use crate::layout::LayoutRuntimePage;

use super::{
    collect::collect_text_runs_in_page_range, resolve_text_range, LayoutExactTextRangeResolution,
    LayoutTextPageRange, LayoutTextSelectionMovement, LayoutTextSelectionMovementResolution,
    TextCaretAddress, TextInteractionUnavailableReason, TextSelectionMovement,
};

mod barriers;
mod context;
mod navigation;

use barriers::{blocking_reason, focus_barrier_reason};
use context::{collect_movement_candidates, position_groups, rebind_caret};
use navigation::{move_focus, FocusMovement};

pub(crate) fn resolve_text_selection_movement(
    pages: &[LayoutRuntimePage],
    scope: LayoutTextPageRange,
    anchor_address: TextCaretAddress,
    focus_address: TextCaretAddress,
    movement: TextSelectionMovement,
    language: Option<&str>,
    preferred_inline_position: Option<f64>,
) -> LayoutTextSelectionMovementResolution {
    if preferred_inline_position.is_some_and(|position| !position.is_finite()) {
        return unavailable(TextInteractionUnavailableReason::InvalidCaret);
    }
    let runs = collect_text_runs_in_page_range(pages, scope.first_page, scope.last_page);
    let anchor = match rebind_caret(&runs, anchor_address) {
        Ok(caret) => caret,
        Err(reason) => return unavailable(reason),
    };
    let focus = match rebind_caret(&runs, focus_address) {
        Ok(caret) => caret,
        Err(reason) => return unavailable(reason),
    };
    let candidates = collect_movement_candidates(&runs);
    if let Some(reason) = focus_barrier_reason(&candidates.barriers, &focus) {
        return unavailable(reason);
    }
    let groups = position_groups(&candidates.positions);
    let outcome = match move_focus(
        &runs,
        &candidates.positions,
        &groups,
        &focus,
        movement,
        language,
        preferred_inline_position,
    ) {
        Ok(outcome) => outcome,
        Err(reason) => return unavailable(reason),
    };
    if let Some(reason) = blocking_reason(&candidates.barriers, &focus, movement, &outcome) {
        return unavailable(reason);
    }
    let FocusMovement::Resolved(focus_caret, preferred_inline_position) = outcome else {
        let FocusMovement::Boundary(boundary) = outcome else {
            unreachable!();
        };
        return LayoutTextSelectionMovementResolution::Boundary(boundary);
    };
    if let LayoutExactTextRangeResolution::Unavailable(reason) =
        resolve_text_range(pages, focus.caret.address, focus_caret.caret.address)
    {
        return unavailable(reason);
    }
    let range = match resolve_text_range(pages, anchor.caret.address, focus_caret.caret.address) {
        LayoutExactTextRangeResolution::Resolved(range) => range,
        LayoutExactTextRangeResolution::Unavailable(reason) => return unavailable(reason),
    };
    LayoutTextSelectionMovementResolution::Resolved(Box::new(LayoutTextSelectionMovement {
        anchor_caret: anchor.caret,
        focus_caret: focus_caret.caret,
        range,
        preferred_inline_position,
    }))
}

fn unavailable(reason: TextInteractionUnavailableReason) -> LayoutTextSelectionMovementResolution {
    LayoutTextSelectionMovementResolution::Unavailable(reason)
}
