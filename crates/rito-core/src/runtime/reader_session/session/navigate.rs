//! Resolving where a navigation lands: the next or previous spread within a
//! chapter-local or publication revision, the neighbouring linear chapter at
//! a chapter boundary, and a fresh chapter-local revision for a locator,
//! including the fallback from a selector that no longer resolves down to the
//! locator's coarser keys.

use crate::{
    layout::LayoutConfig,
    runtime::{
        ReaderLocatorMatch, RuntimeChapterLocalRevisionRequest, RuntimeCreatedChapterLocalRevision,
        RuntimeSourceLocator,
    },
};

use super::{
    build_reader_artifact,
    errors::{
        engine_error, invalid_locator, missing_artifact_revision, numeric_overflow, take_identity,
        target_not_published,
    },
    project::{
        adjacent_linear_chapter, artifact_owner, owner_from_created, reader_navigation,
        resolved_target,
    },
    ArtifactIdentity, ReaderAdjacentDirection, ReaderArtifact, ReaderArtifactOwner, ReaderError,
    ReaderErrorKind, ReaderRevisionBacking, ReaderRevisionOwner, ReaderSession,
};

impl ReaderSession {
    pub(super) fn request_publication_adjacent(
        &mut self,
        source: ReaderArtifactOwner,
        request_id: u64,
        direction: ReaderAdjacentDirection,
    ) -> Result<ReaderArtifact, ReaderError> {
        let target_spread = match direction {
            ReaderAdjacentDirection::Previous => source
                .local_spread_index
                .checked_sub(1)
                .ok_or_else(|| target_not_published("publication boundary is terminal"))?,
            ReaderAdjacentDirection::Next => source
                .local_spread_index
                .checked_add(1)
                .ok_or_else(|| numeric_overflow("publication spread index"))?,
        };
        let revision = self
            .publication_revisions
            .get(&source.revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBacking::Publication))?;
        if target_spread >= revision.spread_count {
            return Err(target_not_published("publication boundary is terminal"));
        }
        self.publish_publication_artifact(source.revision_id, target_spread, request_id)
    }

    pub(super) fn request_next(
        &mut self,
        source: ReaderArtifactOwner,
        request_id: u64,
    ) -> Result<ReaderArtifact, ReaderError> {
        let target_spread = source
            .local_spread_index
            .checked_add(1)
            .ok_or_else(|| numeric_overflow("local spread index"))?;
        self.paginate_through_spread(source.revision_id, target_spread)?;
        let local_spread_count = self
            .revisions
            .get(&source.revision_id)
            .map(|revision| revision.local_spread_count)
            .ok_or_else(|| {
                ReaderError::new(
                    ReaderErrorKind::EngineFailure,
                    "artifact revision ownership is missing",
                )
            })?;
        if target_spread < local_spread_count {
            return self.publish_revision_artifact(source.revision_id, target_spread, request_id);
        }
        self.request_chapter_boundary(
            source.revision_id,
            ReaderAdjacentDirection::Next,
            request_id,
        )
    }

    pub(super) fn request_chapter_boundary(
        &mut self,
        revision_id: u64,
        direction: ReaderAdjacentDirection,
        request_id: u64,
    ) -> Result<ReaderArtifact, ReaderError> {
        let revision = self.revisions.get(&revision_id).ok_or_else(|| {
            ReaderError::new(
                ReaderErrorKind::EngineFailure,
                "artifact revision ownership is missing",
            )
        })?;
        let chapter_index = revision.owner.coordinate.chapter_index;
        let layout = revision.layout.clone();
        let target_chapter = adjacent_linear_chapter(&self.document, chapter_index, direction)
            .ok_or_else(|| target_not_published("publication boundary is terminal"))?;
        let href = self.document.document().chapters[target_chapter]
            .href
            .clone();
        self.create_revision_artifact(
            request_id,
            layout,
            RuntimeSourceLocator {
                href,
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: (direction == ReaderAdjacentDirection::Previous).then_some(1.0),
            },
        )
    }

    /// A request's locator is persisted host data: the book file may have
    /// changed since the position was saved, or the position may have
    /// been recorded against content that no longer lays out (a saved
    /// point on a broken-image placeholder's alt run carries the image's
    /// node path, which owns no text). A selector that fails to resolve
    /// degrades to the locator's coarser keys — progression, then the
    /// chapter itself — instead of refusing to open the book; the
    /// artifact's `matched_by` reports what actually resolved.
    ///
    /// An href that names no chapter of this book leaves nothing coarser
    /// within the book. Once the session has opened, the request fails and
    /// the reader stays where it is. The request a session opens on
    /// (`opening`) has no page to stay on: it opens at the book's start,
    /// matched by `BookStart`, so that the book opens and the host still
    /// learns that the position it gave was not found.
    pub(super) fn create_revision_artifact_with_locator_fallback(
        &mut self,
        request_id: u64,
        layout: LayoutConfig,
        locator: RuntimeSourceLocator,
        opening: bool,
    ) -> Result<ReaderArtifact, ReaderError> {
        let mut attempt = locator;
        loop {
            let error =
                match self.create_revision_artifact(request_id, layout.clone(), attempt.clone()) {
                    Ok(artifact) => return Ok(artifact),
                    Err(error) => error,
                };
            if error.kind != ReaderErrorKind::InvalidLocator {
                return Err(error);
            }
            if let Some(coarser) = coarser_locator(&attempt) {
                attempt = coarser;
                continue;
            }
            // The href alone failed: it names no chapter (an empty href is
            // the book's start and always resolves).
            if !opening || attempt.href.is_empty() {
                return Err(error);
            }
            return match self.create_revision_artifact(request_id, layout, book_start()) {
                Ok(mut artifact) => {
                    artifact.matched_by = ReaderLocatorMatch::BookStart;
                    Ok(artifact)
                }
                // A book with no chapter to start at: the href's own error says why.
                Err(start) if start.kind == ReaderErrorKind::InvalidLocator => Err(error),
                Err(start) => Err(start),
            };
        }
    }

    fn create_revision_artifact(
        &mut self,
        request_id: u64,
        layout: LayoutConfig,
        locator: RuntimeSourceLocator,
    ) -> Result<ReaderArtifact, ReaderError> {
        let (chapter_index, canonical_locator) = self
            .document
            .validate_source_locator_for_chapter_local(locator)
            .map_err(invalid_locator)?;
        if let Some((revision_id, target)) =
            self.find_cached_exact_target(chapter_index, &layout, &canonical_locator)?
        {
            let artifact =
                self.publish_resolved_revision_artifact(revision_id, target, request_id)?;
            #[cfg(test)]
            {
                self.exact_cache_hit_count += 1;
            }
            return Ok(artifact);
        }
        let created =
            self.start_exact_seek(chapter_index, layout.clone(), canonical_locator.clone())?;
        let created = self.require_resolved_target(created)?;
        let target = resolved_target(&created).ok_or_else(|| {
            ReaderError::new(
                ReaderErrorKind::EngineFailure,
                "resolved artifact target disappeared",
            )
        })?;
        let owner = owner_from_created(&created);
        let revision_id = match take_identity(&mut self.next_revision_id, "revisionId") {
            Ok(value) => value,
            Err(error) => {
                let _ = self
                    .document
                    .release_chapter_local_revision_immediately(&owner);
                return Err(error);
            }
        };
        let artifact_id = match take_identity(&mut self.next_artifact_id, "artifactId") {
            Ok(value) => value,
            Err(error) => {
                let _ = self
                    .document
                    .release_chapter_local_revision_immediately(&owner);
                return Err(error);
            }
        };
        let revision = ReaderRevisionOwner::from_created(&created, layout, self.font_generation, 1);
        let navigation = reader_navigation(&self.document, &revision, target.local_spread_index);
        let built = match build_reader_artifact(
            &mut self.document,
            ArtifactIdentity {
                session_id: self.session_id,
                request_id,
                revision_id,
                artifact_id,
            },
            &target,
            navigation,
            self.render_ratio,
        ) {
            Ok(built) => built,
            Err(error) => {
                let _ = self
                    .document
                    .release_chapter_local_revision_immediately(&owner);
                return Err(error);
            }
        };
        let artifact_owner = artifact_owner(
            revision_id,
            ReaderRevisionBacking::ChapterLocal,
            target.local_spread_index,
            &built.artifact,
            built.painted_digest,
        );
        self.revisions.insert(revision_id, revision);
        self.artifacts.insert(artifact_id, artifact_owner);
        Ok(built.artifact)
    }

    fn start_exact_seek(
        &mut self,
        chapter_index: usize,
        layout: LayoutConfig,
        canonical_locator: RuntimeSourceLocator,
    ) -> Result<RuntimeCreatedChapterLocalRevision, ReaderError> {
        #[cfg(test)]
        {
            self.exact_layout_quantum_count += 1;
        }
        let request = RuntimeChapterLocalRevisionRequest {
            layout_config: layout,
            target_chapter_index: chapter_index,
            target_locator: canonical_locator,
        };
        if self.whole_chapters {
            self.document.create_chapter_local_revision(request)
        } else {
            self.document.create_settled_chapter_local_revision(request)
        }
        .map_err(engine_error)
    }

    /// A chapter-local revision places its target among the whole
    /// chapter's pages at creation, so its target either resolved then or
    /// never will.
    fn require_resolved_target(
        &mut self,
        created: RuntimeCreatedChapterLocalRevision,
    ) -> Result<RuntimeCreatedChapterLocalRevision, ReaderError> {
        if resolved_target(&created).is_some() {
            return Ok(created);
        }
        self.document
            .release_chapter_local_revision_immediately(&owner_from_created(&created))
            .map_err(engine_error)?;
        Err(target_not_published(
            "exact locator cannot be published from the completed chapter-local revision",
        ))
    }
}

/// `locator` with its finest remaining selectors dropped: a source point,
/// range or anchor first, then the progression; `None` once only the href
/// is left.
fn coarser_locator(locator: &RuntimeSourceLocator) -> Option<RuntimeSourceLocator> {
    if locator.source_point.is_some()
        || locator.source_range.is_some()
        || locator.anchor_id.is_some()
    {
        return Some(RuntimeSourceLocator {
            source_point: None,
            source_range: None,
            anchor_id: None,
            ..locator.clone()
        });
    }
    locator.progression.is_some().then(|| RuntimeSourceLocator {
        progression: None,
        ..locator.clone()
    })
}

/// The book's start: the empty href, which resolves to its first linear chapter.
fn book_start() -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href: String::new(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    }
}
