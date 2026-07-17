use crate::{
    epub::{EpubError, EpubResult},
    interaction::{
        resolve_text_selection_movement, LayoutTextPageRange,
        LayoutTextSelectionMovementResolution, TextInteractionUnavailableReason,
        TextSelectionBoundary, TextSelectionMovement,
    },
};

use super::{
    runtime_text_caret, runtime_text_range, RuntimeDocument, RuntimeRevision,
    RuntimeTextRangeResolution, RuntimeTextSelectionMovementRequest,
    RuntimeTextSelectionMovementResolution, RuntimeTextSelectionMovementResponse,
};

impl RuntimeDocument {
    pub(in crate::runtime) fn resolve_text_selection_movement_for_revision(
        &self,
        revision_id: &str,
        request: RuntimeTextSelectionMovementRequest,
    ) -> EpubResult<RuntimeTextSelectionMovementResponse> {
        let revision = self.require_text_interaction_revision(revision_id)?;
        require_valid_request(revision, request)?;
        let scope = match movement_scope(self, revision, request)? {
            MovementScopeResolution::Ready(scope) => scope,
            MovementScopeResolution::DifferentChapter => {
                return Ok(unavailable_response(
                    revision_id,
                    TextInteractionUnavailableReason::DifferentChapter,
                ));
            }
        };
        let resolution = resolve_text_selection_movement(
            &revision.layout.pages,
            scope.page_range,
            request.anchor,
            request.focus,
            request.movement,
            Some(&self.document.package.metadata.language),
            request.preferred_inline_position,
        );
        if request.movement == TextSelectionMovement::ChapterEnd && !scope.chapter_complete {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MovementScope {
    page_range: LayoutTextPageRange,
    chapter_complete: bool,
}

enum MovementScopeResolution {
    Ready(MovementScope),
    DifferentChapter,
}

fn movement_scope(
    document: &RuntimeDocument,
    revision: &RuntimeRevision,
    request: RuntimeTextSelectionMovementRequest,
) -> EpubResult<MovementScopeResolution> {
    let anchor = super::chapter_for_page(&document.document, revision, request.anchor.page_index)
        .ok_or_else(|| EpubError::new("text selection anchor chapter is unavailable"))?;
    let focus = super::chapter_for_page(&document.document, revision, request.focus.page_index)
        .ok_or_else(|| EpubError::new("text selection focus chapter is unavailable"))?;
    if anchor.idref != focus.idref {
        return Ok(MovementScopeResolution::DifferentChapter);
    }
    let range = revision
        .layout
        .summary
        .pagination_flow
        .chapter_map
        .get(&anchor.idref)
        .ok_or_else(|| EpubError::new("text selection chapter page range is unavailable"))?;
    let last_retained_page = revision.known_extent.page_count.saturating_sub(1);
    Ok(MovementScopeResolution::Ready(MovementScope {
        page_range: LayoutTextPageRange {
            first_page: range.start_page,
            last_page: range.end_page.min(last_retained_page),
        },
        chapter_complete: revision
            .interactions
            .completed_chapter_idrefs
            .contains(&anchor.idref),
    }))
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
            if !scope.chapter_complete && boundary_reaches_retained_tail(movement, boundary) =>
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
        | TextSelectionMovement::ParagraphForward
        | TextSelectionMovement::ParagraphNextStart
        | TextSelectionMovement::ChapterEnd => true,
        TextSelectionMovement::LineUp
        | TextSelectionMovement::LineStart
        | TextSelectionMovement::LineEnd
        | TextSelectionMovement::ParagraphBackward
        | TextSelectionMovement::ParagraphPreviousStart
        | TextSelectionMovement::ChapterStart => false,
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
    })
}

fn require_valid_request(
    revision: &RuntimeRevision,
    request: RuntimeTextSelectionMovementRequest,
) -> EpubResult<()> {
    if request
        .preferred_inline_position
        .is_some_and(|position| !position.is_finite())
    {
        return Err(EpubError::new(
            "text selection preferred inline position must be finite",
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
