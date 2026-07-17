use crate::layout::LayoutRuntimePage;

use super::{
    collect::collect_text_runs_in_page_range, resolve_text_range, LayoutExactTextRangeResolution,
    LayoutTextPageRange, LayoutTextSelectionMovement, LayoutTextSelectionMovementResolution,
    LayoutTextSelectionMovementTarget, TextCaretAddress, TextInteractionUnavailableReason,
    TextSelectionBoundary, TextSelectionMovement,
};

mod barriers;
mod context;
mod navigation;

use barriers::{blocking_reason, focus_barrier_reason};
use context::{
    collect_movement_candidates, position_groups, rebind_caret, MovementCandidates, MovementCaret,
    PositionGroup,
};
use navigation::{move_focus, FocusMovement, FocusMovementInput};

#[derive(Debug, Clone, Copy)]
pub(crate) struct LayoutTextSelectionMovementInput<'a> {
    pub(crate) scope: LayoutTextPageRange,
    pub(crate) anchor_address: TextCaretAddress,
    pub(crate) focus_address: TextCaretAddress,
    pub(crate) movement: TextSelectionMovement,
    pub(crate) language: Option<&'a str>,
    pub(crate) preferred_inline_position: Option<f64>,
    pub(crate) preferred_block_position: Option<f64>,
    pub(crate) target: LayoutTextSelectionMovementTarget,
}

pub(crate) fn resolve_text_selection_movement(
    pages: &[LayoutRuntimePage],
    input: LayoutTextSelectionMovementInput<'_>,
) -> LayoutTextSelectionMovementResolution {
    match validate_input(&input).and_then(|()| resolve_valid_movement(pages, input)) {
        Ok(resolution) => resolution,
        Err(reason) => unavailable(reason),
    }
}

struct BoundSelection {
    anchor: MovementCaret,
    focus: MovementCaret,
}

fn validate_input(
    input: &LayoutTextSelectionMovementInput<'_>,
) -> Result<(), TextInteractionUnavailableReason> {
    if [
        input.preferred_inline_position,
        input.preferred_block_position,
    ]
    .into_iter()
    .flatten()
    .any(|position| !position.is_finite())
    {
        return Err(TextInteractionUnavailableReason::InvalidCaret);
    }
    if !valid_target(input.scope, input.movement, input.target) {
        return Err(TextInteractionUnavailableReason::InvalidCaret);
    }
    Ok(())
}

fn resolve_valid_movement(
    pages: &[LayoutRuntimePage],
    input: LayoutTextSelectionMovementInput<'_>,
) -> Result<LayoutTextSelectionMovementResolution, TextInteractionUnavailableReason> {
    let runs =
        collect_text_runs_in_page_range(pages, input.scope.first_page, input.scope.last_page);
    let selection = bind_selection(&runs, input.anchor_address, input.focus_address)?;
    let candidates = collect_movement_candidates(&runs);
    ensure_focus_available(&candidates, &selection.focus)?;
    let groups = position_groups(&candidates.positions);
    let outcome = resolve_focus(&runs, &candidates, &groups, &selection.focus, input)?;
    ensure_path_available(&candidates, &selection.focus, &outcome, input)?;
    resolve_outcome(pages, selection, outcome)
}

