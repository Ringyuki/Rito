//! Session lifetime: opening a session from publication bytes, the session id
//! and publication accessors, releasing an artifact together with the revision
//! ownership it held, and disposing the whole session.

use std::collections::{BTreeMap, BTreeSet};

use crate::runtime::RuntimeDocument;

use super::{
    build_reader_publication,
    errors::{engine_error, unknown_artifact, validate_external_request_id, validate_session_id},
    ReaderDisposeAck, ReaderError, ReaderErrorKind, ReaderPublication, ReaderRevisionBacking,
    ReaderSession,
};

impl ReaderSession {
    pub fn open_owned(session_id: u64, publication_bytes: Vec<u8>) -> Result<Self, ReaderError> {
        validate_session_id(session_id)?;
        let document = RuntimeDocument::open_owned(publication_bytes).map_err(engine_error)?;
        Self::from_document(session_id, document)
    }

    /// Opens a reader whose host pins measurement fallback faces. A non-empty
    /// policy is what turns on the required-font-face catalog: without it the
    /// runtime never declares publication faces, so embedded EPUB fonts can
    /// neither be measured with real bytes nor surface in `artifact.fonts`.
    pub fn open_owned_with_pinned_font_policy(
        session_id: u64,
        publication_bytes: Vec<u8>,
        policy: crate::runtime::RuntimePinnedFontPolicyInput,
    ) -> Result<Self, ReaderError> {
        validate_session_id(session_id)?;
        let document =
            RuntimeDocument::open_owned_with_pinned_font_policy(publication_bytes, policy)
                .map_err(engine_error)?;
        Self::from_document(session_id, document)
    }

    fn from_document(session_id: u64, document: RuntimeDocument) -> Result<Self, ReaderError> {
        let publication = build_reader_publication(session_id, &document)?;
        Ok(Self {
            session_id,
            document,
            publication,
            latest_request_id: 0,
            next_revision_id: 1,
            next_artifact_id: 1,
            revisions: BTreeMap::new(),
            publication_revisions: BTreeMap::new(),
            active_publication_revision_id: None,
            artifacts: BTreeMap::new(),
            released_artifacts: BTreeSet::new(),
            peeked_artifacts: BTreeSet::new(),
            visible_intent: None,
            foreground_candidate: None,
            pending_adjacent: None,
            render_ratio: 1.0,
            #[cfg(test)]
            exact_cache_hit_count: 0,
            #[cfg(test)]
            exact_layout_quantum_count: 0,
        })
    }

    pub const fn session_id(&self) -> u64 {
        self.session_id
    }

    pub const fn publication(&self) -> &ReaderPublication {
        &self.publication
    }

    /// True only while a newer adjacent request with the same source and
    /// direction can resume retained foreground work.
    pub const fn has_pending_adjacent(&self) -> bool {
        self.pending_adjacent.is_some()
    }

    pub fn release_artifact(&mut self, artifact_id: u64) -> Result<bool, ReaderError> {
        validate_external_request_id(artifact_id, "artifactId")?;
        if self.released_artifacts.contains(&artifact_id) {
            return Ok(false);
        }
        if self
            .pending_adjacent
            .as_ref()
            .is_some_and(|pending| pending.from_artifact_id == artifact_id)
        {
            self.release_pending_adjacent()?;
        }
        let releases_visible = self
            .visible_intent
            .as_ref()
            .is_some_and(|intent| intent.visible_artifact_id == artifact_id);
        let releases_foreground_candidate = self
            .foreground_candidate
            .as_ref()
            .is_some_and(|candidate| candidate.candidate_artifact_id == artifact_id);
        let artifact = self
            .artifacts
            .get(&artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(artifact_id))?;
        match artifact.backing {
            ReaderRevisionBacking::ChapterLocal => {
                self.release_chapter_local_artifact_owner(&artifact)?;
            }
            ReaderRevisionBacking::Publication => {
                self.release_publication_artifact_owner(&artifact)?;
            }
        }
        self.artifacts.remove(&artifact_id);
        self.released_artifacts.insert(artifact_id);
        self.peeked_artifacts.remove(&artifact_id);
        if releases_foreground_candidate {
            self.foreground_candidate = None;
        }
        if releases_visible {
            self.visible_intent = None;
            self.foreground_candidate = None;
        } else if self
            .visible_intent
            .as_ref()
            .is_some_and(|intent| intent.pending_handoff_artifact_id == Some(artifact_id))
        {
            if let Some(intent) = self.visible_intent.as_mut() {
                intent.pending_handoff_artifact_id = None;
            }
        }
        Ok(true)
    }

    pub fn dispose(mut self) -> Result<ReaderDisposeAck, ReaderError> {
        let released_artifacts = self.dispose_owned_state()?;
        Ok(ReaderDisposeAck {
            session_id: self.session_id,
            released_artifacts,
        })
    }

    fn dispose_owned_state(&mut self) -> Result<u32, ReaderError> {
        self.release_pending_adjacent()?;
        let artifact_ids = self.artifacts.keys().copied().collect::<Vec<_>>();
        let mut released_artifacts = 0u32;
        for artifact_id in artifact_ids {
            if self.release_artifact(artifact_id)? {
                released_artifacts = released_artifacts.checked_add(1).ok_or_else(|| {
                    ReaderError::new(
                        ReaderErrorKind::NumericOverflow,
                        "released artifact count overflow",
                    )
                })?;
            }
        }
        let revision_ids = self.revisions.keys().copied().collect::<Vec<_>>();
        for revision_id in revision_ids {
            self.retire_reader_revision(revision_id)?;
        }
        self.active_publication_revision_id = None;
        let publication_revision_ids = self
            .publication_revisions
            .keys()
            .copied()
            .collect::<Vec<_>>();
        for revision_id in publication_revision_ids {
            self.retire_publication_revision(revision_id)?;
        }
        self.visible_intent = None;
        self.foreground_candidate = None;
        Ok(released_artifacts)
    }

    pub fn live_artifact_count(&self) -> u32 {
        u32::try_from(self.artifacts.len()).unwrap_or(u32::MAX)
    }
}
