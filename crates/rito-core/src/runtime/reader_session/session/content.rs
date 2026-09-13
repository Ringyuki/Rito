//! Reads that answer questions about an artifact the session already
//! published: the resource bytes an artifact references, the footnote
//! definition behind a hit, text search over the revision backing an
//! artifact, and the display-list geometry of a text range on one of its
//! pages. The private converters at the bottom turn runtime search and
//! geometry values into their reader session shapes.

use crate::runtime::{
    RuntimeRevision, RuntimeSearchRequest, RuntimeSourceLocator, RuntimeTextRangeGeometryRequest,
};

use super::super::{artifact::page_origin, convert::reader_locator};
use super::{
    errors::{
        engine_error, missing_artifact_revision, numeric_overflow, target_not_published,
        unknown_artifact, validate_external_request_id,
    },
    reader_resource_bytes_max, runtime_resource_kind, u32_from_usize, usize_from_u32, ReaderError,
    ReaderErrorKind, ReaderFootnote, ReaderFootnoteKind, ReaderRect, ReaderResource,
    ReaderResourceKind, ReaderRevisionBacking, ReaderSearchRequest, ReaderSearchResponse,
    ReaderSearchResult, ReaderSession, ReaderTextPosition, ReaderTextRangeGeometry,
    ReaderTextRangeRequest, ReaderTextRect,
};

