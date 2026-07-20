use std::{error::Error, fmt, num::NonZeroUsize};

use crate::{
    epub::{EpubError, LoadedEpubDocument},
    layout::SpreadMode,
    runtime::{
        frame::{RuntimeRevision, RuntimeRevisionCoordinateSpace},
        RuntimeChapterLocalCoordinate, RuntimeChapterLocalCoordinateKind,
        RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionExtent,
        RuntimeChapterLocalRevisionHandle, RuntimeChapterLocalRevisionSummary,
        RuntimeChapterLocalSourceLocatorResolution, RuntimeContinuationError,
        RuntimeContinuationErrorKind, RuntimeRevisionExtent, RuntimeRevisionWorkBudget,
        RuntimeSourceLocatorError, RuntimeSourceLocatorResolution,
        RUNTIME_CHAPTER_LOCAL_PAGE_CAP_MAX,
    },
};

use super::super::error::checked_budget;

pub(super) fn checked_local_budget(
    budget: RuntimeRevisionWorkBudget,
) -> Result<NonZeroUsize, RuntimeChapterLocalRevisionError> {
    checked_budget(budget).map_err(local_error_from_continuation)
}

pub(super) fn validate_local_page_cap(
    layout: &crate::layout::LayoutConfig,
    cap: usize,
) -> Result<(), RuntimeChapterLocalRevisionError> {
    let in_range = (1..=RUNTIME_CHAPTER_LOCAL_PAGE_CAP_MAX).contains(&cap);
    let complete_spreads =
        layout.spread_mode != SpreadMode::Double || cap >= 2 && cap.is_multiple_of(2);
    if in_range && complete_spreads {
        return Ok(());
    }
    Err(local_error(
        RuntimeContinuationErrorKind::InvalidPageCap,
        format!(
            "localPageCap must be within 1..={RUNTIME_CHAPTER_LOCAL_PAGE_CAP_MAX} and cover complete double spreads"
        ),
    ))
}

pub(super) fn chapter_local_coordinate(
    chapter_index: usize,
    href: String,
) -> RuntimeChapterLocalCoordinate {
    RuntimeChapterLocalCoordinate {
        kind: RuntimeChapterLocalCoordinateKind::ChapterLocal,
        chapter_index,
        href,
    }
}

pub(super) fn chapter_local_owner(
    document: &LoadedEpubDocument,
    revision_id: &str,
    revision_version: u32,
    revision: &RuntimeRevision,
) -> RuntimeChapterLocalRevisionHandle {
    let chapter_index = match revision.coordinate_space {
        RuntimeRevisionCoordinateSpace::ChapterLocal { chapter_index, .. } => chapter_index,
        RuntimeRevisionCoordinateSpace::Absolute => {
            unreachable!("chapter-local store must not contain an absolute revision")
        }
    };
    RuntimeChapterLocalRevisionHandle {
        revision_id: revision_id.to_owned(),
        revision_version,
        coordinate: chapter_local_coordinate(
            chapter_index,
            document.chapters[chapter_index].href.clone(),
        ),
    }
}

pub(super) fn chapter_local_summary(
    owner: &RuntimeChapterLocalRevisionHandle,
    layout_key: &str,
    revision: &RuntimeRevision,
) -> RuntimeChapterLocalRevisionSummary {
    let (local_page_cap, page_cap_reached) = local_cap_state(revision);
    RuntimeChapterLocalRevisionSummary {
        revision_id: owner.revision_id.clone(),
        revision_version: owner.revision_version,
        layout_key: layout_key.to_owned(),
        status: revision.status,
        coordinate: owner.coordinate.clone(),
        local_page_cap,
        known_extent: local_extent(revision.known_extent),
        final_extent: revision.final_extent.map(local_extent),
        page_cap_reached,
    }
}

fn local_cap_state(revision: &RuntimeRevision) -> (usize, bool) {
    match revision.coordinate_space {
        RuntimeRevisionCoordinateSpace::ChapterLocal {
            local_page_cap,
            page_cap_reached,
            ..
        } => (local_page_cap, page_cap_reached),
        RuntimeRevisionCoordinateSpace::Absolute => {
            unreachable!("chapter-local store must not contain an absolute revision")
        }
    }
}

pub(super) fn local_extent(extent: RuntimeRevisionExtent) -> RuntimeChapterLocalRevisionExtent {
    RuntimeChapterLocalRevisionExtent {
        local_page_count: extent.page_count,
        local_spread_count: extent.spread_count,
    }
}

pub(super) fn mark_local_page_cap(revision: &mut RuntimeRevision, reached: bool) {
    let RuntimeRevisionCoordinateSpace::ChapterLocal {
        page_cap_reached, ..
    } = &mut revision.coordinate_space
    else {
        unreachable!("chapter-local store must not contain an absolute revision");
    };
    *page_cap_reached |= reached;
}

pub(super) fn local_locator_resolution(
    owner: RuntimeChapterLocalRevisionHandle,
    resolution: RuntimeSourceLocatorResolution,
) -> RuntimeChapterLocalSourceLocatorResolution {
    match resolution {
        RuntimeSourceLocatorResolution::Resolved {
            locator,
            spine_idref,
            page_index,
            spread_index,
            matched_by,
            ..
        } => RuntimeChapterLocalSourceLocatorResolution::Resolved {
            owner,
            locator,
            spine_idref,
            local_page_index: page_index,
            local_spread_index: spread_index,
            matched_by,
        },
        RuntimeSourceLocatorResolution::Pending {
            locator,
            spine_idref,
            reason,
            matched_by,
            ..
        } => RuntimeChapterLocalSourceLocatorResolution::Pending {
            owner,
            locator,
            spine_idref,
            reason,
            matched_by,
        },
    }
}

pub(super) fn local_error(
    kind: RuntimeContinuationErrorKind,
    message: impl Into<String>,
) -> RuntimeChapterLocalRevisionError {
    RuntimeChapterLocalRevisionError {
        kind,
        message: message.into(),
        revision: None,
    }
}

pub(super) fn local_unknown_revision(revision_id: &str) -> RuntimeChapterLocalRevisionError {
    local_error(
        RuntimeContinuationErrorKind::UnknownRevision,
        format!("unknown chapter-local revision: {revision_id}"),
    )
}

pub(super) fn local_engine_error(error: EpubError) -> RuntimeChapterLocalRevisionError {
    local_error(RuntimeContinuationErrorKind::EngineFailure, error.message())
}

pub(super) fn local_error_from_source(
    error: RuntimeSourceLocatorError,
) -> RuntimeChapterLocalRevisionError {
    local_error(
        RuntimeContinuationErrorKind::InvalidChapterLocalTarget,
        error.message,
    )
}

pub(super) fn local_error_from_continuation(
    error: RuntimeContinuationError,
) -> RuntimeChapterLocalRevisionError {
    local_error(error.kind, error.message)
}

impl fmt::Display for RuntimeChapterLocalRevisionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for RuntimeChapterLocalRevisionError {}
