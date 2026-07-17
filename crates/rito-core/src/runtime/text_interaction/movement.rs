use crate::{
    epub::{EpubError, EpubResult},
    interaction::{
        resolve_text_selection_movement, LayoutTextSelectionMovementInput,
        LayoutTextSelectionMovementResolution, TextInteractionUnavailableReason,
        TextSelectionBoundary, TextSelectionMovement,
    },
};

use super::{
    runtime_text_caret, runtime_text_range, RuntimeDocument, RuntimeRevision,
    RuntimeTextRangeResolution, RuntimeTextSelectionMovementRequest,
    RuntimeTextSelectionMovementResolution, RuntimeTextSelectionMovementResponse,
};

mod scope;

use scope::{movement_scope, MovementScope};

impl RuntimeDocument {
    pub(in crate::runtime) fn resolve_text_selection_movement_for_revision(
        &self,
        revision_id: &str,
        request: RuntimeTextSelectionMovementRequest,
    ) -> EpubResult<RuntimeTextSelectionMovementResponse> {
        let revision = self.require_text_interaction_revision(revision_id)?;
        require_valid_request(revision, request)?;
        let scope = movement_scope(self, revision, request)?;
        let resolution = resolve_text_selection_movement(
            &revision.layout.pages,
            LayoutTextSelectionMovementInput {
                scope: scope.retained_range,
                anchor_address: request.anchor,
                focus_address: request.focus,
                movement: request.movement,
                language: Some(&self.document.package.metadata.language),
                preferred_inline_position: request.preferred_inline_position,
                preferred_block_position: request.preferred_block_position,
                target: scope.target,
            },
        );
        if movement_requires_final_end(request.movement) && !scope.end_complete {
            return Ok(match resolution {
                LayoutTextSelectionMovementResolution::Unavailable(reason) => {
                    unavailable_response(revision_id, reason)
                }
                LayoutTextSelectionMovementResolution::Resolved(_)
                | LayoutTextSelectionMovementResolution::Boundary(_) => {
                    pending_response(revision_id, TextSelectionBoundary::End)
                }
            });
        }
        runtime_movement_response(
            self,
            revision_id,
            revision,
            scope,
            request.movement,
            resolution,
        )
    }
}

fn movement_requires_final_end(movement: TextSelectionMovement) -> bool {
    matches!(
        movement,
        TextSelectionMovement::ChapterEnd | TextSelectionMovement::DocumentEnd
    )
}

fn runtime_movement_response(
    document: &RuntimeDocument,
    revision_id: &str,
    revision: &RuntimeRevision,
    scope: MovementScope,
    movement: TextSelectionMovement,
    resolution: LayoutTextSelectionMovementResolution,
) -> EpubResult<RuntimeTextSelectionMovementResponse> {
    let resolution = match resolution {
        LayoutTextSelectionMovementResolution::Resolved(selection) => {
            runtime_resolved_movement(document, revision, *selection)?
        }
        LayoutTextSelectionMovementResolution::Boundary(boundary)
            if !scope.end_complete && boundary_reaches_retained_tail(movement, boundary) =>
        {
            RuntimeTextSelectionMovementResolution::Pending { boundary }
        }
        LayoutTextSelectionMovementResolution::Boundary(boundary) => {
            RuntimeTextSelectionMovementResolution::Boundary { boundary }
        }
        LayoutTextSelectionMovementResolution::Unavailable(reason) => {
            RuntimeTextSelectionMovementResolution::Unavailable { reason }
        }
    };
    Ok(RuntimeTextSelectionMovementResponse {
        revision_id: revision_id.to_owned(),
        resolution,
    })
}

fn boundary_reaches_retained_tail(
    movement: TextSelectionMovement,
    boundary: TextSelectionBoundary,
) -> bool {
    if boundary != TextSelectionBoundary::End {
        return false;
    }
    match movement {
        TextSelectionMovement::CharacterLeft
        | TextSelectionMovement::CharacterRight
        | TextSelectionMovement::WordLeft
        | TextSelectionMovement::WordRight
        | TextSelectionMovement::WordStartRight
        | TextSelectionMovement::LineDown
        | TextSelectionMovement::PageDown
        | TextSelectionMovement::ParagraphForward
        | TextSelectionMovement::ParagraphNextStart
        | TextSelectionMovement::ChapterEnd
        | TextSelectionMovement::DocumentEnd => true,
        TextSelectionMovement::LineUp
        | TextSelectionMovement::LineStart
        | TextSelectionMovement::LineEnd
        | TextSelectionMovement::PageUp
        | TextSelectionMovement::ParagraphBackward
        | TextSelectionMovement::ParagraphPreviousStart
        | TextSelectionMovement::ChapterStart
        | TextSelectionMovement::DocumentStart => false,
    }
}

fn runtime_resolved_movement(
    document: &RuntimeDocument,
    revision: &RuntimeRevision,
    selection: crate::interaction::LayoutTextSelectionMovement,
) -> EpubResult<RuntimeTextSelectionMovementResolution> {
    let range = match runtime_text_range(&document.document, revision, *selection.range)? {
        RuntimeTextRangeResolution::Resolved { range } => range,
        RuntimeTextRangeResolution::Unavailable { reason } => {
            return Ok(RuntimeTextSelectionMovementResolution::Unavailable { reason });
        }
    };
    Ok(RuntimeTextSelectionMovementResolution::Resolved {
        anchor_caret: Box::new(runtime_text_caret(
            &document.document,
            revision,
            selection.anchor_caret,
        )?),
        focus_caret: Box::new(runtime_text_caret(
            &document.document,
            revision,
            selection.focus_caret,
        )?),
        range,
        preferred_inline_position: selection.preferred_inline_position,
        preferred_block_position: selection.preferred_block_position,
    })
}

fn require_valid_request(
    revision: &RuntimeRevision,
    request: RuntimeTextSelectionMovementRequest,
) -> EpubResult<()> {
    if [
        request.preferred_inline_position,
        request.preferred_block_position,
    ]
    .into_iter()
    .flatten()
    .any(|position| !position.is_finite())
    {
        return Err(EpubError::new(
            "text selection preferred positions must be finite",
        ));
    }
    for page_index in [request.anchor.page_index, request.focus.page_index] {
        if page_index >= revision.known_extent.page_count {
            return Err(EpubError::new(format!("unknown page index: {page_index}")));
        }
    }
    Ok(())
}

fn unavailable_response(
    revision_id: &str,
    reason: TextInteractionUnavailableReason,
) -> RuntimeTextSelectionMovementResponse {
    RuntimeTextSelectionMovementResponse {
        revision_id: revision_id.to_owned(),
        resolution: RuntimeTextSelectionMovementResolution::Unavailable { reason },
    }
}

fn pending_response(
    revision_id: &str,
    boundary: TextSelectionBoundary,
) -> RuntimeTextSelectionMovementResponse {
    RuntimeTextSelectionMovementResponse {
        revision_id: revision_id.to_owned(),
        resolution: RuntimeTextSelectionMovementResolution::Pending { boundary },
    }
}