impl ReaderSession {
    pub fn read_resource(
        &mut self,
        artifact_id: u64,
        kind: ReaderResourceKind,
        href: &str,
    ) -> Result<ReaderResource, ReaderError> {
        validate_external_request_id(artifact_id, "artifactId")?;
        let artifact = self
            .artifacts
            .get(&artifact_id)
            .ok_or_else(|| unknown_artifact(artifact_id))?;
        if !artifact
            .resources
            .iter()
            .any(|candidate| candidate.0 == kind && candidate.1 == href)
        {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidRequest,
                format!("artifact {artifact_id} does not reference {href}"),
            ));
        }
        let runtime_kind = runtime_resource_kind(kind);
        let byte_limit = reader_resource_bytes_max(kind);
        if self
            .document
            .resource_byte_length(runtime_kind, href)
            .is_some_and(|length| u64::try_from(length).map_or(true, |length| length > byte_limit))
        {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidRequest,
                format!("resource {href:?} exceeds its reader session byte limit ({byte_limit})"),
            ));
        }
        let resource = match artifact.backing {
            ReaderRevisionBacking::ChapterLocal => {
                let owner = self
                    .revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                self.document
                    .get_chapter_local_resource(&owner, runtime_kind, href)
                    .map_err(engine_error)?
            }
            ReaderRevisionBacking::Publication => {
                let owner = self
                    .publication_revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                self.document
                    .get_resource_at(&owner, runtime_kind, href)
                    .map_err(engine_error)?
                    .value
            }
        };
        let byte_length = u64::try_from(resource.bytes.len())
            .map_err(|_| numeric_overflow("resource byte length"))?;
        if byte_length > byte_limit {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidRequest,
                format!("resource {href:?} exceeds its reader session byte limit ({byte_limit})"),
            ));
        }
        Ok(ReaderResource {
            artifact_id,
            kind,
            // Resource resolution may canonicalize the href away from the
            // artifact's declared reference; adapters validate the response
            // against the reference they asked for, so echo that lookup key.
            href: href.to_owned(),
            media_type: resource.media_type,
            bytes: resource.bytes,
            width: resource.width,
            height: resource.height,
        })
    }

    /// Reads a footnote definition an artifact's hits referenced.
    ///
    /// `key` is the hit's `footnote_key` verbatim — it is already the
    /// canonical publication-relative form the index is keyed by, so
    /// hosts must not normalize the link href themselves. A key whose
    /// definition has not been indexed yet (the hit reported
    /// `footnote_pending`) fails with `TargetNotPublished`; the same
    /// read succeeds once the background footnote index reaches it.
    pub fn read_footnote(
        &mut self,
        artifact_id: u64,
        key: &str,
    ) -> Result<ReaderFootnote, ReaderError> {
        validate_external_request_id(artifact_id, "artifactId")?;
        if key.is_empty() {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidRequest,
                "footnote key must not be empty",
            ));
        }
        let artifact = self
            .artifacts
            .get(&artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(artifact_id))?;
        let entry = match artifact.backing {
            ReaderRevisionBacking::ChapterLocal => {
                let owner = self
                    .revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                self.document
                    .get_chapter_local_footnote(&owner, key)
                    .map_err(engine_error)?
                    .map(|entry| (entry.kind, entry.text, entry.html))
            }
            ReaderRevisionBacking::Publication => {
                let owner = self
                    .publication_revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                self.document
                    .get_footnote_at(&owner, key)
                    .ok()
                    .map(|versioned| versioned.value)
                    .map(|footnote| (footnote.kind, footnote.text, footnote.html))
            }
        };
        let (kind, text, html) =
            entry.ok_or_else(|| target_not_published("footnote definition is not indexed yet"))?;
        Ok(ReaderFootnote {
            artifact_id,
            key: key.to_owned(),
            kind: reader_footnote_kind(kind),
            text,
            html,
        })
    }

    /// Searches the revision backing an artifact.
    ///
    /// Scope follows that revision: from a chapter-local artifact the
    /// search covers the pages that chapter has laid out; from a
    /// publication artifact it covers the whole book as far as
    /// background pagination has reached. Hits carry the page-text
    /// positions `get_text_range_geometry` consumes and, where the
    /// layout retained source identity, a durable locator to store.
    pub fn search(
        &mut self,
        request: ReaderSearchRequest,
    ) -> Result<ReaderSearchResponse, ReaderError> {
        if request.session_id != self.session_id {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidSession,
                "search request belongs to a different session",
            ));
        }
        validate_external_request_id(request.artifact_id, "artifactId")?;
        if request.query.is_empty() {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidRequest,
                "search query must not be empty",
            ));
        }
        let artifact = self
            .artifacts
            .get(&request.artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(request.artifact_id))?;
        // Ask for one more than the cap so the response can say
        // truthfully whether the list is a prefix.
        let probe_limit = (request.limit > 0)
            .then(|| usize_from_u32(request.limit, "search limit"))
            .transpose()?
            .map(|limit| limit.saturating_add(1));
        let runtime_request = RuntimeSearchRequest {
            query: request.query.clone(),
            case_sensitive: request.case_sensitive,
            whole_word: request.whole_word,
            limit: probe_limit,
        };
        let (response, searched_page_count) = match artifact.backing {
            ReaderRevisionBacking::ChapterLocal => {
                let owner = self
                    .revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                let revision = self
                    .document
                    .require_chapter_local_owner(&owner)
                    .map_err(engine_error)?;
                (
                    crate::runtime::search::search_revision(
                        self.document.document(),
                        &owner.revision_id,
                        revision,
                        runtime_request,
                    ),
                    searched_page_count(revision)?,
                )
            }
            ReaderRevisionBacking::Publication => {
                let owner = self
                    .publication_revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                let revision = self
                    .document
                    .revisions
                    .get(&owner.revision_id)
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                (
                    crate::runtime::search::search_revision(
                        self.document.document(),
                        &owner.revision_id,
                        revision,
                        runtime_request,
                    ),
                    searched_page_count(revision)?,
                )
            }
        };
        let cap = usize_from_u32(request.limit, "search limit")?;
        let truncated = cap > 0 && response.results.len() > cap;
        let mut results = response.results;
        if truncated {
            results.truncate(cap);
        }
        Ok(ReaderSearchResponse {
            artifact_id: request.artifact_id,
            query: request.query,
            truncated,
            searched_page_count,
            results: results
                .into_iter()
                .map(reader_search_result)
                .collect::<Result<Vec<_>, ReaderError>>()?,
        })
    }

    /// Resolves where a text range sits on one of an artifact's pages.
    ///
    /// The returned rects are in the artifact's display-list space, the
    /// same space [`ReaderHitEntry::bounds`] uses, so a host paints
    /// them directly onto the surface it drew the page on. `page_index`
    /// is one the artifact published (`ReaderPage::page_index`), and
    /// the positions are the ones its `text_runs` describe — anchoring
    /// a highlight to source text instead of to remembered pixels.
    pub fn get_text_range_geometry(
        &mut self,
        request: ReaderTextRangeRequest,
    ) -> Result<ReaderTextRangeGeometry, ReaderError> {
        if request.session_id != self.session_id {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidSession,
                "text range request belongs to a different session",
            ));
        }
        validate_external_request_id(request.artifact_id, "artifactId")?;
        let artifact = self
            .artifacts
            .get(&request.artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(request.artifact_id))?;
        let page_index = usize_from_u32(request.page_index, "page index")?;
        let runtime_request = RuntimeTextRangeGeometryRequest {
            page_index,
            start: runtime_text_position(request.start)?,
            end: runtime_text_position(request.end)?,
        };
        let (geometry, origin) = match artifact.backing {
            ReaderRevisionBacking::ChapterLocal => {
                let owner = self
                    .revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                let revision = self
                    .document
                    .require_chapter_local_owner(&owner)
                    .map_err(engine_error)?;
                let origin =
                    page_display_origin(revision, artifact.local_spread_index, page_index)?;
                let geometry = crate::runtime::page::text_range_geometry(
                    &owner.revision_id,
                    revision,
                    runtime_request,
                )
                .map_err(engine_error)?;
                (geometry, origin)
            }
            ReaderRevisionBacking::Publication => {
                let owner = self
                    .publication_revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                let revision = self
                    .document
                    .revisions
                    .get(&owner.revision_id)
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                let origin =
                    page_display_origin(revision, artifact.local_spread_index, page_index)?;
                let geometry = crate::runtime::page::text_range_geometry(
                    &owner.revision_id,
                    revision,
                    runtime_request,
                )
                .map_err(engine_error)?;
                (geometry, origin)
            }
        };
        Ok(ReaderTextRangeGeometry {
            artifact_id: request.artifact_id,
            page_index: request.page_index,
            rects: geometry
                .rects
                .into_iter()
                .map(|rect| {
                    Ok(ReaderTextRect {
                        bounds: ReaderRect {
                            x: rect.x + origin.0,
                            y: rect.y + origin.1,
                            width: rect.width,
                            height: rect.height,
                        },
                        block_index: u32_from_usize(rect.block_index, "text rect block index")?,
                        line_index: u32_from_usize(rect.line_index, "text rect line index")?,
                        run_index: u32_from_usize(rect.run_index, "text rect run index")?,
                        start_char_index: u32_from_usize(
                            rect.start_char_index,
                            "text rect start char index",
                        )?,
                        end_char_index: u32_from_usize(
                            rect.end_char_index,
                            "text rect end char index",
                        )?,
                    })
                })
                .collect::<Result<Vec<_>, ReaderError>>()?,
        })
    }
}

