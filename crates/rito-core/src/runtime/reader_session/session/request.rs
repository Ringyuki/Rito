//! Foreground navigation requests: a fresh artifact for a locator, the
//! adjacent spread relative to a live artifact, and the read-only peek of an
//! adjacent spread. Each foreground request replaces the pending candidate,
//! and a failed adjacent turn may stay retained so an identical request can
//! resume it.

use crate::layout::LayoutConfig;

use super::{
    errors::{missing_artifact_revision, unknown_artifact, validate_external_request_id},
    layout_config,
    project::{publication_navigation, reader_navigation},
    runtime_locator, ReaderAdjacentAvailability, ReaderAdjacentDirection, ReaderAdjacentRequest,
    ReaderArtifact, ReaderArtifactOwner, ReaderArtifactRequest, ReaderError, ReaderErrorKind,
    ReaderForegroundCandidate, ReaderPendingAdjacent, ReaderRevisionBacking, ReaderSession,
    ReaderTextRenderingProfile,
};

impl ReaderSession {
    pub fn request_artifact(
        &mut self,
        request: ReaderArtifactRequest,
    ) -> Result<ReaderArtifact, ReaderError> {
        self.validate_request_identity(request.session_id, request.request_id, "artifact")?;
        if request.text_profile != ReaderTextRenderingProfile::PlatformStringRuns {
            return Err(ReaderError::new(
                ReaderErrorKind::UnsupportedTextProfile,
                "positioned glyph output is not available in the reader protocol yet",
            ));
        }
        self.require_artifact_capacity()?;

        let render_ratio = request.layout.render_ratio;
        let layout = layout_config(request.layout)?;
        self.render_ratio = render_ratio;
        let locator = runtime_locator(request.locator)?;
        let expected_visible_artifact_id = self.begin_foreground_request(request.request_id);
        self.release_pending_adjacent()?;
        let artifact = self.create_revision_artifact_with_locator_fallback(
            request.request_id,
            layout.clone(),
            locator,
        )?;
        self.install_foreground_candidate(
            request.request_id,
            expected_visible_artifact_id,
            &artifact,
            layout,
        );
        Ok(artifact)
    }

    pub fn request_adjacent(
        &mut self,
        request: ReaderAdjacentRequest,
    ) -> Result<ReaderArtifact, ReaderError> {
        self.validate_request_identity(request.session_id, request.request_id, "adjacent")?;
        validate_external_request_id(request.from_artifact_id, "fromArtifactId")?;
        self.require_artifact_capacity()?;

        let source = self
            .artifacts
            .get(&request.from_artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(request.from_artifact_id))?;
        let layout = match source.backing {
            ReaderRevisionBacking::ChapterLocal => self
                .revisions
                .get(&source.revision_id)
                .map(|revision| revision.layout.clone())
                .ok_or_else(|| missing_artifact_revision(ReaderRevisionBacking::ChapterLocal))?,
            ReaderRevisionBacking::Publication => self
                .publication_revisions
                .get(&source.revision_id)
                .map(|revision| revision.layout.clone())
                .ok_or_else(|| missing_artifact_revision(ReaderRevisionBacking::Publication))?,
        };

        let initial_availability = self.adjacent_availability(&source, request.direction)?;
        let resumes_pending = self
            .pending_adjacent
            .as_ref()
            .is_some_and(|pending| pending.matches(&request));
        let expected_visible_artifact_id = self.begin_foreground_request(request.request_id);
        if !resumes_pending {
            self.release_pending_adjacent()?;
        }
        let result = match source.backing {
            ReaderRevisionBacking::ChapterLocal => match request.direction {
                ReaderAdjacentDirection::Previous if source.local_spread_index > 0 => self
                    .publish_revision_artifact(
                        source.revision_id,
                        source.local_spread_index - 1,
                        request.request_id,
                    ),
                ReaderAdjacentDirection::Previous => self.request_chapter_boundary(
                    source.revision_id,
                    ReaderAdjacentDirection::Previous,
                    request.request_id,
                ),
                ReaderAdjacentDirection::Next => {
                    self.request_next(source.clone(), request.request_id)
                }
            },
            ReaderRevisionBacking::Publication => self.request_publication_adjacent(
                source.clone(),
                request.request_id,
                request.direction,
            ),
        };
        match result {
            Ok(artifact) => {
                self.pending_adjacent = None;
                self.install_foreground_candidate(
                    request.request_id,
                    expected_visible_artifact_id,
                    &artifact,
                    layout,
                );
                Ok(artifact)
            }
            Err(error) if error.kind == ReaderErrorKind::TargetNotPublished => {
                if self.adjacent_can_resume(&source, request.direction, initial_availability)? {
                    self.pending_adjacent = Some(ReaderPendingAdjacent {
                        from_artifact_id: request.from_artifact_id,
                        direction: request.direction,
                    });
                } else {
                    self.pending_adjacent = None;
                }
                Err(error)
            }
            Err(error) => {
                self.pending_adjacent = None;
                Err(error)
            }
        }
    }

