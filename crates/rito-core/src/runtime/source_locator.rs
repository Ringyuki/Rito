use crate::layout::collect_anchor_pages;

use super::{
    navigation::spread_index_for_page, RuntimeChapterTextIndex, RuntimeDocument, RuntimeRevision,
};

mod href;
mod index;
mod projection;
mod types;

use href::{canonicalize_source_locator, CanonicalSourceLocator};
use index::RuntimeSourceAnchor;
pub(super) use index::RuntimeSourceChapterIndex;
use projection::{project_source_offset, project_source_point, SourceProjection};
pub use types::*;

pub(super) fn canonical_runtime_source_locator(
    document: &crate::epub::LoadedEpubDocument,
    locator: RuntimeSourceLocator,
) -> Result<RuntimeSourceLocator, RuntimeSourceLocatorError> {
    canonicalize_source_locator(document, locator).map(|canonical| canonical.locator)
}

impl RuntimeDocument {
    pub fn resolve_source_locator(
        &mut self,
        revision_id: &str,
        locator: RuntimeSourceLocator,
    ) -> Result<RuntimeSourceLocatorResolution, RuntimeSourceLocatorError> {
        if !self.revisions.contains_key(revision_id) {
            return Err(RuntimeSourceLocatorError::unknown_revision(revision_id));
        }
        let canonical = canonicalize_source_locator(&self.document, locator)?;
        self.ensure_source_chapter_index(canonical.chapter_index)?;
        let source_index = self
            .source_chapter_indices
            .get(&canonical.spine_idref)
            .expect("source chapter index was ensured");
        validate_source_selectors(&canonical.locator, source_index)?;
        let revision = self
            .revisions
            .get(revision_id)
            .expect("revision existence was checked before loading source");
        Ok(resolve_canonical_source_locator(
            revision_id,
            revision,
            canonical,
            source_index,
        ))
    }
}

fn validate_source_selectors(
    locator: &RuntimeSourceLocator,
    source_index: &RuntimeSourceChapterIndex,
) -> Result<(), RuntimeSourceLocatorError> {
    if let Some(point) = &locator.source_point {
        require_source_point_offset(source_index, point)?;
    }
    if let Some(range) = &locator.source_range {
        let start = require_source_point_offset(source_index, &range.start)?;
        let end = require_source_point_offset(source_index, &range.end)?;
        if end < start {
            return Err(RuntimeSourceLocatorError::invalid_selector(
                "sourceRange end precedes its start",
            ));
        }
    }
    if let Some(anchor_id) = &locator.anchor_id {
        if !source_index.anchors.contains_key(anchor_id) {
            return Err(RuntimeSourceLocatorError::invalid_selector(format!(
                "anchor not found in source: {anchor_id}"
            )));
        }
    }
    Ok(())
}

