use std::collections::{BTreeMap, BTreeSet, VecDeque};

use crate::{
    layout::{LayoutConfig, LineBreaking},
    runtime::{
        RuntimeBoundedChapterLocalRevisionRequest, RuntimeBoundedRevisionRequest,
        RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionCursor,
        RuntimeChapterLocalRevisionHandle, RuntimeChapterLocalSourceLocatorResolution,
        RuntimeContinueChapterLocalRevisionRequest, RuntimeContinueRevisionRequest,
        RuntimeDocument, RuntimePageReadingAnchor, RuntimeRevisionWorkBudget,
        RuntimeRolloverChapterLocalRevisionRequest, RuntimeSourceLocator,
        RuntimeSourceLocatorMatchedBy, RuntimeSourceLocatorResolution,
        RUNTIME_CHAPTER_LOCAL_PAGE_CAP_MAX,
    },
};

use super::{
    artifact::{
        build_reader_artifact_v1, published_spread_target, ArtifactIdentityV1,
        ResolvedArtifactOwnerV1, ResolvedArtifactTarget,
    },
    convert::{layout_config, runtime_locator, runtime_resource_kind, usize_from_u32},
    publication::{
        ReaderForegroundCandidateV1, ReaderPublicationRevisionOwnerV1, ReaderRevisionBackingV1,
        ReaderVisibleIntentV1,
    },
    publication_info::build_reader_publication_v1,
    reader_resource_bytes_max_v1, ReaderAdjacentAvailabilityV1, ReaderAdjacentDirectionV1,
    ReaderAdjacentRequestV1, ReaderArtifactRequestV1, ReaderArtifactV1, ReaderBackgroundAdvanceV1,
    ReaderBackgroundHandoffAckV1, ReaderBackgroundHandoffV1, ReaderBackgroundRequestV1,
    ReaderBackgroundStateV1, ReaderDisposeAckV1, ReaderErrorKindV1, ReaderErrorV1,
    ReaderForegroundHandoffAckV1, ReaderForegroundHandoffV1, ReaderLocatorV1, ReaderNavigationV1,
    ReaderPublicationV1, ReaderResourceKindV1, ReaderResourceV1, ReaderTextRenderingProfileV1,
    ReaderWorkBudgetV1, READER_EXTERNAL_ID_MAX_V1,
};

mod exact_cache;

pub const READER_LIVE_ARTIFACT_CAP_V1: u32 = 4;
const READER_RETAINED_WINDOW_CAP_V1: usize = 2;

#[derive(Debug, Clone)]
struct ReaderArtifactOwnerV1 {
    request_id: u64,
    revision_id: u64,
    backing: ReaderRevisionBackingV1,
    locator: ReaderLocatorV1,
    local_spread_index: usize,
    resources: Vec<(ReaderResourceKindV1, String)>,
}

#[derive(Debug)]
struct ReaderRevisionOwnerV1 {
    owner: RuntimeChapterLocalRevisionHandle,
    continuation: Option<RuntimeChapterLocalRevisionCursor>,
    layout: LayoutConfig,
    local_page_cap: u32,
    known_local_spread_count: usize,
    final_local_spread_count: Option<usize>,
    page_cap_reached: bool,
    artifact_ref_count: u32,
    previous_window_revision_id: Option<u64>,
    previous_window_evicted: bool,
    next_window_revision_id: Option<u64>,
}

#[derive(Debug)]
struct ReaderPendingExactSeekV1 {
    layout: LayoutConfig,
    locator: RuntimeSourceLocator,
    local_page_cap: u32,
    advance: RuntimeChapterLocalRevisionAdvance,
}

#[derive(Debug, Clone, Copy)]
struct ReaderPendingAdjacentV1 {
    from_artifact_id: u64,
    direction: ReaderAdjacentDirectionV1,
    local_page_cap: u32,
}

impl ReaderPendingAdjacentV1 {
    fn matches(&self, request: &ReaderAdjacentRequestV1) -> bool {
        self.from_artifact_id == request.from_artifact_id
            && self.direction == request.direction
            && self.local_page_cap == request.work.local_page_cap
    }
}

impl ReaderPendingExactSeekV1 {
    fn matches(
        &self,
        layout: &LayoutConfig,
        locator: &RuntimeSourceLocator,
        local_page_cap: u32,
    ) -> bool {
        self.layout == *layout && self.locator == *locator && self.local_page_cap == local_page_cap
    }
}

#[derive(Debug)]
enum ReaderExactSeekAdvanceV1 {
    Resolved(RuntimeChapterLocalRevisionAdvance),
    Pending(RuntimeChapterLocalRevisionAdvance),
}

impl ReaderRevisionOwnerV1 {
    fn from_advance(
        advance: RuntimeChapterLocalRevisionAdvance,
        layout: LayoutConfig,
        local_page_cap: u32,
        artifact_ref_count: u32,
    ) -> Self {
        Self {
            owner: owner_from_advance(&advance),
            continuation: advance.continuation,
            layout,
            local_page_cap,
            known_local_spread_count: advance.revision.known_extent.local_spread_count,
            final_local_spread_count: advance
                .revision
                .final_extent
                .map(|extent| extent.local_spread_count),
            page_cap_reached: advance.revision.page_cap_reached,
            artifact_ref_count,
            previous_window_revision_id: None,
            previous_window_evicted: false,
            next_window_revision_id: None,
        }
    }

    fn apply_advance(&mut self, advance: RuntimeChapterLocalRevisionAdvance) {
        self.owner = owner_from_advance(&advance);
        self.continuation = advance.continuation;
        self.known_local_spread_count = advance.revision.known_extent.local_spread_count;
        self.final_local_spread_count = advance
            .revision
            .final_extent
            .map(|extent| extent.local_spread_count);
        self.page_cap_reached = advance.revision.page_cap_reached;
    }
}

#[derive(Debug)]
pub struct ReaderSessionV1 {
    session_id: u64,
    document: RuntimeDocument,
    publication: ReaderPublicationV1,
    latest_request_id: u64,
    next_revision_id: u64,
    next_artifact_id: u64,
    revisions: BTreeMap<u64, ReaderRevisionOwnerV1>,
    publication_revisions: BTreeMap<u64, ReaderPublicationRevisionOwnerV1>,
    active_publication_revision_id: Option<u64>,
    artifacts: BTreeMap<u64, ReaderArtifactOwnerV1>,
    released_artifacts: BTreeSet<u64>,
    retained_windows: VecDeque<u64>,
    visible_intent: Option<ReaderVisibleIntentV1>,
    foreground_candidate: Option<ReaderForegroundCandidateV1>,
    // At most one unpublished owner survives a bounded exact seek. It never
    // receives reader revision/artifact identities until the target resolves.
    pending_exact_seek: Option<ReaderPendingExactSeekV1>,
    // Adjacent retries have their own typed intent identity. The underlying
    // progress remains owned by the source revision or, at a chapter
    // boundary, by `pending_exact_seek`.
    pending_adjacent: Option<ReaderPendingAdjacentV1>,
    #[cfg(test)]
    exact_cache_hit_count: u64,
    #[cfg(test)]
    exact_layout_quantum_count: u64,
}