    /// Publishes the adjacent spread as a read-only artifact when its
    /// layout already exists, without any foreground side effect.
    ///
    /// Unlike [`Self::request_adjacent`] this never begins a foreground
    /// intent, never installs a candidate, and never touches a retained
    /// adjacent continuation — the visible artifact and
    /// every in-flight navigation stay exactly as they were. A neighbor
    /// in another chapter is paginated on demand (next peeks the
    /// following chapter's first spread, previous the preceding
    /// chapter's last); pagination is shared revision state, not
    /// foreground state. The publication's terminal boundary returns
    /// `TargetNotPublished`, which hosts surface as "not peekable". The
    /// artifact still occupies one live-artifact slot and must be
    /// released by the caller.
    pub fn peek_adjacent(
        &mut self,
        request: ReaderAdjacentRequest,
    ) -> Result<ReaderArtifact, ReaderError> {
        self.validate_request_identity(request.session_id, request.request_id, "peek")?;
        validate_external_request_id(request.from_artifact_id, "fromArtifactId")?;
        self.require_artifact_capacity()?;
        let source = self
            .artifacts
            .get(&request.from_artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(request.from_artifact_id))?;
        // The request ID is consumed exactly like every other reader
        // request, but deliberately NOT via begin_foreground_request —
        // peeking must not clear a pending foreground candidate.
        self.latest_request_id = request.request_id;
        let artifact = match source.backing {
            ReaderRevisionBacking::ChapterLocal => {
                self.peek_chapter_local_adjacent(source, request)?
            }
            // Publication turns already resolve their neighbor with no
            // foreground effect, so peeking reuses that path verbatim.
            ReaderRevisionBacking::Publication => {
                self.request_publication_adjacent(source, request.request_id, request.direction)?
            }
        };
        self.peeked_artifacts.insert(artifact.artifact_id);
        Ok(artifact)
    }

    fn peek_chapter_local_adjacent(
        &mut self,
        source: ReaderArtifactOwner,
        request: ReaderAdjacentRequest,
    ) -> Result<ReaderArtifact, ReaderError> {
        if !self.revisions.contains_key(&source.revision_id) {
            return Err(missing_artifact_revision(
                ReaderRevisionBacking::ChapterLocal,
            ));
        }
        // Reuses the foreground navigation helpers wholesale: adjacent
        // chapter creation is shared pagination progress.
        match request.direction {
            ReaderAdjacentDirection::Previous if source.local_spread_index > 0 => self
                .publish_revision_artifact(
                    source.revision_id,
                    source.local_spread_index - 1,
                    request.request_id,
                ),
            ReaderAdjacentDirection::Previous => self.request_chapter_boundary(
                source.revision_id,
                ReaderAdjacentDirection::Previous,
                request.request_id,
            ),
            ReaderAdjacentDirection::Next => self.request_next(source, request.request_id),
        }
    }

    fn begin_foreground_request(&mut self, request_id: u64) -> Option<u64> {
        let expected_visible_artifact_id = self
            .visible_intent
            .as_ref()
            .map(|intent| intent.visible_artifact_id);
        self.latest_request_id = request_id;
        self.foreground_candidate = None;
        expected_visible_artifact_id
    }

    fn adjacent_availability(
        &self,
        source: &ReaderArtifactOwner,
        direction: ReaderAdjacentDirection,
    ) -> Result<ReaderAdjacentAvailability, ReaderError> {
        let navigation = match source.backing {
            ReaderRevisionBacking::ChapterLocal => {
                let revision = self.revisions.get(&source.revision_id).ok_or_else(|| {
                    missing_artifact_revision(ReaderRevisionBacking::ChapterLocal)
                })?;
                reader_navigation(&self.document, revision, source.local_spread_index)
            }
            ReaderRevisionBacking::Publication => {
                let revision = self
                    .publication_revisions
                    .get(&source.revision_id)
                    .ok_or_else(|| missing_artifact_revision(ReaderRevisionBacking::Publication))?;
                publication_navigation(revision, source.local_spread_index)
            }
        };
        Ok(match direction {
            ReaderAdjacentDirection::Previous => navigation.previous,
            ReaderAdjacentDirection::Next => navigation.next,
        })
    }

    fn adjacent_can_resume(
        &self,
        source: &ReaderArtifactOwner,
        direction: ReaderAdjacentDirection,
        initial_availability: ReaderAdjacentAvailability,
    ) -> Result<bool, ReaderError> {
        let current = self.adjacent_availability(source, direction)?;
        Ok(match current {
            ReaderAdjacentAvailability::ChapterBoundary => {
                initial_availability != ReaderAdjacentAvailability::ChapterBoundary
            }
            ReaderAdjacentAvailability::Available | ReaderAdjacentAvailability::Terminal => false,
        })
    }

    fn install_foreground_candidate(
        &mut self,
        accepted_request_id: u64,
        expected_visible_artifact_id: Option<u64>,
        artifact: &ReaderArtifact,
        layout: LayoutConfig,
    ) {
        self.foreground_candidate = Some(ReaderForegroundCandidate {
            accepted_request_id,
            expected_visible_artifact_id,
            candidate_artifact_id: artifact.artifact_id,
            revision_id: artifact.revision_id,
            locator: artifact.locator.clone(),
            layout,
        });
    }

    pub(super) fn release_pending_adjacent(&mut self) -> Result<(), ReaderError> {
        let Some(pending) = self.pending_adjacent.take() else {
            return Ok(());
        };
        let _ = pending;
        Ok(())
    }
}