const fn reader_footnote_kind(kind: crate::interaction::FootnoteKind) -> ReaderFootnoteKind {
    match kind {
        crate::interaction::FootnoteKind::Footnote => ReaderFootnoteKind::Footnote,
        crate::interaction::FootnoteKind::Endnote => ReaderFootnoteKind::Endnote,
        crate::interaction::FootnoteKind::Rearnote => ReaderFootnoteKind::Rearnote,
        crate::interaction::FootnoteKind::Note => ReaderFootnoteKind::Note,
    }
}

/// Display-list origin of the page slot holding `page_index` inside the
/// artifact's spread, so geometry lands where the pen painted.
fn page_display_origin(
    revision: &RuntimeRevision,
    spread_index: usize,
    page_index: usize,
) -> Result<(f64, f64), ReaderError> {
    let page_indexes = revision
        .chapter_engine_session()
        .spread_pages(spread_index)
        .ok_or_else(|| target_not_published("artifact spread is not published"))?;
    let slot = page_indexes
        .iter()
        .position(|index| *index == page_index)
        .ok_or_else(|| {
            ReaderError::new(
                ReaderErrorKind::InvalidRequest,
                format!("page {page_index} is not part of this artifact"),
            )
        })?;
    Ok(page_origin(&revision.layout_config, slot))
}

fn runtime_text_position(
    value: ReaderTextPosition,
) -> Result<crate::runtime::SearchTextPosition, ReaderError> {
    Ok(crate::runtime::SearchTextPosition {
        block_index: usize_from_u32(value.block_index, "text position block index")?,
        line_index: usize_from_u32(value.line_index, "text position line index")?,
        run_index: usize_from_u32(value.run_index, "text position run index")?,
        char_index: usize_from_u32(value.char_index, "text position char index")?,
    })
}

fn reader_search_result(
    value: crate::runtime::RuntimeSearchResult,
) -> Result<ReaderSearchResult, ReaderError> {
    let locator = match value.source {
        crate::runtime::RuntimeSearchSource::Resolved { href, source_range } => {
            Some(reader_locator(RuntimeSourceLocator {
                href,
                anchor_id: None,
                source_point: None,
                source_range: Some(source_range),
                progression: None,
            })?)
        }
        crate::runtime::RuntimeSearchSource::Unavailable { .. } => None,
    };
    Ok(ReaderSearchResult {
        page_index: u32_from_usize(value.page_index, "search page index")?,
        spread_index: u32_from_usize(value.spread_index, "search spread index")?,
        start: reader_text_position(value.match_range.start)?,
        end: reader_text_position(value.match_range.end)?,
        context: value.match_range.context,
        locator,
    })
}

fn reader_text_position(
    value: crate::runtime::SearchTextPosition,
) -> Result<ReaderTextPosition, ReaderError> {
    Ok(ReaderTextPosition {
        block_index: u32_from_usize(value.block_index, "text position block index")?,
        line_index: u32_from_usize(value.line_index, "text position line index")?,
        run_index: u32_from_usize(value.run_index, "text position run index")?,
        char_index: u32_from_usize(value.char_index, "text position char index")?,
    })
}

/// The pages a search over this revision covers: its whole page table.
fn searched_page_count(revision: &RuntimeRevision) -> Result<u32, ReaderError> {
    u32_from_usize(revision.extent.page_count, "searched page count")
}
