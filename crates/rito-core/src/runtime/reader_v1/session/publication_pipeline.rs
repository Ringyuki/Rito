//! The host-driven background step: one footnote-index quantum per call
//! until the index is complete, then the publication revision for the
//! visible layout is selected or created (it paginates whole in that one
//! call) and the publication candidate the host may adopt in place of the
//! visible artifact is minted from it.

use crate::{
    layout::LayoutConfig,
    runtime::{RuntimeBoundedRevisionRequest, RuntimeSourceLocatorResolution},
};

use super::{
    errors::{
        background_yields_to_foreground, engine_error, missing_artifact_revision,
        stale_background_intent, take_identity, validate_external_request_id,
    },
    project::painted_digest,
    ReaderArtifactV1, ReaderBackgroundAdvanceV1, ReaderBackgroundRequestV1,
    ReaderBackgroundStateV1, ReaderErrorKindV1, ReaderErrorV1, ReaderPublicationRevisionOwnerV1,
    ReaderRevisionBackingV1, ReaderSessionV1, ReaderVisibleIntentV1, READER_EXTERNAL_ID_MAX_V1,
};

impl ReaderSessionV1 {
    /// Runs at most one publication-wide index or layout quantum for the
    /// current visible intent. Index completion gates publication layout so a
    /// background handoff never bakes a provisional footnote classification
    /// into its pages. Scheduling remains entirely host-owned.
    pub fn advance_background_once(
        &mut self,
        request: ReaderBackgroundRequestV1,
    ) -> Result<ReaderBackgroundAdvanceV1, ReaderErrorV1> {
        self.validate_background_request(request)?;
        let intent = self.visible_intent.clone().ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
                "background work requires a visible reader intent",
            )
        })?;
        if self.foreground_candidate.is_some() || self.pending_adjacent.is_some() {
            return Err(background_yields_to_foreground());
        }
        if intent.visible_artifact_id != request.expected_visible_artifact_id
            || !self.artifacts.contains_key(&intent.visible_artifact_id)
        {
            return Err(stale_background_intent(
                request.expected_visible_artifact_id,
                intent.visible_artifact_id,
            ));
        }
        self.select_publication_layout(&intent.layout)?;
        let needs_handoff =
            self.artifacts
                .get(&intent.visible_artifact_id)
                .is_none_or(|artifact| {
                    artifact.backing != ReaderRevisionBackingV1::Publication
                        || self.active_publication_revision_id != Some(artifact.revision_id)
                });
        if needs_handoff
            && intent
                .pending_handoff_artifact_id
                .is_some_and(|artifact_id| self.artifacts.contains_key(&artifact_id))
        {
            return Ok(background_result(
                ReaderBackgroundStateV1::CandidatePending,
                &intent,
                None,
            ));
        }
        if needs_handoff {
            self.require_artifact_capacity()?;
        }

        if !self.document.publication_footnote_index_is_complete() {
            self.document
                .advance_publication_footnote_index_once()
                .map_err(engine_error)?;
            return Ok(background_result(
                ReaderBackgroundStateV1::Indexing,
                &intent,
                None,
            ));
        }

        if needs_handoff {
            if let Some(revision_id) = self.active_publication_revision_id {
                if let Some(artifact) = self.try_publication_candidate(revision_id, &intent)? {
                    let moves =
                        self.handoff_moves_visible_content(intent.visible_artifact_id, &artifact);
                    return Ok(background_result_with_move(
                        ReaderBackgroundStateV1::Reused,
                        &intent,
                        Some(artifact),
                        moves,
                    ));
                }
            }
        }

        if self.active_publication_revision_id.is_some() {
            // The publication paginated whole when it was created and
            // every candidate minted from it already carries the book
            // page count; nothing is left to offer.
            return Ok(background_result(
                ReaderBackgroundStateV1::Complete,
                &intent,
                None,
            ));
        }
        let revision_id = self.start_publication_once(intent.layout.clone())?;
        let artifact = if needs_handoff {
            self.try_publication_candidate(revision_id, &intent)?
        } else {
            None
        };
        let moves = artifact.as_ref().is_some_and(|candidate| {
            self.handoff_moves_visible_content(intent.visible_artifact_id, candidate)
        });
        Ok(background_result_with_move(
            ReaderBackgroundStateV1::Started,
            &intent,
            artifact,
            moves,
        ))
    }

    fn validate_background_request(
        &self,
        request: ReaderBackgroundRequestV1,
    ) -> Result<(), ReaderErrorV1> {
        if request.session_id == 0
            || request.session_id > READER_EXTERNAL_ID_MAX_V1
            || request.session_id != self.session_id
        {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidSession,
                "background request belongs to a different or invalid session",
            ));
        }
        validate_external_request_id(
            request.expected_visible_artifact_id,
            "expectedVisibleArtifactId",
        )?;
        if request.max_top_level_nodes_per_quantum == 0 {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
                "background top-level work budget must be non-zero",
            ));
        }
        Ok(())
    }

    fn select_publication_layout(&mut self, layout: &LayoutConfig) -> Result<(), ReaderErrorV1> {
        if let Some(revision_id) = self.active_publication_revision_id {
            let revision = self
                .publication_revisions
                .get(&revision_id)
                .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
            if revision.layout == *layout {
                return Ok(());
            }
            let retire = revision.artifact_ref_count == 0;
            self.active_publication_revision_id = None;
            if retire {
                self.retire_publication_revision(revision_id)?;
            }
        }
        self.active_publication_revision_id =
            self.publication_revisions
                .iter()
                .rev()
                .find_map(|(revision_id, revision)| {
                    (revision.layout == *layout).then_some(*revision_id)
                });
        Ok(())
    }

    fn start_publication_once(&mut self, layout: LayoutConfig) -> Result<u64, ReaderErrorV1> {
        let summary = self
            .document
            .create_bounded_revision(RuntimeBoundedRevisionRequest {
                layout_config: layout.clone(),
            })
            .map_err(engine_error)?;
        let reader_revision_id = match take_identity(&mut self.next_revision_id, "revisionId") {
            Ok(value) => value,
            Err(error) => {
                let _ = self.document.release_revision(&summary.revision_id);
                return Err(error);
            }
        };
        self.publication_revisions.insert(
            reader_revision_id,
            ReaderPublicationRevisionOwnerV1::from_summary(&summary, layout),
        );
        self.active_publication_revision_id = Some(reader_revision_id);
        Ok(reader_revision_id)
    }

    /// Mints the publication artifact that stands in for what the
    /// reader is currently looking at.
    ///
    /// The artifact's locator is derived from the page it actually
    /// publishes — never echoed from the request — because a candidate
    /// whose locator does not describe its own display list is
    /// indistinguishable from a pure renumbering, and a host gating on
    /// "same locator, safe to adopt" would swap the reader onto another
    /// page without any way to see it happen.
    fn try_publication_candidate(
        &mut self,
        revision_id: u64,
        intent: &ReaderVisibleIntentV1,
    ) -> Result<Option<ReaderArtifactV1>, ReaderErrorV1> {
        let owner = self
            .publication_revisions
            .get(&revision_id)
            .map(|revision| revision.owner.clone())
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
        let resolved = self
            .document
            .resolve_source_locator_at(&owner, intent.locator.clone())
            .map_err(engine_error)?
            .value;
        let RuntimeSourceLocatorResolution::Resolved {
            locator,
            spread_index,
            ..
        } = resolved
        else {
            return Ok(None);
        };
        if locator != intent.locator {
            return Ok(None);
        }
        if !self.visible_intent_matches(intent) {
            return Err(stale_background_intent(
                intent.visible_artifact_id,
                self.visible_intent
                    .as_ref()
                    .map_or(0, |current| current.visible_artifact_id),
            ));
        }
        // Publishing through the ordinary path is what makes the
        // locator honest: it reads the anchor back off the published
        // page and refuses a page whose anchor resolves elsewhere. A
        // spread that cannot publish is simply not offered.
        let artifact = match self.publish_publication_artifact(
            revision_id,
            spread_index,
            intent.accepted_request_id,
        ) {
            Ok(artifact) => artifact,
            Err(error) if error.kind == ReaderErrorKindV1::TargetNotPublished => {
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        if let Some(current) = self.visible_intent.as_mut() {
            current.pending_handoff_artifact_id = Some(artifact.artifact_id);
        }
        Ok(Some(artifact))
    }

    /// Whether adopting `candidate` would put different content on
    /// screen than `visible_artifact_id` is showing.
    ///
    /// Answered by comparing what each artifact draws, not their
    /// locators: the same page anchored chapter-locally and
    /// book-globally carries different progressions, so locators would
    /// report a move on every first handoff.
    fn handoff_moves_visible_content(
        &self,
        visible_artifact_id: u64,
        candidate: &ReaderArtifactV1,
    ) -> bool {
        self.artifacts
            .get(&visible_artifact_id)
            .is_none_or(|visible| visible.painted_digest != painted_digest(candidate))
    }

    fn visible_intent_matches(&self, expected: &ReaderVisibleIntentV1) -> bool {
        self.visible_intent.as_ref().is_some_and(|current| {
            current.accepted_request_id == expected.accepted_request_id
                && current.visible_artifact_id == expected.visible_artifact_id
                && current.locator == expected.locator
                && current.layout == expected.layout
        })
    }
}

fn background_result(
    state: ReaderBackgroundStateV1,
    intent: &ReaderVisibleIntentV1,
    artifact: Option<ReaderArtifactV1>,
) -> ReaderBackgroundAdvanceV1 {
    background_result_with_move(state, intent, artifact, false)
}

fn background_result_with_move(
    state: ReaderBackgroundStateV1,
    intent: &ReaderVisibleIntentV1,
    artifact: Option<ReaderArtifactV1>,
    moves_visible_content: bool,
) -> ReaderBackgroundAdvanceV1 {
    ReaderBackgroundAdvanceV1 {
        state,
        intent_request_id: intent.accepted_request_id,
        replaces_artifact_id: intent.visible_artifact_id,
        moves_visible_content: artifact.is_some() && moves_visible_content,
        artifact,
    }
}