impl ReaderSessionV1 {
    pub fn open_owned(session_id: u64, publication_bytes: Vec<u8>) -> Result<Self, ReaderErrorV1> {
        validate_session_id(session_id)?;
        let document = RuntimeDocument::open_owned(publication_bytes).map_err(engine_error)?;
        let publication = build_reader_publication_v1(session_id, &document)?;
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
            retained_windows: VecDeque::new(),
            visible_intent: None,
            foreground_candidate: None,
            pending_exact_seek: None,
            pending_adjacent: None,
            #[cfg(test)]
            exact_cache_hit_count: 0,
            #[cfg(test)]
            exact_layout_quantum_count: 0,
        })
    }

    pub const fn session_id(&self) -> u64 {
        self.session_id
    }

    pub const fn publication_v1(&self) -> &ReaderPublicationV1 {
        &self.publication
    }

    /// True only while this session owns one resumable, unpublished exact
    /// locator continuation. Adapters use this to distinguish cooperative
    /// foreground suspension from terminal `TargetNotPublished` failures.
    pub const fn has_pending_exact_seek_v1(&self) -> bool {
        self.pending_exact_seek.is_some()
    }

    /// True only while a newer adjacent request with the same source,
    /// direction, and page cap can resume retained foreground work.
    pub const fn has_pending_adjacent_v1(&self) -> bool {
        self.pending_adjacent.is_some()
    }

    pub fn request_artifact(
        &mut self,
        request: ReaderArtifactRequestV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        self.validate_request_identity(request.session_id, request.request_id, "artifact")?;
        validate_work(request.work)?;
        if request.text_profile != ReaderTextRenderingProfileV1::PlatformStringRuns {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::UnsupportedTextProfile,
                "positioned glyph output is not available in protocol v1 yet",
            ));
        }
        self.require_artifact_capacity()?;

        let layout = layout_config(request.layout)?;
        let locator = runtime_locator(request.locator)?;
        let expected_visible_artifact_id = self.begin_foreground_request(request.request_id);
        self.release_pending_adjacent()?;
        let artifact = self.create_revision_artifact(
            request.request_id,
            layout.clone(),
            locator,
            request.work,
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
        request: ReaderAdjacentRequestV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        self.validate_request_identity(request.session_id, request.request_id, "adjacent")?;
        validate_external_request_id(request.from_artifact_id, "fromArtifactId")?;
        validate_work(request.work)?;
        self.require_artifact_capacity()?;

        let source = self
            .artifacts
            .get(&request.from_artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(request.from_artifact_id))?;
        let layout = match source.backing {
            ReaderRevisionBackingV1::ChapterLocal => {
                let revision = self.revisions.get(&source.revision_id).ok_or_else(|| {
                    missing_artifact_revision(ReaderRevisionBackingV1::ChapterLocal)
                })?;
                if request.work.local_page_cap != revision.local_page_cap {
                    return Err(ReaderErrorV1::new(
                        ReaderErrorKindV1::InvalidRequest,
                        "adjacent request localPageCap must match the source revision",
                    ));
                }
                revision.layout.clone()
            }
            ReaderRevisionBackingV1::Publication => self
                .publication_revisions
                .get(&source.revision_id)
                .map(|revision| revision.layout.clone())
                .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?,
        };

        let initial_availability = self.adjacent_availability(&source, request.direction)?;
        let resumes_pending = self
            .pending_adjacent
            .as_ref()
            .is_some_and(|pending| pending.matches(&request));
        let expected_visible_artifact_id = self.begin_foreground_request(request.request_id);
        if !resumes_pending {
            self.release_pending_adjacent()?;
            self.release_pending_exact_seek()?;
        }
        let result = match source.backing {
            ReaderRevisionBackingV1::ChapterLocal => match request.direction {
                ReaderAdjacentDirectionV1::Previous if source.local_spread_index > 0 => self
                    .publish_revision_artifact(
                        source.revision_id,
                        source.local_spread_index - 1,
                        request.request_id,
                    ),
                ReaderAdjacentDirectionV1::Previous => self.request_previous_window_or_chapter(
                    source.clone(),
                    request.request_id,
                    request.work,
                ),
                ReaderAdjacentDirectionV1::Next => {
                    self.request_next(source.clone(), request.request_id, request.work)
                }
            },
            ReaderRevisionBackingV1::Publication => self.request_publication_adjacent(
                source.clone(),
                request.request_id,
                request.direction,
                request.work,
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
            Err(error) if error.kind == ReaderErrorKindV1::TargetNotPublished => {
                if self.adjacent_can_resume(&source, request.direction, initial_availability)? {
                    self.pending_adjacent = Some(ReaderPendingAdjacentV1 {
                        from_artifact_id: request.from_artifact_id,
                        direction: request.direction,
                        local_page_cap: request.work.local_page_cap,
                    });
                } else {
                    self.pending_adjacent = None;
                    self.release_pending_exact_seek()?;
                }
                Err(error)
            }
            Err(error) => {
                self.pending_adjacent = None;
                self.release_pending_exact_seek()?;
                Err(error)
            }
        }
    }

    pub fn read_resource(
        &mut self,
        artifact_id: u64,
        kind: ReaderResourceKindV1,
        href: &str,
    ) -> Result<ReaderResourceV1, ReaderErrorV1> {
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
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
                format!("artifact {artifact_id} does not reference {href}"),
            ));
        }
        let runtime_kind = runtime_resource_kind(kind);
        let byte_limit = reader_resource_bytes_max_v1(kind);
        if self
            .document
            .resource_byte_length(runtime_kind, href)
            .is_some_and(|length| u64::try_from(length).map_or(true, |length| length > byte_limit))
        {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
                format!("resource {href:?} exceeds its Reader v1 byte limit ({byte_limit})"),
            ));
        }
        let resource = match artifact.backing {
            ReaderRevisionBackingV1::ChapterLocal => {
                let owner = self
                    .revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                self.document
                    .get_chapter_local_resource(&owner, runtime_kind, href)
                    .map_err(engine_error)?
            }
            ReaderRevisionBackingV1::Publication => {
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
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
                format!("resource {href:?} exceeds its Reader v1 byte limit ({byte_limit})"),
            ));
        }
        Ok(ReaderResourceV1 {
            artifact_id,
            kind,
            href: resource.href,
            media_type: resource.media_type,
            bytes: resource.bytes,
            width: resource.width,
            height: resource.height,
        })
    }

    pub fn release_artifact(&mut self, artifact_id: u64) -> Result<bool, ReaderErrorV1> {
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
            ReaderRevisionBackingV1::ChapterLocal => {
                self.release_chapter_local_artifact_owner(&artifact)?;
            }
            ReaderRevisionBackingV1::Publication => {
                self.release_publication_artifact_owner(&artifact)?;
            }
        }
        self.artifacts.remove(&artifact_id);
        self.released_artifacts.insert(artifact_id);
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

    pub fn dispose(mut self) -> Result<ReaderDisposeAckV1, ReaderErrorV1> {
        let released_artifacts = self.dispose_owned_state()?;
        Ok(ReaderDisposeAckV1 {
            session_id: self.session_id,
            released_artifacts,
        })
    }

    fn dispose_owned_state(&mut self) -> Result<u32, ReaderErrorV1> {
        self.release_pending_adjacent()?;
        self.release_pending_exact_seek()?;
        let artifact_ids = self.artifacts.keys().copied().collect::<Vec<_>>();
        let mut released_artifacts = 0u32;
        for artifact_id in artifact_ids {
            if self.release_artifact(artifact_id)? {
                released_artifacts = released_artifacts.checked_add(1).ok_or_else(|| {
                    ReaderErrorV1::new(
                        ReaderErrorKindV1::NumericOverflow,
                        "released artifact count overflow",
                    )
                })?;
            }
        }
        self.retained_windows.clear();
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

    /// Atomically commits one live foreground candidate as the visible
    /// artifact. A candidate never becomes visible merely because its request
    /// completed.
    pub fn adopt_foreground_candidate(
        &mut self,
        request: ReaderForegroundHandoffV1,
    ) -> Result<ReaderForegroundHandoffAckV1, ReaderErrorV1> {
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
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
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
        self.visible_intent = Some(ReaderVisibleIntentV1 {
            accepted_request_id: candidate.accepted_request_id,
            visible_artifact_id: candidate.candidate_artifact_id,
            locator,
            layout: candidate.layout,
            pending_handoff_artifact_id: None,
        });
        self.foreground_candidate = None;
        Ok(ReaderForegroundHandoffAckV1 {
            intent_request_id: candidate.accepted_request_id,
            replaced_artifact_id: current_visible_artifact_id,
            visible_artifact_id: candidate.candidate_artifact_id,
        })
    }

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
        if self.foreground_candidate.is_some()
            || self.pending_exact_seek.is_some()
            || self.pending_adjacent.is_some()
        {
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
                    return Ok(background_result(
                        ReaderBackgroundStateV1::Reused,
                        &intent,
                        Some(artifact),
                    ));
                }
            }
        }

        let budget = RuntimeRevisionWorkBudget {
            max_top_level_nodes: usize_from_u32(
                request.max_top_level_nodes_per_quantum,
                "background top-level work budget",
            )?,
        };
        let (revision_id, state) = match self.active_publication_revision_id {
            Some(revision_id) => {
                let continued = self.continue_publication_once(revision_id, budget)?;
                if !continued {
                    return Ok(background_result(
                        ReaderBackgroundStateV1::Complete,
                        &intent,
                        None,
                    ));
                }
                (revision_id, ReaderBackgroundStateV1::Advanced)
            }
            None => (
                self.start_publication_once(intent.layout.clone(), budget)?,
                ReaderBackgroundStateV1::Started,
            ),
        };
        let artifact = if needs_handoff {
            self.try_publication_candidate(revision_id, &intent)?
        } else {
            None
        };
        Ok(background_result(state, &intent, artifact))
    }

    pub fn adopt_background_candidate(
        &mut self,
        request: ReaderBackgroundHandoffV1,
    ) -> Result<ReaderBackgroundHandoffAckV1, ReaderErrorV1> {
        if request.session_id == 0
            || request.session_id > READER_EXTERNAL_ID_MAX_V1
            || request.session_id != self.session_id
        {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidSession,
                "background handoff belongs to a different or invalid session",
            ));
        }
        validate_external_request_id(
            request.expected_visible_artifact_id,
            "expectedVisibleArtifactId",
        )?;
        validate_external_request_id(request.candidate_artifact_id, "candidateArtifactId")?;
        if self.foreground_candidate.is_some()
            || self.pending_exact_seek.is_some()
            || self.pending_adjacent.is_some()
        {
            return Err(background_yields_to_foreground());
        }
        let intent = self.visible_intent.as_mut().ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
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
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::StaleRequest,
                "background candidate is not pending for the visible intent",
            ));
        }
        let candidate = self
            .artifacts
            .get(&request.candidate_artifact_id)
            .ok_or_else(|| unknown_artifact(request.candidate_artifact_id))?;
        if candidate.backing != ReaderRevisionBackingV1::Publication
            || self.active_publication_revision_id != Some(candidate.revision_id)
        {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::StaleRequest,
                "background candidate no longer belongs to the active publication revision",
            ));
        }
        intent.visible_artifact_id = request.candidate_artifact_id;
        intent.pending_handoff_artifact_id = None;
        let ack = ReaderBackgroundHandoffAckV1 {
            intent_request_id: intent.accepted_request_id,
            replaced_artifact_id: request.expected_visible_artifact_id,
            visible_artifact_id: request.candidate_artifact_id,
        };
        self.foreground_candidate = None;
        Ok(ack)
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
        source: &ReaderArtifactOwnerV1,
        direction: ReaderAdjacentDirectionV1,
    ) -> Result<ReaderAdjacentAvailabilityV1, ReaderErrorV1> {
        let navigation = match source.backing {
            ReaderRevisionBackingV1::ChapterLocal => {
                let revision = self.revisions.get(&source.revision_id).ok_or_else(|| {
                    missing_artifact_revision(ReaderRevisionBackingV1::ChapterLocal)
                })?;
                reader_navigation(&self.document, revision, source.local_spread_index)
            }
            ReaderRevisionBackingV1::Publication => {
                let revision = self
                    .publication_revisions
                    .get(&source.revision_id)
                    .ok_or_else(|| {
                        missing_artifact_revision(ReaderRevisionBackingV1::Publication)
                    })?;
                publication_navigation(revision, source.local_spread_index)
            }
        };
        Ok(match direction {
            ReaderAdjacentDirectionV1::Previous => navigation.previous,
            ReaderAdjacentDirectionV1::Next => navigation.next,
        })
    }

    fn adjacent_can_resume(
        &self,
        source: &ReaderArtifactOwnerV1,
        direction: ReaderAdjacentDirectionV1,
        initial_availability: ReaderAdjacentAvailabilityV1,
    ) -> Result<bool, ReaderErrorV1> {
        if self.pending_exact_seek.is_some() {
            return Ok(true);
        }
        let current = self.adjacent_availability(source, direction)?;
        Ok(match current {
            ReaderAdjacentAvailabilityV1::Pending => true,
            ReaderAdjacentAvailabilityV1::ChapterBoundary => {
                initial_availability != ReaderAdjacentAvailabilityV1::ChapterBoundary
            }
            ReaderAdjacentAvailabilityV1::Available
            | ReaderAdjacentAvailabilityV1::Terminal
            | ReaderAdjacentAvailabilityV1::Blocked => false,
        })
    }

    fn install_foreground_candidate(
        &mut self,
        accepted_request_id: u64,
        expected_visible_artifact_id: Option<u64>,
        artifact: &ReaderArtifactV1,
        layout: LayoutConfig,
    ) {
        self.foreground_candidate = Some(ReaderForegroundCandidateV1 {
            accepted_request_id,
            expected_visible_artifact_id,
            candidate_artifact_id: artifact.artifact_id,
            revision_id: artifact.revision_id,
            locator: artifact.locator.clone(),
            layout,
        });
    }

    fn validate_foreground_handoff_request(
        &self,
        request: ReaderForegroundHandoffV1,
    ) -> Result<(), ReaderErrorV1> {
        if request.session_id == 0
            || request.session_id > READER_EXTERNAL_ID_MAX_V1
            || request.session_id != self.session_id
        {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidSession,
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
        request: &ReaderForegroundHandoffV1,
        candidate: &ReaderForegroundCandidateV1,
        artifact: &ReaderArtifactOwnerV1,
    ) -> Result<(), ReaderErrorV1> {
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
            ReaderRevisionBackingV1::ChapterLocal => self
                .revisions
                .get(&artifact.revision_id)
                .map(|revision| &revision.layout),
            ReaderRevisionBackingV1::Publication => self
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

    fn start_publication_once(
        &mut self,
        layout: LayoutConfig,
        budget: RuntimeRevisionWorkBudget,
    ) -> Result<u64, ReaderErrorV1> {
        let advance = self
            .document
            .create_bounded_revision(RuntimeBoundedRevisionRequest {
                layout_config: layout.clone(),
                line_breaking: LineBreaking::Greedy,
                budget,
            })
            .map_err(engine_error)?;
        let runtime_revision_id = advance.revision.revision_id.clone();
        let reader_revision_id = match take_identity(&mut self.next_revision_id, "revisionId") {
            Ok(value) => value,
            Err(error) => {
                let _ = self.document.release_revision(&runtime_revision_id);
                return Err(error);
            }
        };
        self.publication_revisions.insert(
            reader_revision_id,
            ReaderPublicationRevisionOwnerV1::from_advance(reader_revision_id, advance, layout),
        );
        self.active_publication_revision_id = Some(reader_revision_id);
        Ok(reader_revision_id)
    }

    fn continue_publication_once(
        &mut self,
        revision_id: u64,
        budget: RuntimeRevisionWorkBudget,
    ) -> Result<bool, ReaderErrorV1> {
        let cursor = {
            let revision = self
                .publication_revisions
                .get_mut(&revision_id)
                .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
            let Some(cursor) = revision.continuation.take() else {
                return Ok(false);
            };
            cursor
        };
        let result = self
            .document
            .continue_revision(RuntimeContinueRevisionRequest {
                revision_id: cursor.revision_id,
                revision_version: cursor.revision_version,
                cursor: cursor.cursor,
                budget,
            });
        match result {
            Ok(advance) => {
                self.publication_revisions
                    .get_mut(&revision_id)
                    .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?
                    .apply_advance(advance);
                Ok(true)
            }
            Err(error) => {
                if let Some(summary) = error.revision.as_deref() {
                    if let Some(revision) = self.publication_revisions.get_mut(&revision_id) {
                        revision.owner = crate::runtime::RuntimeRevisionHandle::from(summary);
                        revision.known_spread_count = summary.known_extent.spread_count;
                        revision.final_spread_count =
                            summary.final_extent.map(|extent| extent.spread_count);
                    }
                }
                Err(engine_error(error))
            }
        }
    }

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
            page_index,
            spread_index,
            matched_by,
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
        let navigation = publication_navigation(
            self.publication_revisions
                .get(&revision_id)
                .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?,
            spread_index,
        );
        let artifact_id = take_identity(&mut self.next_artifact_id, "artifactId")?;
        let target = ResolvedArtifactTarget {
            owner: ResolvedArtifactOwnerV1::Publication(owner),
            locator,
            matched_by,
            local_page_index: page_index,
            local_spread_index: spread_index,
        };
        let artifact = build_reader_artifact_v1(
            &self.document,
            ArtifactIdentityV1 {
                session_id: self.session_id,
                request_id: intent.accepted_request_id,
                revision_id,
                artifact_id,
            },
            &target,
            navigation,
        )?;
        let artifact_owner = artifact_owner(
            revision_id,
            ReaderRevisionBackingV1::Publication,
            spread_index,
            &artifact,
        );
        let revision = self
            .publication_revisions
            .get_mut(&revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
        debug_assert_eq!(revision.reader_revision_id, revision_id);
        revision.artifact_ref_count = revision
            .artifact_ref_count
            .checked_add(1)
            .ok_or_else(|| numeric_overflow("artifact reference count"))?;
        self.artifacts.insert(artifact_id, artifact_owner);
        if let Some(current) = self.visible_intent.as_mut() {
            current.pending_handoff_artifact_id = Some(artifact_id);
        }
        Ok(Some(artifact))
    }

    fn visible_intent_matches(&self, expected: &ReaderVisibleIntentV1) -> bool {
        self.visible_intent.as_ref().is_some_and(|current| {
            current.accepted_request_id == expected.accepted_request_id
                && current.visible_artifact_id == expected.visible_artifact_id
                && current.locator == expected.locator
                && current.layout == expected.layout
        })
    }

    fn request_publication_adjacent(
        &mut self,
        source: ReaderArtifactOwnerV1,
        request_id: u64,
        direction: ReaderAdjacentDirectionV1,
        work: ReaderWorkBudgetV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let target_spread = match direction {
            ReaderAdjacentDirectionV1::Previous => source
                .local_spread_index
                .checked_sub(1)
                .ok_or_else(|| target_not_published("publication boundary is terminal"))?,
            ReaderAdjacentDirectionV1::Next => source
                .local_spread_index
                .checked_add(1)
                .ok_or_else(|| numeric_overflow("publication spread index"))?,
        };
        let budget = RuntimeRevisionWorkBudget {
            max_top_level_nodes: usize_from_u32(
                work.max_top_level_nodes_per_quantum,
                "adjacent publication top-level work budget",
            )?,
        };
        let mut used_quanta = 0u32;
        while self
            .publication_revisions
            .get(&source.revision_id)
            .is_some_and(|revision| {
                target_spread >= revision.known_spread_count && revision.continuation.is_some()
            })
            && used_quanta < work.max_foreground_quanta
        {
            if !self.continue_publication_once(source.revision_id, budget)? {
                break;
            }
            used_quanta += 1;
        }
        let revision = self
            .publication_revisions
            .get(&source.revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
        if target_spread >= revision.known_spread_count {
            let message = if revision.final_spread_count.is_some() {
                "publication boundary is terminal"
            } else if revision.continuation.is_some() {
                "publication adjacent spread remains pending after bounded foreground work"
            } else {
                "publication adjacent spread is not resumable"
            };
            return Err(target_not_published(message));
        }
        self.publish_publication_artifact(source.revision_id, target_spread, request_id)
    }

    fn publish_publication_artifact(
        &mut self,
        revision_id: u64,
        spread_index: usize,
        request_id: u64,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let (owner, navigation) = {
            let revision = self
                .publication_revisions
                .get(&revision_id)
                .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
            (
                revision.owner.clone(),
                publication_navigation(revision, spread_index),
            )
        };
        let frame = self
            .document
            .get_frame_at(&owner, spread_index)
            .map_err(engine_error)?
            .value;
        let page_index = frame.page_indexes.first().copied().ok_or_else(|| {
            target_not_published("published publication spread contains no pages")
        })?;
        let anchor = self
            .document
            .get_page_reading_anchor_at(&owner, page_index)
            .map_err(engine_error)?
            .value;
        let RuntimePageReadingAnchor::Resolved {
            locator,
            page_index,
            spread_index: resolved_spread_index,
            ..
        } = anchor
        else {
            return Err(target_not_published(
                "published publication spread has no durable reading anchor",
            ));
        };
        if resolved_spread_index != spread_index {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "publication reading anchor resolved to a different spread",
            ));
        }
        let target = ResolvedArtifactTarget {
            owner: ResolvedArtifactOwnerV1::Publication(owner),
            matched_by: locator_precision(&locator),
            locator,
            local_page_index: page_index,
            local_spread_index: spread_index,
        };
        let artifact_id = take_identity(&mut self.next_artifact_id, "artifactId")?;
        let artifact = build_reader_artifact_v1(
            &self.document,
            ArtifactIdentityV1 {
                session_id: self.session_id,
                request_id,
                revision_id,
                artifact_id,
            },
            &target,
            navigation,
        )?;
        let artifact_owner = artifact_owner(
            revision_id,
            ReaderRevisionBackingV1::Publication,
            spread_index,
            &artifact,
        );
        let revision = self
            .publication_revisions
            .get_mut(&revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
        revision.artifact_ref_count = revision
            .artifact_ref_count
            .checked_add(1)
            .ok_or_else(|| numeric_overflow("artifact reference count"))?;
        self.artifacts.insert(artifact_id, artifact_owner);
        Ok(artifact)
    }

    #[cfg(test)]
    pub(super) fn live_revision_count(&self) -> usize {
        self.revisions.len()
    }

    #[cfg(test)]
    pub(super) fn has_live_revision(&self, revision_id: u64) -> bool {
        self.revisions.contains_key(&revision_id)
    }

    #[cfg(test)]
    pub(super) const fn exact_cache_hit_count(&self) -> u64 {
        self.exact_cache_hit_count
    }

    #[cfg(test)]
    pub(super) const fn exact_layout_quantum_count(&self) -> u64 {
        self.exact_layout_quantum_count
    }

    #[cfg(test)]
    pub(super) fn retained_window_count(&self) -> usize {
        self.retained_windows.len()
    }

    #[cfg(test)]
    pub(super) fn clear_retained_windows(&mut self) {
        self.retained_windows.clear();
    }

    #[cfg(test)]
    pub(super) fn artifact_owner_backing(
        &self,
        artifact_id: u64,
    ) -> Option<(ReaderRevisionBackingV1, u64)> {
        self.artifacts
            .get(&artifact_id)
            .map(|owner| (owner.backing, owner.revision_id))
    }

    #[cfg(test)]
    pub(super) fn has_live_artifact(&self, artifact_id: u64) -> bool {
        self.artifacts.contains_key(&artifact_id)
    }

    #[cfg(test)]
    pub(super) fn runtime_revision_version(&self, revision_id: u64) -> Option<u32> {
        self.revisions
            .get(&revision_id)
            .map(|revision| revision.owner.revision_version)
    }

    #[cfg(test)]
    pub(super) fn set_runtime_revision_version(&mut self, revision_id: u64, revision_version: u32) {
        self.revisions
            .get_mut(&revision_id)
            .expect("revision owner is live")
            .owner
            .revision_version = revision_version;
    }

    #[cfg(test)]
    pub(super) fn revision_artifact_ref_count(&self, revision_id: u64) -> Option<u32> {
        self.revisions
            .get(&revision_id)
            .map(|revision| revision.artifact_ref_count)
    }

    #[cfg(test)]
    pub(super) fn max_known_local_page_count(&self) -> usize {
        self.revisions
            .values()
            .filter_map(|revision| {
                self.document
                    .get_chapter_local_revision_summary(&revision.owner)
                    .ok()
                    .map(|summary| summary.known_extent.local_page_count)
            })
            .max()
            .unwrap_or(0)
    }

    #[cfg(test)]
    pub(super) fn cleanup_backlog_is_empty(&self) -> bool {
        self.document.cleanup_queue.is_empty()
    }

    #[cfg(test)]
    pub(super) fn live_continuation_count(&self) -> usize {
        self.document.continuations.len()
    }

    #[cfg(test)]
    pub(super) fn live_runtime_chapter_local_revision_count(&self) -> usize {
        self.document.chapter_local_revisions.len()
    }

    #[cfg(test)]
    pub(super) fn pending_exact_seek_owner(&self) -> Option<RuntimeChapterLocalRevisionHandle> {
        self.pending_exact_seek
            .as_ref()
            .map(|pending| owner_from_advance(&pending.advance))
    }

    #[cfg(test)]
    pub(super) fn pending_exact_seek_count(&self) -> usize {
        self.pending_exact_seek.iter().count()
    }

    #[cfg(test)]
    pub(super) fn pending_adjacent_count(&self) -> usize {
        self.pending_adjacent.iter().count()
    }

    #[cfg(test)]
    pub(super) fn has_visible_intent(&self) -> bool {
        self.visible_intent.is_some()
    }

    #[cfg(test)]
    pub(super) fn visible_artifact_id(&self) -> Option<u64> {
        self.visible_intent
            .as_ref()
            .map(|intent| intent.visible_artifact_id)
    }

    #[cfg(test)]
    pub(super) fn foreground_candidate_artifact_id(&self) -> Option<u64> {
        self.foreground_candidate
            .as_ref()
            .map(|candidate| candidate.candidate_artifact_id)
    }

    #[cfg(test)]
    pub(super) fn dispose_in_place_for_test(&mut self) -> Result<u32, ReaderErrorV1> {
        self.dispose_owned_state()
    }

    #[cfg(test)]
    pub(super) fn publication_revision_count(&self) -> usize {
        self.publication_revisions.len()
    }

    #[cfg(test)]
    pub(super) fn publication_footnote_source_scan_count(&self) -> usize {
        self.document.publication_footnote_source_scan_count()
    }

    #[cfg(test)]
    pub(super) fn publication_footnote_definition_parse_count(&self) -> usize {
        self.document.publication_footnote_definition_parse_count()
    }

    #[cfg(test)]
    pub(super) fn active_publication_revision_version(&self) -> Option<u32> {
        self.active_publication_revision_id.and_then(|revision_id| {
            self.publication_revisions
                .get(&revision_id)
                .map(|revision| revision.owner.revision_version)
        })
    }

    fn request_previous_window_or_chapter(
        &mut self,
        source: ReaderArtifactOwnerV1,
        request_id: u64,
        work: ReaderWorkBudgetV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let previous_revision_id = self
            .revisions
            .get(&source.revision_id)
            .and_then(|revision| revision.previous_window_revision_id);
        let Some(previous_revision_id) = previous_revision_id else {
            if self
                .revisions
                .get(&source.revision_id)
                .is_some_and(|revision| revision.previous_window_evicted)
            {
                return Err(target_not_published(
                    "previous rollover window is no longer retained",
                ));
            }
            return self.request_chapter_boundary(
                source.revision_id,
                ReaderAdjacentDirectionV1::Previous,
                request_id,
                work,
            );
        };
        let previous_spread = self
            .revisions
            .get(&previous_revision_id)
            .and_then(|revision| revision.known_local_spread_count.checked_sub(1))
            .ok_or_else(|| {
                target_not_published("retained previous window has no published spread")
            })?;
        self.retain_adjacent_windows(previous_revision_id, source.revision_id)?;
        self.publish_revision_artifact(previous_revision_id, previous_spread, request_id)
    }

    fn request_next(
        &mut self,
        source: ReaderArtifactOwnerV1,
        request_id: u64,
        work: ReaderWorkBudgetV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let target_spread = source
            .local_spread_index
            .checked_add(1)
            .ok_or_else(|| numeric_overflow("local spread index"))?;
        if self
            .revisions
            .get(&source.revision_id)
            .is_some_and(|revision| target_spread < revision.known_local_spread_count)
        {
            return self.publish_revision_artifact(source.revision_id, target_spread, request_id);
        }

        let runtime_budget = RuntimeRevisionWorkBudget {
            max_top_level_nodes: usize_from_u32(
                work.max_top_level_nodes_per_quantum,
                "top-level work budget",
            )?,
        };
        if self
            .revisions
            .get(&source.revision_id)
            .is_some_and(|revision| revision.page_cap_reached)
        {
            return self.request_next_window(
                source.revision_id,
                request_id,
                work,
                work.max_foreground_quanta,
                runtime_budget,
            );
        }

        let used_quanta = self.continue_revision_until(
            source.revision_id,
            target_spread,
            work.max_foreground_quanta,
            runtime_budget,
        )?;
        let (known_spreads, final_spreads, page_cap_reached) = self
            .revisions
            .get(&source.revision_id)
            .map(|revision| {
                (
                    revision.known_local_spread_count,
                    revision.final_local_spread_count,
                    revision.page_cap_reached,
                )
            })
            .ok_or_else(|| {
                ReaderErrorV1::new(
                    ReaderErrorKindV1::EngineFailure,
                    "artifact revision ownership is missing",
                )
            })?;
        if target_spread < known_spreads {
            return self.publish_revision_artifact(source.revision_id, target_spread, request_id);
        }
        let remaining_quanta = work.max_foreground_quanta.saturating_sub(used_quanta);
        if final_spreads.is_some() {
            if remaining_quanta == 0 {
                return Err(target_not_published(
                    "chapter boundary was reached after exhausting the bounded work request",
                ));
            }
            return self.request_chapter_boundary(
                source.revision_id,
                ReaderAdjacentDirectionV1::Next,
                request_id,
                ReaderWorkBudgetV1 {
                    max_foreground_quanta: remaining_quanta,
                    ..work
                },
            );
        }
        if page_cap_reached {
            return self.request_next_window(
                source.revision_id,
                request_id,
                work,
                remaining_quanta,
                runtime_budget,
            );
        }
        Err(target_not_published(
            "adjacent spread was not published within the requested bounded work",
        ))
    }

    fn request_next_window(
        &mut self,
        source_revision_id: u64,
        request_id: u64,
        work: ReaderWorkBudgetV1,
        mut remaining_quanta: u32,
        budget: RuntimeRevisionWorkBudget,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let linked_revision_id = self
            .revisions
            .get(&source_revision_id)
            .and_then(|revision| revision.next_window_revision_id);
        let next_revision_id = if let Some(linked_revision_id) = linked_revision_id {
            linked_revision_id
        } else {
            if remaining_quanta == 0 {
                return Err(target_not_published(
                    "window rollover exceeded the requested bounded work",
                ));
            }
            remaining_quanta -= 1;
            self.create_rollover_window(source_revision_id, budget)?
        };
        let used = self.continue_revision_until(next_revision_id, 0, remaining_quanta, budget)?;
        remaining_quanta = remaining_quanta.saturating_sub(used);
        let (known_spreads, final_spreads) = self
            .revisions
            .get(&next_revision_id)
            .map(|revision| {
                (
                    revision.known_local_spread_count,
                    revision.final_local_spread_count,
                )
            })
            .ok_or_else(|| {
                ReaderErrorV1::new(
                    ReaderErrorKindV1::EngineFailure,
                    "rollover revision ownership is missing",
                )
            })?;
        if known_spreads > 0 {
            self.retain_adjacent_windows(source_revision_id, next_revision_id)?;
            return self.publish_revision_artifact(next_revision_id, 0, request_id);
        }
        if final_spreads.is_some() && remaining_quanta > 0 {
            return self.request_chapter_boundary(
                next_revision_id,
                ReaderAdjacentDirectionV1::Next,
                request_id,
                ReaderWorkBudgetV1 {
                    max_foreground_quanta: remaining_quanta,
                    ..work
                },
            );
        }
        Err(target_not_published(
            "next window did not publish a spread within the requested bounded work",
        ))
    }

    fn create_rollover_window(
        &mut self,
        source_revision_id: u64,
        budget: RuntimeRevisionWorkBudget,
    ) -> Result<u64, ReaderErrorV1> {
        let (continuation, layout, local_page_cap) = {
            let revision = self.revisions.get_mut(&source_revision_id).ok_or_else(|| {
                ReaderErrorV1::new(
                    ReaderErrorKindV1::EngineFailure,
                    "source rollover revision ownership is missing",
                )
            })?;
            let continuation = revision.continuation.take().ok_or_else(|| {
                target_not_published("sealed page-cap window has no rollover break token")
            })?;
            (
                continuation,
                revision.layout.clone(),
                revision.local_page_cap,
            )
        };
        let advance = self
            .document
            .rollover_chapter_local_revision(RuntimeRolloverChapterLocalRevisionRequest {
                continuation,
                budget,
            })
            .map_err(engine_error)?;
        let runtime_owner = owner_from_advance(&advance);
        let revision_id = match take_identity(&mut self.next_revision_id, "revisionId") {
            Ok(value) => value,
            Err(error) => {
                let _ = self
                    .document
                    .release_chapter_local_revision_immediately(&runtime_owner);
                return Err(error);
            }
        };
        let mut revision = ReaderRevisionOwnerV1::from_advance(advance, layout, local_page_cap, 0);
        revision.previous_window_revision_id = Some(source_revision_id);
        revision.previous_window_evicted = false;
        self.revisions.insert(revision_id, revision);
        let source = self.revisions.get_mut(&source_revision_id).ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "source rollover revision disappeared",
            )
        })?;
        source.next_window_revision_id = Some(revision_id);
        self.retain_adjacent_windows(source_revision_id, revision_id)?;
        Ok(revision_id)
    }

    fn continue_revision_until(
        &mut self,
        revision_id: u64,
        target_spread: usize,
        max_quanta: u32,
        budget: RuntimeRevisionWorkBudget,
    ) -> Result<u32, ReaderErrorV1> {
        let mut revision = self.revisions.remove(&revision_id).ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "artifact revision ownership is missing",
            )
        })?;
        let result = (|| {
            let mut used = 0u32;
            while target_spread >= revision.known_local_spread_count
                && !revision.page_cap_reached
                && used < max_quanta
            {
                let Some(continuation) = revision.continuation.take() else {
                    break;
                };
                let advance = match self.document.continue_chapter_local_revision(
                    RuntimeContinueChapterLocalRevisionRequest {
                        continuation,
                        budget,
                    },
                ) {
                    Ok(advance) => advance,
                    Err(error) => {
                        if let Some(summary) = error.revision.as_deref() {
                            revision.owner = RuntimeChapterLocalRevisionHandle {
                                revision_id: summary.revision_id.clone(),
                                revision_version: summary.revision_version,
                                coordinate: summary.coordinate.clone(),
                            };
                            revision.known_local_spread_count =
                                summary.known_extent.local_spread_count;
                            revision.final_local_spread_count =
                                summary.final_extent.map(|extent| extent.local_spread_count);
                            revision.page_cap_reached = summary.page_cap_reached;
                        }
                        return Err(engine_error(error));
                    }
                };
                revision.apply_advance(advance);
                used += 1;
            }
            Ok(used)
        })();
        self.revisions.insert(revision_id, revision);
        result
    }

    fn request_chapter_boundary(
        &mut self,
        revision_id: u64,
        direction: ReaderAdjacentDirectionV1,
        request_id: u64,
        work: ReaderWorkBudgetV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let revision = self.revisions.get(&revision_id).ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
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
                progression: (direction == ReaderAdjacentDirectionV1::Previous).then_some(1.0),
            },
            work,
        )
    }

    fn create_revision_artifact(
        &mut self,
        request_id: u64,
        layout: LayoutConfig,
        locator: RuntimeSourceLocator,
        work: ReaderWorkBudgetV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let (chapter_index, canonical_locator) = self
            .document
            .validate_source_locator_for_chapter_local(locator)
            .map_err(invalid_locator)?;
        if let Some((revision_id, target)) = self.find_cached_exact_target(
            chapter_index,
            &layout,
            &canonical_locator,
            work.local_page_cap,
        )? {
            self.release_pending_exact_seek()?;
            let artifact =
                self.publish_resolved_revision_artifact(revision_id, target, request_id)?;
            #[cfg(test)]
            {
                self.exact_cache_hit_count += 1;
            }
            return Ok(artifact);
        }
        let budget = RuntimeRevisionWorkBudget {
            max_top_level_nodes: usize_from_u32(
                work.max_top_level_nodes_per_quantum,
                "top-level work budget",
            )?,
        };
        let advance = match self.pending_exact_seek.take() {
            Some(pending) if pending.matches(&layout, &canonical_locator, work.local_page_cap) => {
                self.advance_until_target(pending.advance, work.max_foreground_quanta, budget)?
            }
            Some(pending) => {
                self.pending_exact_seek = Some(pending);
                self.release_pending_exact_seek()?;
                let advance = self.start_exact_seek(
                    chapter_index,
                    layout.clone(),
                    canonical_locator.clone(),
                    work,
                    budget,
                )?;
                self.advance_until_target(
                    advance,
                    work.max_foreground_quanta.saturating_sub(1),
                    budget,
                )?
            }
            None => {
                let advance = self.start_exact_seek(
                    chapter_index,
                    layout.clone(),
                    canonical_locator.clone(),
                    work,
                    budget,
                )?;
                self.advance_until_target(
                    advance,
                    work.max_foreground_quanta.saturating_sub(1),
                    budget,
                )?
            }
        };
        let advance = match advance {
            ReaderExactSeekAdvanceV1::Resolved(advance) => advance,
            ReaderExactSeekAdvanceV1::Pending(advance) => {
                self.pending_exact_seek = Some(ReaderPendingExactSeekV1 {
                    layout,
                    locator: canonical_locator,
                    local_page_cap: work.local_page_cap,
                    advance,
                });
                return Err(target_not_published(
                    "exact locator remains pending after the requested bounded work; retry the same target with a newer requestId",
                ));
            }
        };
        let target = resolved_target(&advance).ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "resolved artifact target disappeared",
            )
        })?;
        let owner = owner_from_advance(&advance);
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
        let revision = ReaderRevisionOwnerV1::from_advance(advance, layout, work.local_page_cap, 1);
        let navigation = reader_navigation(&self.document, &revision, target.local_spread_index);
        let artifact = match build_reader_artifact_v1(
            &self.document,
            ArtifactIdentityV1 {
                session_id: self.session_id,
                request_id,
                revision_id,
                artifact_id,
            },
            &target,
            navigation,
        ) {
            Ok(artifact) => artifact,
            Err(error) => {
                let _ = self
                    .document
                    .release_chapter_local_revision_immediately(&owner);
                return Err(error);
            }
        };
        let artifact_owner = artifact_owner(
            revision_id,
            ReaderRevisionBackingV1::ChapterLocal,
            target.local_spread_index,
            &artifact,
        );
        self.revisions.insert(revision_id, revision);
        self.artifacts.insert(artifact_id, artifact_owner);
        Ok(artifact)
    }

    fn start_exact_seek(
        &mut self,
        chapter_index: usize,
        layout: LayoutConfig,
        canonical_locator: RuntimeSourceLocator,
        work: ReaderWorkBudgetV1,
        budget: RuntimeRevisionWorkBudget,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, ReaderErrorV1> {
        #[cfg(test)]
        {
            self.exact_layout_quantum_count += 1;
        }
        self.document
            .create_bounded_chapter_local_revision(RuntimeBoundedChapterLocalRevisionRequest {
                layout_config: layout,
                line_breaking: LineBreaking::Greedy,
                target_chapter_index: chapter_index,
                target_locator: canonical_locator,
                local_page_cap: usize_from_u32(work.local_page_cap, "local page cap")?,
                budget,
            })
            .map_err(engine_error)
    }

    fn publish_revision_artifact(
        &mut self,
        revision_id: u64,
        local_spread_index: usize,
        request_id: u64,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let revision = self.revisions.get(&revision_id).ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "artifact revision ownership is missing",
            )
        })?;
        let target = published_spread_target(&self.document, &revision.owner, local_spread_index)?;
        self.publish_resolved_revision_artifact(revision_id, target, request_id)
    }

    fn publish_resolved_revision_artifact(
        &mut self,
        revision_id: u64,
        target: ResolvedArtifactTarget,
        request_id: u64,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let revision = self.revisions.get(&revision_id).ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "artifact revision ownership is missing",
            )
        })?;
        let local_spread_index = target.local_spread_index;
        let navigation = reader_navigation(&self.document, revision, local_spread_index);
        let artifact_id = take_identity(&mut self.next_artifact_id, "artifactId")?;
        let artifact = build_reader_artifact_v1(
            &self.document,
            ArtifactIdentityV1 {
                session_id: self.session_id,
                request_id,
                revision_id,
                artifact_id,
            },
            &target,
            navigation,
        )?;
        let artifact_owner = artifact_owner(
            revision_id,
            ReaderRevisionBackingV1::ChapterLocal,
            local_spread_index,
            &artifact,
        );
        let revision = self.revisions.get_mut(&revision_id).ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "artifact revision ownership is missing",
            )
        })?;
        revision.artifact_ref_count = revision
            .artifact_ref_count
            .checked_add(1)
            .ok_or_else(|| numeric_overflow("artifact reference count"))?;
        self.artifacts.insert(artifact_id, artifact_owner);
        Ok(artifact)
    }

    fn validate_request_identity(
        &self,
        session_id: u64,
        request_id: u64,
        request_name: &str,
    ) -> Result<(), ReaderErrorV1> {
        if session_id == 0
            || session_id > READER_EXTERNAL_ID_MAX_V1
            || session_id != self.session_id
        {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidSession,
                format!("{request_name} request belongs to a different or invalid session"),
            ));
        }
        validate_external_request_id(request_id, "requestId")?;
        if request_id <= self.latest_request_id {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::StaleRequest,
                format!(
                    "requestId {request_id} is not newer than {}",
                    self.latest_request_id
                ),
            ));
        }
        Ok(())
    }

    fn require_artifact_capacity(&self) -> Result<(), ReaderErrorV1> {
        if self.live_artifact_count() < READER_LIVE_ARTIFACT_CAP_V1 {
            return Ok(());
        }
        Err(ReaderErrorV1::new(
            ReaderErrorKindV1::InvalidRequest,
            format!(
                "live artifact cap {READER_LIVE_ARTIFACT_CAP_V1} reached; release an old artifact"
            ),
        ))
    }

    fn advance_until_target(
        &mut self,
        mut advance: RuntimeChapterLocalRevisionAdvance,
        max_additional_quanta: u32,
        budget: RuntimeRevisionWorkBudget,
    ) -> Result<ReaderExactSeekAdvanceV1, ReaderErrorV1> {
        let mut used_quanta = 0u32;
        loop {
            if resolved_target(&advance).is_some() {
                return Ok(ReaderExactSeekAdvanceV1::Resolved(advance));
            }
            if used_quanta >= max_additional_quanta {
                return if advance.continuation.is_some() {
                    Ok(ReaderExactSeekAdvanceV1::Pending(advance))
                } else {
                    self.release_unresolvable_advance(advance)
                };
            }
            let Some(continuation) = advance.continuation.take() else {
                return self.release_unresolvable_advance(advance);
            };
            let previous_owner = owner_from_advance(&advance);
            #[cfg(test)]
            {
                self.exact_layout_quantum_count += 1;
            }
            if advance.revision.page_cap_reached {
                advance = match self.document.rollover_chapter_local_revision(
                    RuntimeRolloverChapterLocalRevisionRequest {
                        continuation,
                        budget,
                    },
                ) {
                    Ok(next) => {
                        if let Err(error) = self
                            .document
                            .release_chapter_local_revision_immediately(&previous_owner)
                        {
                            let _ = self.document.release_chapter_local_revision_immediately(
                                &owner_from_advance(&next),
                            );
                            return Err(engine_error(error));
                        }
                        next
                    }
                    Err(error) => {
                        let _ = self
                            .document
                            .release_chapter_local_revision_immediately(&previous_owner);
                        return Err(engine_error(error));
                    }
                };
            } else {
                advance = match self.document.continue_chapter_local_revision(
                    RuntimeContinueChapterLocalRevisionRequest {
                        continuation,
                        budget,
                    },
                ) {
                    Ok(next) => next,
                    Err(error) => {
                        let owner = error
                            .revision
                            .as_deref()
                            .map(|summary| RuntimeChapterLocalRevisionHandle {
                                revision_id: summary.revision_id.clone(),
                                revision_version: summary.revision_version,
                                coordinate: summary.coordinate.clone(),
                            })
                            .unwrap_or(previous_owner);
                        let _ = self
                            .document
                            .release_chapter_local_revision_immediately(&owner);
                        return Err(engine_error(error));
                    }
                };
            }
            used_quanta += 1;
        }
    }

    fn release_unresolvable_advance(
        &mut self,
        advance: RuntimeChapterLocalRevisionAdvance,
    ) -> Result<ReaderExactSeekAdvanceV1, ReaderErrorV1> {
        self.document
            .release_chapter_local_revision_immediately(&owner_from_advance(&advance))
            .map_err(engine_error)?;
        Err(target_not_published(
            "exact locator cannot be published from the completed bounded revision",
        ))
    }

    fn release_pending_exact_seek(&mut self) -> Result<(), ReaderErrorV1> {
        let Some(pending) = self.pending_exact_seek.take() else {
            return Ok(());
        };
        let owner = owner_from_advance(&pending.advance);
        match self
            .document
            .release_chapter_local_revision_immediately(&owner)
        {
            Ok(_) => Ok(()),
            Err(error) => {
                self.pending_exact_seek = Some(pending);
                Err(engine_error(error))
            }
        }
    }

    fn release_pending_adjacent(&mut self) -> Result<(), ReaderErrorV1> {
        let Some(pending) = self.pending_adjacent.take() else {
            return Ok(());
        };
        if let Err(error) = self.release_pending_exact_seek() {
            self.pending_adjacent = Some(pending);
            return Err(error);
        }
        Ok(())
    }

    fn retain_adjacent_windows(
        &mut self,
        first_revision_id: u64,
        second_revision_id: u64,
    ) -> Result<(), ReaderErrorV1> {
        for revision_id in [first_revision_id, second_revision_id] {
            if !self.revisions.contains_key(&revision_id) {
                return Err(ReaderErrorV1::new(
                    ReaderErrorKindV1::EngineFailure,
                    "cannot retain an unknown rollover revision",
                ));
            }
            self.retained_windows
                .retain(|candidate| *candidate != revision_id);
            self.retained_windows.push_back(revision_id);
        }
        while self.retained_windows.len() > READER_RETAINED_WINDOW_CAP_V1 {
            let revision_id = self
                .retained_windows
                .pop_front()
                .expect("retained-window overflow has an oldest entry");
            if self
                .revisions
                .get(&revision_id)
                .is_some_and(|revision| revision.artifact_ref_count == 0)
            {
                self.retire_reader_revision_immediately(revision_id)?;
            }
        }
        Ok(())
    }

    fn release_chapter_local_artifact_owner(
        &mut self,
        artifact: &ReaderArtifactOwnerV1,
    ) -> Result<(), ReaderErrorV1> {
        let revision = self
            .revisions
            .get(&artifact.revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::ChapterLocal))?;
        if revision.artifact_ref_count == 0 {
            return Err(invalid_artifact_reference_count());
        }
        let retire_revision = revision.artifact_ref_count == 1
            && !self.retained_windows.contains(&artifact.revision_id);
        self.revisions
            .get_mut(&artifact.revision_id)
            .expect("chapter-local revision existence was checked")
            .artifact_ref_count -= 1;
        if retire_revision {
            if let Err(error) = self.retire_reader_revision(artifact.revision_id) {
                self.revisions
                    .get_mut(&artifact.revision_id)
                    .expect("failed retirement keeps the chapter-local revision")
                    .artifact_ref_count = 1;
                return Err(error);
            }
        }
        Ok(())
    }

    fn release_publication_artifact_owner(
        &mut self,
        artifact: &ReaderArtifactOwnerV1,
    ) -> Result<(), ReaderErrorV1> {
        let revision = self
            .publication_revisions
            .get(&artifact.revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
        if revision.artifact_ref_count == 0 {
            return Err(invalid_artifact_reference_count());
        }
        let retire_revision = revision.artifact_ref_count == 1
            && self.active_publication_revision_id != Some(artifact.revision_id);
        self.publication_revisions
            .get_mut(&artifact.revision_id)
            .expect("publication revision existence was checked")
            .artifact_ref_count -= 1;
        if retire_revision {
            if let Err(error) = self.retire_publication_revision(artifact.revision_id) {
                self.publication_revisions
                    .get_mut(&artifact.revision_id)
                    .expect("failed retirement keeps the publication revision")
                    .artifact_ref_count = 1;
                return Err(error);
            }
        }
        Ok(())
    }

    fn retire_reader_revision(&mut self, revision_id: u64) -> Result<(), ReaderErrorV1> {
        self.retire_reader_revision_with_mode(revision_id, false)
    }

    fn retire_reader_revision_immediately(
        &mut self,
        revision_id: u64,
    ) -> Result<(), ReaderErrorV1> {
        self.retire_reader_revision_with_mode(revision_id, true)
    }

    fn retire_reader_revision_with_mode(
        &mut self,
        revision_id: u64,
        immediate: bool,
    ) -> Result<(), ReaderErrorV1> {
        let revision = self.revisions.get(&revision_id).ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "reader revision ownership is missing during retirement",
            )
        })?;
        if revision.artifact_ref_count != 0 {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "cannot retire a reader revision with live artifacts",
            ));
        }
        let owner = revision.owner.clone();
        let previous = revision.previous_window_revision_id;
        let next = revision.next_window_revision_id;
        if immediate {
            self.document
                .release_chapter_local_revision_immediately(&owner)
                .map_err(engine_error)?;
        } else {
            self.document
                .release_chapter_local_revision(&owner)
                .map_err(engine_error)?;
        }
        self.revisions.remove(&revision_id);
        self.retained_windows
            .retain(|candidate| *candidate != revision_id);
        if let Some(previous) = previous.and_then(|id| self.revisions.get_mut(&id)) {
            if previous.next_window_revision_id == Some(revision_id) {
                previous.next_window_revision_id = None;
            }
        }
        if let Some(next) = next.and_then(|id| self.revisions.get_mut(&id)) {
            if next.previous_window_revision_id == Some(revision_id) {
                next.previous_window_revision_id = None;
                next.previous_window_evicted = true;
            }
        }
        Ok(())
    }

    fn retire_publication_revision(&mut self, revision_id: u64) -> Result<(), ReaderErrorV1> {
        let revision = self
            .publication_revisions
            .get(&revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
        if revision.artifact_ref_count != 0 {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "cannot retire a publication revision with live artifacts",
            ));
        }
        let owner = revision.owner.clone();
        let released = self
            .document
            .release_revision_at(&owner)
            .map_err(engine_error)?;
        if !released {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "publication revision owner was already released",
            ));
        }
        self.publication_revisions.remove(&revision_id);
        if self.active_publication_revision_id == Some(revision_id) {
            self.active_publication_revision_id = None;
        }
        Ok(())
    }
}

