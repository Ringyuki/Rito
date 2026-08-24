use crate::{
    epub::{EpubError, EpubResult},
    interaction::{TextSelectionBoundary, TextSelectionMovement},
};

use super::super::super::page_artifact::{
    PageArtifactTextPageRange, PageArtifactTextPageTarget, PageArtifactTextSelectionMovementTarget,
};
use super::super::super::RuntimeRevisionStatus;
use super::super::{RuntimeDocument, RuntimeRevision, RuntimeTextSelectionMovementRequest};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct MovementScope {
    pub(super) retained_range: PageArtifactTextPageRange,
    pub(super) target: PageArtifactTextSelectionMovementTarget,
    pub(super) end_complete: bool,
}

pub(super) fn movement_scope(
    document: &RuntimeDocument,
    revision: &RuntimeRevision,
    request: RuntimeTextSelectionMovementRequest,
) -> EpubResult<MovementScope> {
    let last_page = revision
        .chapter_engine_session()
        .metadata()
        .page_count
        .saturating_sub(1);
    let retained = PageArtifactTextPageRange {
        first_page: 0,
        last_page,
    };
    let (target, end_complete) = match request.movement {
        TextSelectionMovement::ChapterStart | TextSelectionMovement::ChapterEnd => {
            chapter_target(document, revision, request.focus.page_index, last_page)?
        }
        TextSelectionMovement::PageUp | TextSelectionMovement::PageDown => (
            page_target(
                revision,
                request.focus.page_index,
                request.movement,
                retained,
            )?,
            publication_complete(revision),
        ),
        _ => (
            PageArtifactTextSelectionMovementTarget::Scope(retained),
            publication_complete(revision),
        ),
    };
    Ok(MovementScope {
        retained_range: retained,
        target,
        end_complete,
    })
}

fn chapter_target(
    document: &RuntimeDocument,
    revision: &RuntimeRevision,
    focus_page_index: usize,
    last_page: usize,
) -> EpubResult<(PageArtifactTextSelectionMovementTarget, bool)> {
    let chapter = super::super::chapter_for_page(&document.document, revision, focus_page_index)
        .ok_or_else(|| EpubError::new("text selection focus chapter is unavailable"))?;
    let range = revision
        .chapter_engine_session()
        .known_chapter(&chapter.idref)
        .ok_or_else(|| EpubError::new("text selection chapter page range is unavailable"))?;
    let target = PageArtifactTextSelectionMovementTarget::Scope(PageArtifactTextPageRange {
        first_page: range.start_page,
        last_page: range.end_page.min(last_page),
    });
    let complete = revision
        .interactions
        .completed_chapter_idrefs
        .contains(&chapter.idref);
    Ok((target, complete))
}

fn page_target(
    revision: &RuntimeRevision,
    focus_page_index: usize,
    movement: TextSelectionMovement,
    retained: PageArtifactTextPageRange,
) -> EpubResult<PageArtifactTextSelectionMovementTarget> {
    let slots = revision.chapter_engine_session().spreads();
    let current = current_slot(slots.len(), |index| {
        slots[index].left_page_index == focus_page_index
            || slots[index].right_page_index == Some(focus_page_index)
    })?;
    let forward = movement == TextSelectionMovement::PageDown;
    let Some(adjacent) = adjacent_index(current, slots.len(), forward) else {
        return Ok(PageArtifactTextSelectionMovementTarget::Boundary {
            boundary: boundary(forward),
            scope: retained,
        });
    };
    let prefer_right = slots[current].right_page_index == Some(focus_page_index);
    let page_index = if prefer_right {
        slots[adjacent]
            .right_page_index
            .unwrap_or(slots[adjacent].left_page_index)
    } else {
        slots[adjacent].left_page_index
    };
    Ok(PageArtifactTextSelectionMovementTarget::Page(
        PageArtifactTextPageTarget { page_index },
    ))
}

fn current_slot(len: usize, matches: impl Fn(usize) -> bool) -> EpubResult<usize> {
    (0..len)
        .find(|index| matches(*index))
        .ok_or_else(|| EpubError::new("text selection focus spread is unavailable"))
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

fn publication_complete(revision: &RuntimeRevision) -> bool {
    revision.status == RuntimeRevisionStatus::Complete
        && revision.final_extent == Some(revision.known_extent)
}
