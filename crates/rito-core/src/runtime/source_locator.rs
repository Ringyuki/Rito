use crate::epub::{EpubError, EpubResult};

use super::page_artifact::PageArtifactSourceRunStart;
use super::{
    navigation::spread_index_for_page, RuntimeChapterTextIndex, RuntimeDocument,
    RuntimeExactSourceRangeRequest, RuntimeRevision, RuntimeRevisionStatus,
};

mod href;
mod index;
mod projection;
mod types;

pub(super) use href::RuntimeSourceLocatorCanonicalizer;
use href::{canonicalize_source_locator, CanonicalSourceLocator};
use index::RuntimeSourceAnchor;
pub(super) use index::RuntimeSourceChapterIndex;
use projection::{project_source_offset, project_source_point, SourceProjection};
pub use types::*;

pub(super) struct PreparedExactSourceRange {
    pub(super) locator: RuntimeSourceLocator,
    pub(super) spine_idref: String,
    pub(super) source_range: RuntimeSourceRange,
    pub(super) normalized_source_text: String,
}

pub(super) enum ExactSourceRangePageWindow {
    Ready { first_page: usize, last_page: usize },
    Pending(RuntimeSourceLocatorPendingReason),
}

struct PageReadingAnchorCapture {
    spread_index: usize,
    source_starts: Vec<PageArtifactSourceRunStart>,
    chapter_index: Option<usize>,
}

fn unavailable_page_reading_anchor(
    revision_id: &str,
    page_index: usize,
    spread_index: usize,
    reason: RuntimePageReadingAnchorUnavailableReason,
) -> RuntimePageReadingAnchor {
    RuntimePageReadingAnchor::Unavailable {
        revision_id: revision_id.to_owned(),
        page_index,
        spread_index,
        reason,
    }
}

impl RuntimeDocument {
    pub fn get_page_reading_anchor(
        &mut self,
        revision_id: &str,
        page_index: usize,
    ) -> EpubResult<RuntimePageReadingAnchor> {
        let capture = self.capture_page_reading_source(revision_id, page_index)?;
        if capture.source_starts.is_empty() {
            return Ok(self.page_reading_anchor_fallback(
                revision_id,
                page_index,
                capture.spread_index,
                capture.chapter_index,
                RuntimePageReadingAnchorUnavailableReason::NoSourceContent,
            ));
        }
        let Some(chapter_index) = capture.chapter_index else {
            return Ok(unavailable_page_reading_anchor(
                revision_id,
                page_index,
                capture.spread_index,
                RuntimePageReadingAnchorUnavailableReason::SourceUnavailable,
            ));
        };
        let Some(locator) = self.page_reading_locator(chapter_index, capture.source_starts) else {
            return Ok(self.page_reading_anchor_fallback(
                revision_id,
                page_index,
                capture.spread_index,
                Some(chapter_index),
                RuntimePageReadingAnchorUnavailableReason::SourceUnavailable,
            ));
        };
        Ok(RuntimePageReadingAnchor::Resolved {
            revision_id: revision_id.to_owned(),
            page_index,
            spread_index: capture.spread_index,
            locator,
        })
    }

    /// Text-free pages (cover plates, illustration spreads) still need a
    /// durable locator: progress persistence and publication spread
    /// publishing both dead-end on `Unavailable`. Mirror the
    /// chapter-local reader's degradation ladder — a paint-target
    /// canonical locator when the page carries one (images own source
    /// identity), else the page's position inside its chapter as a
    /// progression.
    fn page_reading_anchor_fallback(
        &mut self,
        revision_id: &str,
        page_index: usize,
        spread_index: usize,
        chapter_index: Option<usize>,
        reason: RuntimePageReadingAnchorUnavailableReason,
    ) -> RuntimePageReadingAnchor {
        let Some(chapter_index) = chapter_index else {
            return unavailable_page_reading_anchor(revision_id, page_index, spread_index, reason);
        };
        if let Ok(targets) = self.get_page_targets(revision_id, page_index) {
            if let Some(locator) = targets
                .entries
                .into_iter()
                .find_map(|entry| entry.source_locator)
            {
                return RuntimePageReadingAnchor::Resolved {
                    revision_id: revision_id.to_owned(),
                    page_index,
                    spread_index,
                    locator,
                };
            }
        }
        let chapter = &self.document.chapters[chapter_index];
        let href = chapter.href.clone();
        let idref = chapter.idref.clone();
        let progression = self
            .revisions
            .get(revision_id)
            .and_then(|revision| revision.chapter_engine_session().known_chapter(&idref))
            .map(|range| {
                let span = range.end_page.saturating_sub(range.start_page);
                if span == 0 {
                    0.0
                } else {
                    page_index.saturating_sub(range.start_page) as f64 / span as f64
                }
            })
            .unwrap_or(0.0);
        RuntimePageReadingAnchor::Resolved {
            revision_id: revision_id.to_owned(),
            page_index,
            spread_index,
            locator: RuntimeSourceLocator {
                href,
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: Some(progression),
            },
        }
    }