fn background_result(
    state: ReaderBackgroundStateV1,
    intent: &ReaderVisibleIntentV1,
    artifact: Option<ReaderArtifactV1>,
) -> ReaderBackgroundAdvanceV1 {
    ReaderBackgroundAdvanceV1 {
        state,
        intent_request_id: intent.accepted_request_id,
        replaces_artifact_id: intent.visible_artifact_id,
        artifact,
    }
}

fn artifact_owner(
    revision_id: u64,
    backing: ReaderRevisionBackingV1,
    local_spread_index: usize,
    artifact: &ReaderArtifactV1,
) -> ReaderArtifactOwnerV1 {
    ReaderArtifactOwnerV1 {
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
    }
}

fn publication_navigation(
    revision: &ReaderPublicationRevisionOwnerV1,
    spread_index: usize,
) -> ReaderNavigationV1 {
    let previous = if spread_index > 0 {
        ReaderAdjacentAvailabilityV1::Available
    } else {
        ReaderAdjacentAvailabilityV1::Terminal
    };
    let next_index = spread_index.checked_add(1);
    let next = if next_index.is_some_and(|index| index < revision.known_spread_count) {
        ReaderAdjacentAvailabilityV1::Available
    } else if revision.continuation.is_some() {
        ReaderAdjacentAvailabilityV1::Pending
    } else if revision.final_spread_count.is_some() {
        ReaderAdjacentAvailabilityV1::Terminal
    } else {
        ReaderAdjacentAvailabilityV1::Blocked
    };
    ReaderNavigationV1 { previous, next }
}