fn resolve_canonical_source_locator(
    revision_id: &str,
    revision: &RuntimeRevision,
    canonical: CanonicalSourceLocator,
    source_index: &RuntimeSourceChapterIndex,
) -> RuntimeSourceLocatorResolution {
    let matched_by = matched_by(&canonical.locator);
    let Some(chapter_range) = revision
        .layout
        .summary
        .pagination_flow
        .chapter_map
        .get(&canonical.spine_idref)
    else {
        let reason = unavailable_projection_reason(revision, &canonical.spine_idref);
        return pending_resolution(revision_id, canonical, matched_by, reason);
    };
    if chapter_range.start_page >= revision.known_extent.page_count {
        return pending_resolution(
            revision_id,
            canonical,
            matched_by,
            RuntimeSourceLocatorPendingReason::NotPaginated,
        );
    }
    let known_end_page = chapter_range
        .end_page
        .min(revision.known_extent.page_count - 1);
    let Some(pages) = revision
        .layout
        .pages
        .get(chapter_range.start_page..=known_end_page)
    else {
        let reason = unavailable_projection_reason(revision, &canonical.spine_idref);
        return pending_resolution(revision_id, canonical, matched_by, reason);
    };
    let projection = match matched_by {
        RuntimeSourceLocatorMatchedBy::SourceRange => canonical
            .locator
            .source_range
            .as_ref()
            .map_or(SourceProjection::NoPageProjection, |range| {
                project_source_point(pages, source_index, &range.start)
            }),
        RuntimeSourceLocatorMatchedBy::SourcePoint => canonical
            .locator
            .source_point
            .as_ref()
            .map_or(SourceProjection::NoPageProjection, |point| {
                project_source_point(pages, source_index, point)
            }),
        RuntimeSourceLocatorMatchedBy::Anchor => {
            let anchor = canonical.locator.anchor_id.as_ref();
            anchor
                .and_then(|anchor| collect_anchor_pages(pages).get(anchor).copied())
                .map(SourceProjection::Page)
                .or_else(|| {
                    anchor
                        .and_then(|anchor| source_index.anchors.get(anchor))
                        .map(|anchor| match anchor {
                            RuntimeSourceAnchor::ChapterStart => {
                                SourceProjection::Page(chapter_range.start_page)
                            }
                            RuntimeSourceAnchor::Point(point) => {
                                project_source_point(pages, source_index, point)
                            }
                            RuntimeSourceAnchor::NoPageProjection => {
                                SourceProjection::NoPageProjection
                            }
                        })
                })
                .unwrap_or(SourceProjection::NoPageProjection)
        }
        RuntimeSourceLocatorMatchedBy::Progression => {
            let progression = canonical.locator.progression.unwrap_or(0.0);
            let text_length = normalized_text_length(&source_index.text);
            if text_length == 0 {
                SourceProjection::Page(chapter_range.start_page)
            } else {
                let offset = (progression * text_length as f64).round() as usize;
                project_source_offset(pages, source_index, offset.min(text_length))
            }
        }
        RuntimeSourceLocatorMatchedBy::Href => SourceProjection::Page(chapter_range.start_page),
    };
    let SourceProjection::Page(page_index) = projection else {
        let reason = unavailable_projection_reason(revision, &canonical.spine_idref);
        return pending_resolution(revision_id, canonical, matched_by, reason);
    };
    RuntimeSourceLocatorResolution::Resolved {
        revision_id: revision_id.to_owned(),
        locator: canonical.locator,
        spine_idref: canonical.spine_idref,
        page_index,
        spread_index: spread_index_for_page(revision, page_index),
        matched_by,
    }
}

fn pending_resolution(
    revision_id: &str,
    canonical: CanonicalSourceLocator,
    matched_by: RuntimeSourceLocatorMatchedBy,
    reason: RuntimeSourceLocatorPendingReason,
) -> RuntimeSourceLocatorResolution {
    RuntimeSourceLocatorResolution::Pending {
        revision_id: revision_id.to_owned(),
        locator: canonical.locator,
        spine_idref: canonical.spine_idref,
        reason,
        matched_by,
    }
}

fn unavailable_projection_reason(
    revision: &RuntimeRevision,
    spine_idref: &str,
) -> RuntimeSourceLocatorPendingReason {
    if revision
        .interactions
        .completed_chapter_idrefs
        .contains(spine_idref)
    {
        RuntimeSourceLocatorPendingReason::NoPageProjection
    } else {
        RuntimeSourceLocatorPendingReason::NotPaginated
    }
}

fn matched_by(locator: &RuntimeSourceLocator) -> RuntimeSourceLocatorMatchedBy {
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

fn require_source_point_offset(
    index: &RuntimeSourceChapterIndex,
    point: &RuntimeSourcePoint,
) -> Result<usize, RuntimeSourceLocatorError> {
    source_point_offset(index, point).ok_or_else(|| {
        RuntimeSourceLocatorError::invalid_selector(format!(
            "source point is outside the parsed chapter: {:?}:{}",
            point.node_path, point.text_offset
        ))
    })
}

fn source_point_offset(
    index: &RuntimeSourceChapterIndex,
    point: &RuntimeSourcePoint,
) -> Option<usize> {
    let span = index.span(&point.node_path)?;
    (point.text_offset >= span.source_start && point.text_offset <= span.source_end)
        .then(|| span.normalized_start + point.text_offset - span.source_start)
}

fn normalized_text_length(index: &RuntimeChapterTextIndex) -> usize {
    index
        .spans
        .last()
        .map(|span| span.normalized_end)
        .unwrap_or(0)
}