    fn capture_page_reading_source(
        &self,
        revision_id: &str,
        page_index: usize,
    ) -> EpubResult<PageReadingAnchorCapture> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        if page_index >= revision.known_extent.page_count {
            return Err(EpubError::new(format!("unknown page index: {page_index}")));
        }
        let page_end = page_index
            .checked_add(1)
            .ok_or_else(|| EpubError::new(format!("unknown page index: {page_index}")))?;
        let source_starts = revision
            .chapter_engine_session()
            .source_run_starts(page_index..page_end)
            .ok_or_else(|| EpubError::new(format!("unknown page index: {page_index}")))?;
        let chapter_index =
            super::page_target::chapter_for_page(&self.document, revision, page_index).and_then(
                |chapter| {
                    self.document
                        .chapters
                        .iter()
                        .position(|candidate| candidate.idref == chapter.idref)
                },
            );
        Ok(PageReadingAnchorCapture {
            spread_index: spread_index_for_page(revision, page_index),
            source_starts,
            chapter_index,
        })
    }

    fn page_reading_locator(
        &mut self,
        chapter_index: usize,
        source_starts: Vec<PageArtifactSourceRunStart>,
    ) -> Option<RuntimeSourceLocator> {
        self.ensure_source_chapter_index(chapter_index).ok()?;
        let chapter = &self.document.chapters[chapter_index];
        let source_index = self
            .source_chapter_indices
            .get(&chapter.idref)
            .expect("source chapter index was ensured");
        let (source_point, source_offset) = source_starts.into_iter().find_map(|start| {
            let source_point = RuntimeSourcePoint {
                node_path: start.node_path,
                text_offset: start.text_offset,
            };
            source_point_offset(source_index, &source_point).map(|offset| (source_point, offset))
        })?;
        let text_length = normalized_text_length(&source_index.text);
        let progression = (text_length > 0).then_some(source_offset as f64 / text_length as f64);
        Some(RuntimeSourceLocator {
            href: source_index.text.href.clone(),
            anchor_id: None,
            source_point: Some(source_point),
            source_range: None,
            progression,
        })
    }

    pub fn resolve_source_locator(
        &mut self,
        revision_id: &str,
        locator: RuntimeSourceLocator,
    ) -> Result<RuntimeSourceLocatorResolution, RuntimeSourceLocatorError> {
        if !self.revisions.contains_key(revision_id) {
            return Err(RuntimeSourceLocatorError::unknown_revision(revision_id));
        }
        let canonical = canonicalize_source_locator(&self.document, locator)?;
        if matched_by(&canonical.locator) == RuntimeSourceLocatorMatchedBy::Href {
            let revision = self
                .revisions
                .get(revision_id)
                .expect("revision existence was checked before canonicalizing the href");
            return Ok(resolve_canonical_source_locator(
                revision_id,
                revision,
                canonical,
                None,
            ));
        }
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
            Some(source_index),
        ))
    }

    pub(super) fn validate_source_locator_for_chapter_local(
        &mut self,
        locator: RuntimeSourceLocator,
    ) -> Result<(usize, RuntimeSourceLocator), RuntimeSourceLocatorError> {
        let canonical = canonicalize_source_locator(&self.document, locator)?;
        if matched_by(&canonical.locator) != RuntimeSourceLocatorMatchedBy::Href {
            self.ensure_source_chapter_index(canonical.chapter_index)?;
            let source_index = self
                .source_chapter_indices
                .get(&canonical.spine_idref)
                .expect("chapter-local source index was ensured");
            validate_source_selectors(&canonical.locator, source_index)?;
        }
        Ok((canonical.chapter_index, canonical.locator))
    }

    pub(super) fn resolve_chapter_local_source_locator_inner(
        &mut self,
        revision_id: &str,
        locator: RuntimeSourceLocator,
    ) -> Result<RuntimeSourceLocatorResolution, RuntimeSourceLocatorError> {
        if !self.chapter_local_revisions.contains_key(revision_id) {
            return Err(RuntimeSourceLocatorError::unknown_revision(revision_id));
        }
        let canonical = canonicalize_source_locator(&self.document, locator)?;
        let source_index = if matched_by(&canonical.locator) == RuntimeSourceLocatorMatchedBy::Href
        {
            None
        } else {
            self.ensure_source_chapter_index(canonical.chapter_index)?;
            Some(
                self.source_chapter_indices
                    .get(&canonical.spine_idref)
                    .expect("chapter-local source index was ensured"),
            )
        };
        if let Some(source_index) = source_index {
            validate_source_selectors(&canonical.locator, source_index)?;
        }
        let revision = self
            .chapter_local_revisions
            .get(revision_id)
            .expect("chapter-local revision existence was checked");
        Ok(resolve_canonical_source_locator(
            revision_id,
            revision,
            canonical,
            source_index,
        ))
    }

    pub(super) fn prepare_exact_source_range(
        &mut self,
        request: RuntimeExactSourceRangeRequest,
    ) -> Result<PreparedExactSourceRange, RuntimeSourceLocatorError> {
        let canonical = canonicalize_source_locator(
            &self.document,
            RuntimeSourceLocator {
                href: request.href,
                anchor_id: None,
                source_point: None,
                source_range: Some(request.source_range),
                progression: None,
            },
        )?;
        self.ensure_source_chapter_index(canonical.chapter_index)?;
        let source_index = self
            .source_chapter_indices
            .get(&canonical.spine_idref)
            .expect("source chapter index was ensured");
        validate_source_selectors(&canonical.locator, source_index)?;
        let source_range = canonical
            .locator
            .source_range
            .clone()
            .expect("exact source range request installs a sourceRange");
        let start = require_source_point_offset(source_index, &source_range.start)?;
        let end = require_source_point_offset(source_index, &source_range.end)?;
        let normalized_source_text = utf16_slice(&source_index.text.normalized_text, start, end)
            .ok_or_else(|| RuntimeSourceLocatorError::invalid_selector("invalid UTF-16 range"))?
            .to_owned();
        Ok(PreparedExactSourceRange {
            locator: canonical.locator,
            spine_idref: canonical.spine_idref,
            source_range,
            normalized_source_text,
        })
    }

    pub(super) fn exact_source_range_page_window(
        &self,
        revision_id: &str,
        prepared: &PreparedExactSourceRange,
    ) -> Result<ExactSourceRangePageWindow, RuntimeSourceLocatorError> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| RuntimeSourceLocatorError::unknown_revision(revision_id))?;
        let source_index = self
            .source_chapter_indices
            .get(&prepared.spine_idref)
            .expect("source chapter index was prepared");
        let session = revision.chapter_engine_session();
        let Some(chapter_range) = session.known_chapter(&prepared.spine_idref) else {
            return Ok(ExactSourceRangePageWindow::Pending(
                unavailable_projection_reason(revision, &prepared.spine_idref),
            ));
        };
        let Some(end_page_exclusive) = chapter_range.end_page.checked_add(1) else {
            return Ok(ExactSourceRangePageWindow::Pending(
                unavailable_projection_reason(revision, &prepared.spine_idref),
            ));
        };
        let Some(source_starts) =
            session.source_run_starts(chapter_range.start_page..end_page_exclusive)
        else {
            return Ok(ExactSourceRangePageWindow::Pending(
                unavailable_projection_reason(revision, &prepared.spine_idref),
            ));
        };
        for point in [&prepared.source_range.start, &prepared.source_range.end] {
            match project_source_point(&source_starts, source_index, point) {
                SourceProjection::Page(_) => {}
                SourceProjection::BeyondSealedExtent => {
                    return Ok(ExactSourceRangePageWindow::Pending(
                        RuntimeSourceLocatorPendingReason::NotPaginated,
                    ));
                }
                SourceProjection::NoPageProjection => {
                    return Ok(ExactSourceRangePageWindow::Pending(
                        unavailable_projection_reason(revision, &prepared.spine_idref),
                    ));
                }
            }
        }
        Ok(ExactSourceRangePageWindow::Ready {
            first_page: chapter_range.start_page,
            last_page: chapter_range.end_page,
        })
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
    source_index: Option<&RuntimeSourceChapterIndex>,
) -> RuntimeSourceLocatorResolution {
    let matched_by = matched_by(&canonical.locator);
    let session = revision.chapter_engine_session();
    let Some(chapter_range) = session.known_chapter(&canonical.spine_idref) else {
        let reason = unavailable_projection_reason(revision, &canonical.spine_idref);
        return pending_resolution(revision_id, canonical, matched_by, reason);
    };
    let Some(end_page_exclusive) = chapter_range.end_page.checked_add(1) else {
        let reason = unavailable_projection_reason(revision, &canonical.spine_idref);
        return pending_resolution(revision_id, canonical, matched_by, reason);
    };
    let page_range = chapter_range.start_page..end_page_exclusive;
    let Some(source_starts) = session.source_run_starts(page_range.clone()) else {
        let reason = unavailable_projection_reason(revision, &canonical.spine_idref);
        return pending_resolution(revision_id, canonical, matched_by, reason);
    };
    let projection = match (matched_by, source_index) {
        (RuntimeSourceLocatorMatchedBy::SourceRange, Some(source_index)) => canonical
            .locator
            .source_range
            .as_ref()
            .map_or(SourceProjection::NoPageProjection, |range| {
                project_source_point(&source_starts, source_index, &range.start)
            }),
        (RuntimeSourceLocatorMatchedBy::SourcePoint, Some(source_index)) => canonical
            .locator
            .source_point
            .as_ref()
            .map_or(SourceProjection::NoPageProjection, |point| {
                project_source_point(&source_starts, source_index, point)
            }),
        (RuntimeSourceLocatorMatchedBy::Anchor, Some(source_index)) => {
            let anchor = canonical.locator.anchor_id.as_ref();
            anchor
                .and_then(|anchor| {
                    session
                        .anchor_pages(page_range.clone())?
                        .get(anchor)
                        .copied()
                })
                .map(SourceProjection::Page)
                .or_else(|| {
                    anchor
                        .and_then(|anchor| source_index.anchors.get(anchor))
                        .map(|anchor| match anchor {
                            RuntimeSourceAnchor::ChapterStart => {
                                SourceProjection::Page(chapter_range.start_page)
                            }
                            RuntimeSourceAnchor::Point(point) => {
                                project_source_point(&source_starts, source_index, point)
                            }
                            RuntimeSourceAnchor::NoPageProjection => {
                                SourceProjection::NoPageProjection
                            }
                        })
                })
                .unwrap_or(SourceProjection::NoPageProjection)
        }
        (RuntimeSourceLocatorMatchedBy::Progression, Some(source_index)) => {
            let progression = canonical.locator.progression.unwrap_or(0.0);
            let text_length = normalized_text_length(&source_index.text);
            if text_length == 0 {
                SourceProjection::Page(chapter_range.start_page)
            } else {
                let offset = (progression * text_length as f64).round() as usize;
                let projection =
                    project_source_offset(&source_starts, source_index, offset.min(text_length));
                // A progression target is a ratio, not an exact point: once
                // the revision is complete it must always publish. Hidden
                // text (display:none tails and the like) sits in the
                // normalized index but never enters paint runs, so a 1.0
                // progression lands beyond the sealed extent forever —
                // clamp it to the chapter's last page instead of leaving
                // the completed revision unresolvable (the previous-chapter
                // tail crash).
                if projection == SourceProjection::BeyondSealedExtent
                    && revision.status == RuntimeRevisionStatus::Complete
                {
                    SourceProjection::Page(chapter_range.end_page)
                } else {
                    projection
                }
            }
        }
        (RuntimeSourceLocatorMatchedBy::Href, _) => {
            SourceProjection::Page(chapter_range.start_page)
        }
        (_, None) => unreachable!("non-href source locator requires a source chapter index"),
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

pub(super) fn utf16_slice(text: &str, start: usize, end: usize) -> Option<&str> {
    if start > end {
        return None;
    }
    let mut utf16_offset = 0usize;
    let mut start_byte = (start == 0).then_some(0);
    let mut end_byte = (end == 0).then_some(0);
    for (byte, character) in text.char_indices() {
        if utf16_offset == start {
            start_byte = Some(byte);
        }
        if utf16_offset == end {
            end_byte = Some(byte);
            break;
        }
        utf16_offset += character.len_utf16();
        if utf16_offset > end {
            return None;
        }
    }
    if start_byte.is_none() && utf16_offset == start {
        start_byte = Some(text.len());
    }
    if end_byte.is_none() && utf16_offset == end {
        end_byte = Some(text.len());
    }
    text.get(start_byte?..end_byte?)
}

#[cfg(test)]
mod utf16_slice_tests {
    use super::utf16_slice;

    #[test]
    fn preserves_non_terminal_utf16_boundaries() {
        let text = "A😀BC";

        assert_eq!(utf16_slice(text, 1, 4), Some("😀B"));
        assert_eq!(utf16_slice(text, 3, 5), Some("BC"));
        assert_eq!(utf16_slice(text, 2, 3), None);
    }
}