fn locator_precision(locator: &RuntimeSourceLocator) -> RuntimeSourceLocatorMatchedBy {
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

fn reader_navigation(
    document: &RuntimeDocument,
    revision: &ReaderRevisionOwnerV1,
    local_spread_index: usize,
) -> ReaderNavigationV1 {
    let chapter_index = revision.owner.coordinate.chapter_index;
    let previous = if local_spread_index > 0 || revision.previous_window_revision_id.is_some() {
        ReaderAdjacentAvailabilityV1::Available
    } else if revision.previous_window_evicted {
        ReaderAdjacentAvailabilityV1::Blocked
    } else if adjacent_linear_chapter(document, chapter_index, ReaderAdjacentDirectionV1::Previous)
        .is_some()
    {
        ReaderAdjacentAvailabilityV1::ChapterBoundary
    } else {
        ReaderAdjacentAvailabilityV1::Terminal
    };
    let next_index = local_spread_index.checked_add(1);
    let next = if next_index.is_some_and(|index| index < revision.known_local_spread_count) {
        ReaderAdjacentAvailabilityV1::Available
    } else if revision.next_window_revision_id.is_some()
        || revision.page_cap_reached
        || revision.continuation.is_some()
    {
        ReaderAdjacentAvailabilityV1::Pending
    } else if revision.final_local_spread_count.is_some() {
        if adjacent_linear_chapter(document, chapter_index, ReaderAdjacentDirectionV1::Next)
            .is_some()
        {
            ReaderAdjacentAvailabilityV1::ChapterBoundary
        } else {
            ReaderAdjacentAvailabilityV1::Terminal
        }
    } else {
        ReaderAdjacentAvailabilityV1::Blocked
    };
    ReaderNavigationV1 { previous, next }
}

fn adjacent_linear_chapter(
    document: &RuntimeDocument,
    chapter_index: usize,
    direction: ReaderAdjacentDirectionV1,
) -> Option<usize> {
    match direction {
        ReaderAdjacentDirectionV1::Previous => document.document().chapters[..chapter_index]
            .iter()
            .rposition(|chapter| chapter.linear),
        ReaderAdjacentDirectionV1::Next => document
            .document()
            .chapters
            .iter()
            .enumerate()
            .skip(chapter_index.checked_add(1)?)
            .find_map(|(index, chapter)| chapter.linear.then_some(index)),
    }
}

fn validate_work(work: ReaderWorkBudgetV1) -> Result<(), ReaderErrorV1> {
    if work.max_top_level_nodes_per_quantum == 0 || work.max_foreground_quanta == 0 {
        return Err(ReaderErrorV1::new(
            ReaderErrorKindV1::InvalidRequest,
            "foreground work budgets must be non-zero",
        ));
    }
    if work.local_page_cap == 0
        || work.local_page_cap
            > u32::try_from(RUNTIME_CHAPTER_LOCAL_PAGE_CAP_MAX).unwrap_or(u32::MAX)
    {
        return Err(ReaderErrorV1::new(
            ReaderErrorKindV1::InvalidRequest,
            format!("localPageCap must be within 1..={RUNTIME_CHAPTER_LOCAL_PAGE_CAP_MAX}"),
        ));
    }
    Ok(())
}

fn resolved_target(advance: &RuntimeChapterLocalRevisionAdvance) -> Option<ResolvedArtifactTarget> {
    let RuntimeChapterLocalSourceLocatorResolution::Resolved {
        owner,
        locator,
        local_page_index,
        local_spread_index,
        matched_by,
        ..
    } = &advance.target
    else {
        return None;
    };
    Some(ResolvedArtifactTarget {
        owner: ResolvedArtifactOwnerV1::ChapterLocal(owner.clone()),
        locator: locator.clone(),
        matched_by: *matched_by,
        local_page_index: *local_page_index,
        local_spread_index: *local_spread_index,
    })
}

fn owner_from_advance(
    advance: &RuntimeChapterLocalRevisionAdvance,
) -> RuntimeChapterLocalRevisionHandle {
    RuntimeChapterLocalRevisionHandle {
        revision_id: advance.revision.revision_id.clone(),
        revision_version: advance.revision.revision_version,
        coordinate: advance.revision.coordinate.clone(),
    }
}

fn take_identity(next: &mut u64, field: &str) -> Result<u64, ReaderErrorV1> {
    let value = *next;
    if value == 0 || value > READER_EXTERNAL_ID_MAX_V1 {
        return Err(numeric_overflow(field));
    }
    *next = value
        .checked_add(1)
        .ok_or_else(|| numeric_overflow(field))?;
    Ok(value)
}

fn validate_session_id(value: u64) -> Result<(), ReaderErrorV1> {
    if (1..=READER_EXTERNAL_ID_MAX_V1).contains(&value) {
        return Ok(());
    }
    Err(ReaderErrorV1::new(
        ReaderErrorKindV1::InvalidSession,
        format!("sessionId must be within 1..={READER_EXTERNAL_ID_MAX_V1}"),
    ))
}

fn validate_external_request_id(value: u64, field: &str) -> Result<(), ReaderErrorV1> {
    if (1..=READER_EXTERNAL_ID_MAX_V1).contains(&value) {
        return Ok(());
    }
    Err(ReaderErrorV1::new(
        ReaderErrorKindV1::InvalidRequest,
        format!("{field} must be within 1..={READER_EXTERNAL_ID_MAX_V1}"),
    ))
}

fn unknown_artifact(artifact_id: u64) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::UnknownArtifact,
        format!("unknown or released artifact: {artifact_id}"),
    )
}