fn bind_selection(
    runs: &[super::collect::CollectedTextRun<'_>],
    anchor_address: TextCaretAddress,
    focus_address: TextCaretAddress,
) -> Result<BoundSelection, TextInteractionUnavailableReason> {
    Ok(BoundSelection {
        anchor: rebind_caret(runs, anchor_address)?,
        focus: rebind_caret(runs, focus_address)?,
    })
}

fn resolve_focus(
    runs: &[super::collect::CollectedTextRun<'_>],
    candidates: &MovementCandidates,
    groups: &[PositionGroup],
    focus: &MovementCaret,
    input: LayoutTextSelectionMovementInput<'_>,
) -> Result<FocusMovement, TextInteractionUnavailableReason> {
    move_focus(
        runs,
        &candidates.positions,
        groups,
        focus,
        FocusMovementInput {
            movement: input.movement,
            language: input.language,
            preferred_inline_position: input.preferred_inline_position,
            preferred_block_position: input.preferred_block_position,
            target: input.target,
        },
    )
}

fn ensure_focus_available(
    candidates: &MovementCandidates,
    focus: &MovementCaret,
) -> Result<(), TextInteractionUnavailableReason> {
    if let Some(reason) = focus_barrier_reason(&candidates.barriers, focus) {
        return Err(reason);
    }
    Ok(())
}

fn ensure_path_available(
    candidates: &MovementCandidates,
    focus: &MovementCaret,
    outcome: &FocusMovement,
    input: LayoutTextSelectionMovementInput<'_>,
) -> Result<(), TextInteractionUnavailableReason> {
    if let Some(reason) = blocking_reason(
        &candidates.barriers,
        focus,
        input.movement,
        outcome,
        input.target,
    ) {
        return Err(reason);
    }
    Ok(())
}

fn resolve_outcome(
    pages: &[LayoutRuntimePage],
    selection: BoundSelection,
    outcome: FocusMovement,
) -> Result<LayoutTextSelectionMovementResolution, TextInteractionUnavailableReason> {
    match outcome {
        FocusMovement::Resolved(focus, inline, block) => {
            resolve_moved_selection(pages, selection, focus, inline, block)
        }
        FocusMovement::Boundary(boundary) => {
            Ok(LayoutTextSelectionMovementResolution::Boundary(boundary))
        }
    }
}

fn resolve_moved_selection(
    pages: &[LayoutRuntimePage],
    selection: BoundSelection,
    focus: MovementCaret,
    preferred_inline_position: Option<f64>,
    preferred_block_position: Option<f64>,
) -> Result<LayoutTextSelectionMovementResolution, TextInteractionUnavailableReason> {
    exact_range(pages, selection.focus.caret.address, focus.caret.address)?;
    let range = exact_range(pages, selection.anchor.caret.address, focus.caret.address)?;
    Ok(LayoutTextSelectionMovementResolution::Resolved(Box::new(
        LayoutTextSelectionMovement {
            anchor_caret: selection.anchor.caret,
            focus_caret: focus.caret,
            range,
            preferred_inline_position,
            preferred_block_position,
        },
    )))
}

fn exact_range(
    pages: &[LayoutRuntimePage],
    anchor: TextCaretAddress,
    focus: TextCaretAddress,
) -> Result<Box<super::LayoutExactTextRange>, TextInteractionUnavailableReason> {
    match resolve_text_range(pages, anchor, focus) {
        LayoutExactTextRangeResolution::Resolved(range) => Ok(range),
        LayoutExactTextRangeResolution::Unavailable(reason) => Err(reason),
    }
}

fn valid_target(
    retained: LayoutTextPageRange,
    movement: TextSelectionMovement,
    target: LayoutTextSelectionMovementTarget,
) -> bool {
    if retained.first_page > retained.last_page {
        return false;
    }
    match (movement, target) {
        (
            TextSelectionMovement::PageUp | TextSelectionMovement::PageDown,
            LayoutTextSelectionMovementTarget::Page(target),
        ) => page_in_range(retained, target.page_index),
        (
            TextSelectionMovement::PageUp,
            LayoutTextSelectionMovementTarget::Boundary {
                boundary: TextSelectionBoundary::Start,
                scope,
            },
        )
        | (
            TextSelectionMovement::PageDown,
            LayoutTextSelectionMovementTarget::Boundary {
                boundary: TextSelectionBoundary::End,
                scope,
            },
        ) => range_in_range(retained, scope),
        (
            TextSelectionMovement::PageUp | TextSelectionMovement::PageDown,
            LayoutTextSelectionMovementTarget::Scope(_),
        )
        | (
            _,
            LayoutTextSelectionMovementTarget::Page(_)
            | LayoutTextSelectionMovementTarget::Boundary { .. },
        ) => false,
        (_, LayoutTextSelectionMovementTarget::Scope(scope)) => range_in_range(retained, scope),
    }
}

fn range_in_range(retained: LayoutTextPageRange, target: LayoutTextPageRange) -> bool {
    target.first_page <= target.last_page
        && page_in_range(retained, target.first_page)
        && page_in_range(retained, target.last_page)
}

fn page_in_range(range: LayoutTextPageRange, page_index: usize) -> bool {
    range.first_page <= page_index && page_index <= range.last_page
}

fn unavailable(reason: TextInteractionUnavailableReason) -> LayoutTextSelectionMovementResolution {
    LayoutTextSelectionMovementResolution::Unavailable(reason)
}
