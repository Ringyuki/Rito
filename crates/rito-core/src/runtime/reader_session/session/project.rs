//! Pure projections from runtime and session values into reader session shapes:
//! artifact ownership records and their painted-text digest, navigation
//! availability for chapter-local and publication spreads, neighbouring
//! linear chapters, locator precision, and the resolved target and revision
//! handle carried by a created chapter-local revision.

use crate::runtime::{
    RuntimeChapterLocalRevisionHandle, RuntimeChapterLocalSourceLocatorResolution,
    RuntimeCreatedChapterLocalRevision, RuntimeDocument, RuntimeSourceLocator,
    RuntimeSourceLocatorMatchedBy,
};

use super::{
    ReaderAdjacentAvailability, ReaderAdjacentDirection, ReaderArtifact, ReaderArtifactOwner,
    ReaderNavigation, ReaderPublicationRevisionOwner, ReaderRevisionBacking, ReaderRevisionOwner,
    ResolvedArtifactOwner, ResolvedArtifactTarget,
};

pub(super) fn artifact_owner(
    revision_id: u64,
    backing: ReaderRevisionBacking,
    local_spread_index: usize,
    artifact: &ReaderArtifact,
) -> ReaderArtifactOwner {
    ReaderArtifactOwner {
        request_id: artifact.request_id,
        revision_id,
        backing,
        locator: artifact.locator.clone(),
        local_spread_index,
        resources: artifact
            .resources
            .iter()
            .map(|resource| (resource.kind, resource.href.clone()))
            .collect(),
        painted_digest: painted_digest(artifact),
    }
}

pub(super) fn painted_digest(artifact: &ReaderArtifact) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for page in &artifact.pages {
        page.text.hash(&mut hasher);
        page.text_length.hash(&mut hasher);
    }
    hasher.finish()
}

pub(super) fn publication_navigation(
    revision: &ReaderPublicationRevisionOwner,
    spread_index: usize,
) -> ReaderNavigation {
    let previous = if spread_index > 0 {
        ReaderAdjacentAvailability::Available
    } else {
        ReaderAdjacentAvailability::Terminal
    };
    let next_index = spread_index.checked_add(1);
    let next = if next_index.is_some_and(|index| index < revision.spread_count) {
        ReaderAdjacentAvailability::Available
    } else {
        ReaderAdjacentAvailability::Terminal
    };
    ReaderNavigation { previous, next }
}

pub(super) fn locator_precision(locator: &RuntimeSourceLocator) -> RuntimeSourceLocatorMatchedBy {
    if locator.source_range.is_some() {
        RuntimeSourceLocatorMatchedBy::SourceRange
    } else if locator.source_point.is_some() {
        RuntimeSourceLocatorMatchedBy::SourcePoint
    } else if locator.anchor_id.is_some() {
        RuntimeSourceLocatorMatchedBy::Anchor
    } else if locator.progression.is_some() {
        RuntimeSourceLocatorMatchedBy::Progression
    } else {
        RuntimeSourceLocatorMatchedBy::Href
    }
}

pub(super) fn reader_navigation(
    document: &RuntimeDocument,
    revision: &ReaderRevisionOwner,
    local_spread_index: usize,
) -> ReaderNavigation {
    let chapter_index = revision.owner.coordinate.chapter_index;
    let previous = if local_spread_index > 0 {
        ReaderAdjacentAvailability::Available
    } else if adjacent_linear_chapter(document, chapter_index, ReaderAdjacentDirection::Previous)
        .is_some()
    {
        ReaderAdjacentAvailability::ChapterBoundary
    } else {
        ReaderAdjacentAvailability::Terminal
    };
    let next_index = local_spread_index.checked_add(1);
    let next = if next_index.is_some_and(|index| index < revision.local_spread_count) {
        ReaderAdjacentAvailability::Available
    } else if adjacent_linear_chapter(document, chapter_index, ReaderAdjacentDirection::Next)
        .is_some()
    {
        ReaderAdjacentAvailability::ChapterBoundary
    } else {
        ReaderAdjacentAvailability::Terminal
    };
    ReaderNavigation { previous, next }
}

pub(super) fn adjacent_linear_chapter(
    document: &RuntimeDocument,
    chapter_index: usize,
    direction: ReaderAdjacentDirection,
) -> Option<usize> {
    match direction {
        ReaderAdjacentDirection::Previous => document.document().chapters[..chapter_index]
            .iter()
            .rposition(|chapter| chapter.linear),
        ReaderAdjacentDirection::Next => document
            .document()
            .chapters
            .iter()
            .enumerate()
            .skip(chapter_index.checked_add(1)?)
            .find_map(|(index, chapter)| chapter.linear.then_some(index)),
    }
}

pub(super) fn resolved_target(
    created: &RuntimeCreatedChapterLocalRevision,
) -> Option<ResolvedArtifactTarget> {
    let RuntimeChapterLocalSourceLocatorResolution::Resolved {
        owner,
        locator,
        local_page_index,
        local_spread_index,
        matched_by,
        ..
    } = &created.target
    else {
        return None;
    };
    Some(ResolvedArtifactTarget {
        owner: ResolvedArtifactOwner::ChapterLocal(owner.clone()),
        locator: locator.clone(),
        matched_by: *matched_by,
        local_page_index: *local_page_index,
        local_spread_index: *local_spread_index,
    })
}

pub(super) fn owner_from_created(
    created: &RuntimeCreatedChapterLocalRevision,
) -> RuntimeChapterLocalRevisionHandle {
    RuntimeChapterLocalRevisionHandle {
        revision_id: created.revision.revision_id.clone(),
        revision_version: created.revision.revision_version,
        coordinate: created.revision.coordinate.clone(),
    }
}