fn missing_artifact_revision(backing: ReaderRevisionBackingV1) -> ReaderErrorV1 {
    let kind = match backing {
        ReaderRevisionBackingV1::ChapterLocal => "chapter-local",
        ReaderRevisionBackingV1::Publication => "publication",
    };
    ReaderErrorV1::new(
        ReaderErrorKindV1::EngineFailure,
        format!("{kind} artifact revision ownership is missing"),
    )
}

fn invalid_artifact_reference_count() -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::EngineFailure,
        "artifact revision reference count is invalid",
    )
}

fn stale_background_intent(expected: u64, current: u64) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::StaleRequest,
        format!(
            "background expected visible artifact {expected}, but current visible artifact is {current}"
        ),
    )
}

fn stale_foreground_intent(expected: Option<u64>, current: Option<u64>) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::StaleRequest,
        format!(
            "foreground expected visible artifact {expected:?}, but current visible artifact is {current:?}"
        ),
    )
}

fn stale_foreground_candidate(message: impl Into<String>) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::StaleRequest, message)
}

fn background_yields_to_foreground() -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::StaleRequest,
        "background work yields while foreground exact work or a candidate is pending",
    )
}

fn target_not_published(message: impl Into<String>) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::TargetNotPublished, message)
}

fn numeric_overflow(field: &str) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::NumericOverflow,
        format!("{field} exhausted"),
    )
}

fn invalid_locator(error: impl std::fmt::Display) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::InvalidLocator, error.to_string())
}

fn engine_error(error: impl std::fmt::Display) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::EngineFailure, error.to_string())
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    #[test]
    fn generated_identity_stops_after_signed_64_bit_maximum() {
        let mut next = READER_EXTERNAL_ID_MAX_V1;
        assert_eq!(
            take_identity(&mut next, "artifactId").expect("maximum identity remains valid"),
            READER_EXTERNAL_ID_MAX_V1
        );
        assert_eq!(
            take_identity(&mut next, "artifactId")
                .expect_err("next identity fails closed")
                .kind,
            ReaderErrorKindV1::NumericOverflow
        );
    }
}
