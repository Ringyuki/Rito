use std::{error::Error, fmt};

use crate::{
    epub::{EpubError, LoadedEpubDocument},
    runtime::{
        frame::{RuntimeRevision, RuntimeRevisionCoordinateSpace},
        RuntimeChapterLocalCoordinate, RuntimeChapterLocalCoordinateKind,
        RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionHandle,
        RuntimeChapterLocalRevisionSummary, RuntimeChapterLocalSourceLocatorResolution,
        RuntimeRevisionErrorKind, RuntimeSourceLocatorError, RuntimeSourceLocatorResolution,
    },
};

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
        RuntimeRevisionCoordinateSpace::ChapterLocal { chapter_index } => chapter_index,
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
    RuntimeChapterLocalRevisionSummary {
        revision_id: owner.revision_id.clone(),
        revision_version: owner.revision_version,
        layout_key: layout_key.to_owned(),
        coordinate: owner.coordinate.clone(),
        local_page_count: revision.extent.page_count,
        local_spread_count: revision.extent.spread_count,
    }
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
    kind: RuntimeRevisionErrorKind,
    message: impl Into<String>,
) -> RuntimeChapterLocalRevisionError {
    RuntimeChapterLocalRevisionError {
        kind,
        message: message.into(),
    }
}

pub(super) fn local_unknown_revision(revision_id: &str) -> RuntimeChapterLocalRevisionError {
    local_error(
        RuntimeRevisionErrorKind::UnknownRevision,
        format!("unknown chapter-local revision: {revision_id}"),
    )
}

pub(super) fn local_engine_error(error: EpubError) -> RuntimeChapterLocalRevisionError {
    local_error(RuntimeRevisionErrorKind::EngineFailure, error.message())
}

pub(super) fn local_error_from_source(
    error: RuntimeSourceLocatorError,
) -> RuntimeChapterLocalRevisionError {
    local_error(
        RuntimeRevisionErrorKind::InvalidChapterLocalTarget,
        error.message,
    )
}

impl fmt::Display for RuntimeChapterLocalRevisionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for RuntimeChapterLocalRevisionError {}
