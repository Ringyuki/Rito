//! Commits that swap the visible artifact: adopting the pending foreground
//! candidate, committing a peeked artifact, and adopting a background
//! publication candidate. Each checks the caller's expected visible artifact
//! against the current visible intent before it writes.

use super::{
    errors::{
        background_yields_to_foreground, missing_artifact_revision, stale_background_intent,
        stale_foreground_candidate, stale_foreground_intent, unknown_artifact,
        validate_external_request_id,
    },
    runtime_locator, ReaderArtifactOwner, ReaderBackgroundHandoff, ReaderBackgroundHandoffAck,
    ReaderError, ReaderErrorKind, ReaderForegroundCandidate, ReaderForegroundHandoff,
    ReaderForegroundHandoffAck, ReaderRevisionBacking, ReaderSession, ReaderVisibleIntent,
    READER_EXTERNAL_ID_MAX,
};

impl ReaderSession {
    /// Commits a previously peeked artifact as the visible foreground
    /// with a visible-artifact CAS and zero layout work.
    ///
    /// Only artifacts produced by [`Self::peek_adjacent`] qualify. A
    /// successful commit supersedes any in-flight foreground intent
    /// (candidate, pending exact seek, pending adjacent), exactly as a
    /// fresh foreground navigation would.
    pub fn commit_peeked_artifact(
        &mut self,
        request: ReaderForegroundHandoff,
    ) -> Result<ReaderForegroundHandoffAck, ReaderError> {
        self.validate_foreground_handoff_request(request)?;
        if !self
            .peeked_artifacts
            .contains(&request.candidate_artifact_id)
        {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidRequest,
                "commit candidate was not produced by peek",
            ));
        }
        let current_visible_artifact_id = self
            .visible_intent
            .as_ref()
            .map(|intent| intent.visible_artifact_id);
        if current_visible_artifact_id != request.expected_visible_artifact_id {
            return Err(stale_foreground_intent(
                request.expected_visible_artifact_id,
                current_visible_artifact_id,
            ));
        }
        let owner = self
            .artifacts
            .get(&request.candidate_artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(request.candidate_artifact_id))?;
        let layout = match owner.backing {
            ReaderRevisionBacking::ChapterLocal => self
                .revisions
                .get(&owner.revision_id)
                .map(|revision| revision.layout.clone()),
            ReaderRevisionBacking::Publication => self
                .publication_revisions
                .get(&owner.revision_id)
                .map(|revision| revision.layout.clone()),
        }
        .ok_or_else(|| missing_artifact_revision(owner.backing))?;
        let locator = runtime_locator(owner.locator.clone())?;
        self.foreground_candidate = None;
        self.release_pending_adjacent()?;
        self.visible_intent = Some(ReaderVisibleIntent {
            accepted_request_id: owner.request_id,
            visible_artifact_id: request.candidate_artifact_id,
            locator,
            layout,
            pending_handoff_artifact_id: None,
        });
        self.peeked_artifacts.remove(&request.candidate_artifact_id);
        Ok(ReaderForegroundHandoffAck {
            intent_request_id: owner.request_id,
            replaced_artifact_id: current_visible_artifact_id,
            visible_artifact_id: request.candidate_artifact_id,
        })
    }

    /// Atomically commits one live foreground candidate as the visible
    /// artifact. A candidate never becomes visible merely because its request
    /// completed.
    pub fn adopt_foreground_candidate(
        &mut self,
        request: ReaderForegroundHandoff,
    ) -> Result<ReaderForegroundHandoffAck, ReaderError> {
        self.validate_foreground_handoff_request(request)?;
        let current_visible_artifact_id = self
            .visible_intent
            .as_ref()
            .map(|intent| intent.visible_artifact_id);
        if current_visible_artifact_id != request.expected_visible_artifact_id {
            return Err(stale_foreground_intent(
                request.expected_visible_artifact_id,
                current_visible_artifact_id,
            ));
        }
        if current_visible_artifact_id
            .is_some_and(|artifact_id| !self.artifacts.contains_key(&artifact_id))
        {
            return Err(ReaderError::new(
                ReaderErrorKind::EngineFailure,
                "visible foreground artifact ownership is missing",
            ));
        }
        let artifact = self
            .artifacts
            .get(&request.candidate_artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(request.candidate_artifact_id))?;
        let candidate = self
            .foreground_candidate
            .clone()
            .ok_or_else(|| stale_foreground_candidate("no foreground candidate is pending"))?;
        self.validate_foreground_candidate(&request, &candidate, &artifact)?;
        let locator = runtime_locator(candidate.locator.clone())?;
        self.visible_intent = Some(ReaderVisibleIntent {
            accepted_request_id: candidate.accepted_request_id,
            visible_artifact_id: candidate.candidate_artifact_id,
            locator,
            layout: candidate.layout,
            pending_handoff_artifact_id: None,
        });
        self.foreground_candidate = None;
        Ok(ReaderForegroundHandoffAck {
            intent_request_id: candidate.accepted_request_id,
            replaced_artifact_id: current_visible_artifact_id,
            visible_artifact_id: candidate.candidate_artifact_id,
        })
    }

    pub fn adopt_background_candidate(
        &mut self,
        request: ReaderBackgroundHandoff,
    ) -> Result<ReaderBackgroundHandoffAck, ReaderError> {
        if request.session_id == 0
            || request.session_id > READER_EXTERNAL_ID_MAX
            || request.session_id != self.session_id
        {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidSession,
                "background handoff belongs to a different or invalid session",
            ));
        }
        validate_external_request_id(
            request.expected_visible_artifact_id,
            "expectedVisibleArtifactId",
        )?;
        validate_external_request_id(request.candidate_artifact_id, "candidateArtifactId")?;
        if self.foreground_candidate.is_some() || self.pending_adjacent.is_some() {
            return Err(background_yields_to_foreground());
        }
        let intent = self.visible_intent.as_mut().ok_or_else(|| {
            ReaderError::new(
                ReaderErrorKind::InvalidRequest,
                "background handoff requires a visible reader intent",
            )
        })?;
        if intent.visible_artifact_id != request.expected_visible_artifact_id
            || !self
                .artifacts
                .contains_key(&request.expected_visible_artifact_id)
        {
            return Err(stale_background_intent(
                request.expected_visible_artifact_id,
                intent.visible_artifact_id,
            ));
        }
        if intent.pending_handoff_artifact_id != Some(request.candidate_artifact_id) {
            return Err(ReaderError::new(
                ReaderErrorKind::StaleRequest,
                "background candidate is not pending for the visible intent",
            ));
        }
        let candidate = self
            .artifacts
            .get(&request.candidate_artifact_id)
            .ok_or_else(|| unknown_artifact(request.candidate_artifact_id))?;
        if candidate.backing != ReaderRevisionBacking::Publication
            || self.active_publication_revision_id != Some(candidate.revision_id)
        {
            return Err(ReaderError::new(
                ReaderErrorKind::StaleRequest,
                "background candidate no longer belongs to the active publication revision",
            ));
        }
        intent.visible_artifact_id = request.candidate_artifact_id;
        intent.pending_handoff_artifact_id = None;
        let ack = ReaderBackgroundHandoffAck {
            intent_request_id: intent.accepted_request_id,
            replaced_artifact_id: request.expected_visible_artifact_id,
            visible_artifact_id: request.candidate_artifact_id,
        };
        self.foreground_candidate = None;
        Ok(ack)
    }

    fn validate_foreground_handoff_request(
        &self,
        request: ReaderForegroundHandoff,
    ) -> Result<(), ReaderError> {
        if request.session_id == 0
            || request.session_id > READER_EXTERNAL_ID_MAX
            || request.session_id != self.session_id
        {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidSession,
                "foreground handoff belongs to a different or invalid session",
            ));
        }
        if let Some(artifact_id) = request.expected_visible_artifact_id {
            validate_external_request_id(artifact_id, "expectedVisibleArtifactId")?;
        }
        validate_external_request_id(request.candidate_artifact_id, "candidateArtifactId")
    }

    fn validate_foreground_candidate(
        &self,
        request: &ReaderForegroundHandoff,
        candidate: &ReaderForegroundCandidate,
        artifact: &ReaderArtifactOwner,
    ) -> Result<(), ReaderError> {
        if candidate.candidate_artifact_id != request.candidate_artifact_id
            || candidate.expected_visible_artifact_id != request.expected_visible_artifact_id
            || candidate.accepted_request_id != self.latest_request_id
            || artifact.request_id != candidate.accepted_request_id
            || artifact.revision_id != candidate.revision_id
            || artifact.locator != candidate.locator
        {
            return Err(stale_foreground_candidate(
                "foreground candidate no longer matches the latest request intent",
            ));
        }
        let actual_layout = match artifact.backing {
            ReaderRevisionBacking::ChapterLocal => self
                .revisions
                .get(&artifact.revision_id)
                .map(|revision| &revision.layout),
            ReaderRevisionBacking::Publication => self
                .publication_revisions
                .get(&artifact.revision_id)
                .map(|revision| &revision.layout),
        }
        .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
        if actual_layout != &candidate.layout {
            return Err(stale_foreground_candidate(
                "foreground candidate layout no longer matches its live revision",
            ));
        }
        Ok(())
    }
}
