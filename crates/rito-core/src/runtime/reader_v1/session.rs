use std::collections::{BTreeMap, BTreeSet, VecDeque};

use crate::{
    layout::{LayoutConfig, LineBreaking},
    runtime::{
        RuntimeBoundedChapterLocalRevisionRequest, RuntimeBoundedRevisionRequest,
        RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionCursor,
        RuntimeChapterLocalRevisionHandle, RuntimeChapterLocalSourceLocatorResolution,
        RuntimeContinueChapterLocalRevisionRequest, RuntimeContinueRevisionRequest,
        RuntimeDocument, RuntimePageReadingAnchor, RuntimeRevision, RuntimeRevisionWorkBudget,
        RuntimeRolloverChapterLocalRevisionRequest, RuntimeSearchRequest, RuntimeSourceLocator,
        RuntimeSourceLocatorMatchedBy, RuntimeSourceLocatorResolution,
        RuntimeTextRangeGeometryRequest, RUNTIME_CHAPTER_LOCAL_PAGE_CAP_MAX,
    },
};

use super::{
    artifact::{
        build_reader_artifact_v1, published_spread_target, ArtifactIdentityV1,
        ResolvedArtifactOwnerV1, ResolvedArtifactTarget,
    },
    convert::{
        layout_config, runtime_locator, runtime_resource_kind, u32_from_usize, usize_from_u32,
    },
    publication::{
        ReaderForegroundCandidateV1, ReaderPublicationRevisionOwnerV1, ReaderRevisionBackingV1,
        ReaderVisibleIntentV1,
    },
    publication_info::build_reader_publication_v1,
    reader_resource_bytes_max_v1, ReaderAdjacentAvailabilityV1, ReaderAdjacentDirectionV1,
    ReaderAdjacentRequestV1, ReaderArtifactRequestV1, ReaderArtifactV1, ReaderBackgroundAdvanceV1,
    ReaderBackgroundHandoffAckV1, ReaderBackgroundHandoffV1, ReaderBackgroundRequestV1,
    ReaderBackgroundStateV1, ReaderDisposeAckV1, ReaderErrorKindV1, ReaderErrorV1,
    ReaderFootnoteKindV1, ReaderFootnoteV1, ReaderForegroundHandoffAckV1,
    ReaderForegroundHandoffV1, ReaderLocatorV1, ReaderNavigationV1, ReaderPublicationV1,
    ReaderRectV1, ReaderResourceKindV1, ReaderResourceV1, ReaderSearchRequestV1,
    ReaderSearchResponseV1, ReaderSearchResultV1, ReaderTextPositionV1, ReaderTextRangeGeometryV1,
    ReaderTextRangeRequestV1, ReaderTextRectV1, ReaderTextRenderingProfileV1, ReaderWorkBudgetV1,
    READER_EXTERNAL_ID_MAX_V1,
};

mod exact_cache;

// Budgeted for the peek prefetch window: visible + outgoing page-turn
// artifact + one peeked neighbor per direction + an in-flight foreground
// candidate, with one slot of slack.
pub const READER_LIVE_ARTIFACT_CAP_V1: u32 = 6;
const READER_RETAINED_WINDOW_CAP_V1: usize = 2;

#[derive(Debug, Clone)]
struct ReaderArtifactOwnerV1 {
    request_id: u64,
    revision_id: u64,
    backing: ReaderRevisionBackingV1,
    locator: ReaderLocatorV1,
    local_spread_index: usize,
    resources: Vec<(ReaderResourceKindV1, String)>,
    /// Fingerprint of the text this artifact's pages actually draw.
    ///
    /// Locators cannot answer "would the reader see something else":
    /// a chapter-local anchor and a whole-book anchor for the same page
    /// carry different progressions, so comparing them reports a move
    /// that is not one. Comparing what was drawn does answer it.
    painted_digest: u64,
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

#[derive(Debug)]
enum ReaderExactSeekAdvanceV1 {
    Resolved(RuntimeChapterLocalRevisionAdvance),
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
    // Read-only adjacent artifacts produced by `peek_adjacent`. Only these
    // may take the `commit_peeked_artifact` fast path to visibility; the
    // set keeps arbitrary live artifacts from being promoted.
    peeked_artifacts: BTreeSet<u64>,
    visible_intent: Option<ReaderVisibleIntentV1>,
    foreground_candidate: Option<ReaderForegroundCandidateV1>,
    // At most one unpublished owner survives a bounded exact seek. It never
    // receives reader revision/artifact identities until the target resolves.
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
    ) -> Result<Self, ReaderErrorV1> {
        validate_session_id(session_id)?;
        let document =
            RuntimeDocument::open_owned_with_pinned_font_policy(publication_bytes, policy)
                .map_err(engine_error)?;
        Self::from_document(session_id, document)
    }

    fn from_document(
        session_id: u64,
        mut document: RuntimeDocument,
    ) -> Result<Self, ReaderErrorV1> {
        // The fragment engine is the session's only pagination authority:
        // chapter-local revisions build their own single-chapter tables,
        // and publication (book-wide) revisions route through the
        // fragment page table as well.
        document.set_fragment_page_table_enabled(true);
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
            peeked_artifacts: BTreeSet::new(),
            visible_intent: None,
            foreground_candidate: None,
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
        // Chapter-local revisions publish complete in one pass; a
        // foreground exact seek can no longer be left pending.
        false
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
        let artifact = self.create_revision_artifact_with_locator_fallback(
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
    /// intent, never installs a candidate, and never touches pending
    /// exact-seek or adjacent continuations — the visible artifact and
    /// every in-flight navigation stay exactly as they were. Pagination
    /// MAY advance (bounded by the request's work budget, exactly like
    /// an ordinary forward turn) so the next spread is peekable without
    /// a committed navigation; pagination progress is shared revision
    /// state, not foreground state. This applies to chapter-local and
    /// publication-backed sources alike, and covers window rollover and
    /// adjacent-chapter boundaries (next peeks the following chapter's
    /// first spread, previous the preceding chapter's last). Targets
    /// still out of reach (the publication's terminal boundary, or a
    /// budget the neighbor could not be paginated within) return
    /// `TargetNotPublished`,
    /// which hosts surface as "not peekable yet". The artifact still
    /// occupies one live-artifact slot and must be released by the
    /// caller.
    pub fn peek_adjacent(
        &mut self,
        request: ReaderAdjacentRequestV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        self.validate_request_identity(request.session_id, request.request_id, "peek")?;
        validate_external_request_id(request.from_artifact_id, "fromArtifactId")?;
        validate_work(request.work)?;
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
            ReaderRevisionBackingV1::ChapterLocal => {
                self.peek_chapter_local_adjacent(source, request)?
            }
            // Publication turns already resolve their neighbor with
            // bounded cooperative pagination and no foreground effect,
            // so peeking reuses that path verbatim.
            ReaderRevisionBackingV1::Publication => self.request_publication_adjacent(
                source,
                request.request_id,
                request.direction,
                request.work,
            )?,
        };
        self.peeked_artifacts.insert(artifact.artifact_id);
        Ok(artifact)
    }

    fn peek_chapter_local_adjacent(
        &mut self,
        source: ReaderArtifactOwnerV1,
        request: ReaderAdjacentRequestV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let revision = self
            .revisions
            .get(&source.revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::ChapterLocal))?;
        if request.work.local_page_cap != revision.local_page_cap {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
                "peek request localPageCap must match the source revision",
            ));
        }
        // Reuses the foreground navigation helpers wholesale: window
        // rollover and adjacent-chapter creation are shared pagination
        // progress, exactly like in-chapter continuation. The one piece
        // of foreground state those helpers touch is the pending exact
        let result = match request.direction {
            ReaderAdjacentDirectionV1::Previous if source.local_spread_index > 0 => self
                .publish_revision_artifact(
                    source.revision_id,
                    source.local_spread_index - 1,
                    request.request_id,
                ),
            ReaderAdjacentDirectionV1::Previous => {
                self.request_previous_window_or_chapter(source, request.request_id, request.work)
            }
            ReaderAdjacentDirectionV1::Next => {
                self.request_next(source, request.request_id, request.work)
            }
        };
        result
    }

    /// Commits a previously peeked artifact as the visible foreground
    /// with a visible-artifact CAS and zero layout work.
    ///
    /// Only artifacts produced by [`Self::peek_adjacent`] qualify. A
    /// successful commit supersedes any in-flight foreground intent
    /// (candidate, pending exact seek, pending adjacent), exactly as a
    /// fresh foreground navigation would.
    pub fn commit_peeked_artifact(
        &mut self,
        request: ReaderForegroundHandoffV1,
    ) -> Result<ReaderForegroundHandoffAckV1, ReaderErrorV1> {
        self.validate_foreground_handoff_request(request)?;
        if !self
            .peeked_artifacts
            .contains(&request.candidate_artifact_id)
        {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
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
            ReaderRevisionBackingV1::ChapterLocal => self
                .revisions
                .get(&owner.revision_id)
                .map(|revision| revision.layout.clone()),
            ReaderRevisionBackingV1::Publication => self
                .publication_revisions
                .get(&owner.revision_id)
                .map(|revision| revision.layout.clone()),
        }
        .ok_or_else(|| missing_artifact_revision(owner.backing))?;
        let locator = runtime_locator(owner.locator.clone())?;
        self.foreground_candidate = None;
        self.release_pending_adjacent()?;
        self.visible_intent = Some(ReaderVisibleIntentV1 {
            accepted_request_id: owner.request_id,
            visible_artifact_id: request.candidate_artifact_id,
            locator,
            layout,
            pending_handoff_artifact_id: None,
        });
        self.peeked_artifacts.remove(&request.candidate_artifact_id);
        Ok(ReaderForegroundHandoffAckV1 {
            intent_request_id: owner.request_id,
            replaced_artifact_id: current_visible_artifact_id,
            visible_artifact_id: request.candidate_artifact_id,
        })
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
    ) -> Result<ReaderFootnoteV1, ReaderErrorV1> {
        validate_external_request_id(artifact_id, "artifactId")?;
        if key.is_empty() {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
                "footnote key must not be empty",
            ));
        }
        let artifact = self
            .artifacts
            .get(&artifact_id)
            .cloned()
            .ok_or_else(|| unknown_artifact(artifact_id))?;
        let entry = match artifact.backing {
            ReaderRevisionBackingV1::ChapterLocal => {
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
            ReaderRevisionBackingV1::Publication => {
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
        Ok(ReaderFootnoteV1 {
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
        request: ReaderSearchRequestV1,
    ) -> Result<ReaderSearchResponseV1, ReaderErrorV1> {
        if request.session_id != self.session_id {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidSession,
                "search request belongs to a different session",
            ));
        }
        validate_external_request_id(request.artifact_id, "artifactId")?;
        if request.query.is_empty() {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
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
        let (response, searched_page_count, scope_complete) = match artifact.backing {
            ReaderRevisionBackingV1::ChapterLocal => {
                let owner = self
                    .revisions
                    .get(&artifact.revision_id)
                    .map(|revision| revision.owner.clone())
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                let revision = self
                    .document
                    .require_chapter_local_owner(&owner)
                    .map_err(engine_error)?;
                let scope = revision_search_scope(revision)?;
                (
                    crate::runtime::search::search_revision(
                        self.document.document(),
                        &owner.revision_id,
                        revision,
                        runtime_request,
                    ),
                    scope.0,
                    scope.1,
                )
            }
            ReaderRevisionBackingV1::Publication => {
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
                let scope = revision_search_scope(revision)?;
                (
                    crate::runtime::search::search_revision(
                        self.document.document(),
                        &owner.revision_id,
                        revision,
                        runtime_request,
                    ),
                    scope.0,
                    scope.1,
                )
            }
        };
        let cap = usize_from_u32(request.limit, "search limit")?;
        let truncated = cap > 0 && response.results.len() > cap;
        let mut results = response.results;
        if truncated {
            results.truncate(cap);
        }
        Ok(ReaderSearchResponseV1 {
            artifact_id: request.artifact_id,
            query: request.query,
            truncated,
            searched_page_count,
            scope_complete,
            results: results
                .into_iter()
                .map(reader_search_result)
                .collect::<Result<Vec<_>, ReaderErrorV1>>()?,
        })
    }

    /// Resolves where a text range sits on one of an artifact's pages.
    ///
    /// The returned rects are in the artifact's display-list space, the
    /// same space [`ReaderHitEntryV1::bounds`] uses, so a host paints
    /// them directly onto the surface it drew the page on. `page_index`
    /// is one the artifact published (`ReaderPageV1::page_index`), and
    /// the positions are the ones its `text_runs` describe — anchoring
    /// a highlight to source text instead of to remembered pixels.
    pub fn get_text_range_geometry(
        &mut self,
        request: ReaderTextRangeRequestV1,
    ) -> Result<ReaderTextRangeGeometryV1, ReaderErrorV1> {
        if request.session_id != self.session_id {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidSession,
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
            ReaderRevisionBackingV1::ChapterLocal => {
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
            ReaderRevisionBackingV1::Publication => {
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
        Ok(ReaderTextRangeGeometryV1 {
            artifact_id: request.artifact_id,
            page_index: request.page_index,
            rects: geometry
                .rects
                .into_iter()
                .map(|rect| {
                    Ok(ReaderTextRectV1 {
                        bounds: ReaderRectV1 {
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
                .collect::<Result<Vec<_>, ReaderErrorV1>>()?,
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

    pub fn dispose(mut self) -> Result<ReaderDisposeAckV1, ReaderErrorV1> {
        let released_artifacts = self.dispose_owned_state()?;
        Ok(ReaderDisposeAckV1 {
            session_id: self.session_id,
            released_artifacts,
        })
    }

    fn dispose_owned_state(&mut self) -> Result<u32, ReaderErrorV1> {
        self.release_pending_adjacent()?;
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
                    // Pagination just finished. Every artifact minted
                    // before this point predates the final extent and so
                    // carries no book page count; offer one last
                    // candidate for the same visible locator so a reader
                    // who never turns a page still learns the total.
                    let completion_candidate =
                        self.take_completion_handoff(revision_id, &intent)?;
                    let moves = completion_candidate.as_ref().is_some_and(|candidate| {
                        self.handoff_moves_visible_content(intent.visible_artifact_id, candidate)
                    });
                    return Ok(background_result_with_move(
                        ReaderBackgroundStateV1::Complete,
                        &intent,
                        completion_candidate,
                        moves,
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
        let moves = artifact.as_ref().is_some_and(|candidate| {
            self.handoff_moves_visible_content(intent.visible_artifact_id, candidate)
        });
        Ok(background_result_with_move(state, &intent, artifact, moves))
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
        if self.foreground_candidate.is_some() || self.pending_adjacent.is_some() {
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
            ReaderPublicationRevisionOwnerV1::from_advance(advance, layout),
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

    /// Offers the single post-completion candidate, or `None` when the
    /// visible artifact already carries the final numbers, when it was
    /// already offered, or when the session cannot hold another live
    /// artifact. Never fails the background step: a missing total is a
    /// missing affordance, not a broken reader.
    fn take_completion_handoff(
        &mut self,
        revision_id: u64,
        intent: &ReaderVisibleIntentV1,
    ) -> Result<Option<ReaderArtifactV1>, ReaderErrorV1> {
        let offered = self
            .publication_revisions
            .get(&revision_id)
            .is_none_or(|revision| {
                revision.completion_handoff_offered || revision.final_spread_count.is_none()
            });
        if offered {
            return Ok(None);
        }
        let visible_is_current_publication = self
            .artifacts
            .get(&intent.visible_artifact_id)
            .is_some_and(|artifact| {
                artifact.backing == ReaderRevisionBackingV1::Publication
                    && artifact.revision_id == revision_id
            });
        if !visible_is_current_publication || self.require_artifact_capacity().is_err() {
            return Ok(None);
        }
        // Republish the spread the reader is already on. Re-resolving
        // the original locator would be a second navigation decision at
        // the worst possible moment: `intent.locator` still names where
        // the reader entered the book, not where they are now, so a
        // completed layout can resolve it somewhere else entirely and
        // this handoff — whose whole job is to deliver a page count —
        // would move them.
        let Some(spread_index) = self
            .artifacts
            .get(&intent.visible_artifact_id)
            .map(|visible| visible.local_spread_index)
        else {
            return Ok(None);
        };
        let candidate = match self.publish_publication_artifact(
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
        if let Some(revision) = self.publication_revisions.get_mut(&revision_id) {
            revision.completion_handoff_offered = true;
        }
        if let Some(current) = self.visible_intent.as_mut() {
            current.pending_handoff_artifact_id = Some(candidate.artifact_id);
        }
        Ok(Some(candidate))
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
        // Content keeps flowing into the last laid-out spread, so a
        // position resolved onto it is not yet where it will end up.
        // Minting a candidate there hands the host a page that moves
        // under it once layout continues; waiting costs a few quanta
        // and makes the handoff a pure renumbering.
        if !self.publication_spread_is_sealed(revision_id, spread_index) {
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

    /// Whether a spread's composition is final.
    ///
    /// Only the frontier spread of an unfinished layout can still take
    /// more content; anything with a spread after it is sealed, as is
    /// every spread once the layout completes.
    fn publication_spread_is_sealed(&self, revision_id: u64, spread_index: usize) -> bool {
        self.publication_revisions
            .get(&revision_id)
            .is_some_and(|revision| {
                revision.final_spread_count.is_some()
                    || spread_index + 1 < revision.known_spread_count
            })
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
    #[cfg(test)]
    #[cfg(test)]
    #[cfg(test)]
    #[cfg(test)]
    #[cfg(test)]
    #[cfg(test)]
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
    #[cfg(test)]
    pub(super) fn publication_revision_count(&self) -> usize {
        self.publication_revisions.len()
    }

    #[cfg(test)]
    pub(super) fn publication_footnote_source_scan_count(&self) -> usize {
        self.document.publication_footnote_source_scan_count()
    }

    #[cfg(test)]
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
                        max_quanta: None,
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

    /// An open request's locator is persisted host data: the book file may
    /// have changed since the position was saved, or the position may have
    /// been recorded against content that no longer lays out (a saved
    /// point on a broken-image placeholder's alt run carries the image's
    /// node path, which owns no text). A selector that fails to resolve
    /// degrades to the locator's coarser keys — progression, then the
    /// chapter itself — instead of refusing to open the book; the
    /// artifact's `matched_by` reports what actually resolved. Href
    /// failures stay hard: a missing resource is an error the host must
    /// see, not a place to guess.
    fn create_revision_artifact_with_locator_fallback(
        &mut self,
        request_id: u64,
        layout: LayoutConfig,
        locator: RuntimeSourceLocator,
        work: ReaderWorkBudgetV1,
    ) -> Result<ReaderArtifactV1, ReaderErrorV1> {
        let mut attempt = locator;
        loop {
            let error = match self.create_revision_artifact(
                request_id,
                layout.clone(),
                attempt.clone(),
                work,
            ) {
                Ok(artifact) => return Ok(artifact),
                Err(error) => error,
            };
            if error.kind != ReaderErrorKindV1::InvalidLocator {
                return Err(error);
            }
            if attempt.source_point.is_some()
                || attempt.source_range.is_some()
                || attempt.anchor_id.is_some()
            {
                attempt.source_point = None;
                attempt.source_range = None;
                attempt.anchor_id = None;
            } else if attempt.progression.is_some() {
                attempt.progression = None;
            } else {
                return Err(error);
            }
        }
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
        let advance = self.start_exact_seek(
            chapter_index,
            layout.clone(),
            canonical_locator.clone(),
            work,
            budget,
        )?;
        let ReaderExactSeekAdvanceV1::Resolved(advance) =
            self.advance_until_target(advance, work.max_foreground_quanta, budget)?;
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
                max_quanta: None,
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
        advance: RuntimeChapterLocalRevisionAdvance,
        _max_additional_quanta: u32,
        _budget: RuntimeRevisionWorkBudget,
    ) -> Result<ReaderExactSeekAdvanceV1, ReaderErrorV1> {
        // Chapter-local revisions publish complete in one pass, so the
        // advance either already resolved its target or never will:
        // there is no continuation to drive.
        if resolved_target(&advance).is_some() {
            return Ok(ReaderExactSeekAdvanceV1::Resolved(advance));
        }
        self.release_unresolvable_advance(advance)
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

    fn release_pending_adjacent(&mut self) -> Result<(), ReaderErrorV1> {
        let Some(pending) = self.pending_adjacent.take() else {
            return Ok(());
        };
        let _ = pending;
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
        painted_digest: painted_digest(artifact),
    }
}

fn painted_digest(artifact: &ReaderArtifactV1) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for page in &artifact.pages {
        page.text.hash(&mut hasher);
        page.text_length.hash(&mut hasher);
    }
    hasher.finish()
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

const fn reader_footnote_kind(kind: crate::interaction::FootnoteKind) -> ReaderFootnoteKindV1 {
    match kind {
        crate::interaction::FootnoteKind::Footnote => ReaderFootnoteKindV1::Footnote,
        crate::interaction::FootnoteKind::Endnote => ReaderFootnoteKindV1::Endnote,
        crate::interaction::FootnoteKind::Rearnote => ReaderFootnoteKindV1::Rearnote,
        crate::interaction::FootnoteKind::Note => ReaderFootnoteKindV1::Note,
    }
}

/// Display-list origin of the page slot holding `page_index` inside the
/// artifact's spread, so geometry lands where the pen painted.
fn page_display_origin(
    revision: &RuntimeRevision,
    spread_index: usize,
    page_index: usize,
) -> Result<(f64, f64), ReaderErrorV1> {
    let frame = revision
        .chapter_engine_session()
        .frame(spread_index)
        .ok_or_else(|| target_not_published("artifact spread is not published"))?;
    let slot = frame
        .page_indexes
        .iter()
        .position(|index| *index == page_index)
        .ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
                format!("page {page_index} is not part of this artifact"),
            )
        })?;
    Ok(super::artifact::page_origin(&revision.layout_config, slot))
}

fn runtime_text_position(
    value: ReaderTextPositionV1,
) -> Result<crate::layout::SearchTextPosition, ReaderErrorV1> {
    Ok(crate::layout::SearchTextPosition {
        block_index: usize_from_u32(value.block_index, "text position block index")?,
        line_index: usize_from_u32(value.line_index, "text position line index")?,
        run_index: usize_from_u32(value.run_index, "text position run index")?,
        char_index: usize_from_u32(value.char_index, "text position char index")?,
    })
}

fn reader_search_result(
    value: crate::runtime::RuntimeSearchResult,
) -> Result<ReaderSearchResultV1, ReaderErrorV1> {
    let locator = match value.source {
        crate::runtime::RuntimeSearchSource::Resolved { href, source_range } => {
            Some(super::convert::reader_locator(RuntimeSourceLocator {
                href,
                anchor_id: None,
                source_point: None,
                source_range: Some(source_range),
                progression: None,
            })?)
        }
        crate::runtime::RuntimeSearchSource::Unavailable { .. } => None,
    };
    Ok(ReaderSearchResultV1 {
        page_index: u32_from_usize(value.page_index, "search page index")?,
        spread_index: u32_from_usize(value.spread_index, "search spread index")?,
        start: reader_text_position(value.match_range.start)?,
        end: reader_text_position(value.match_range.end)?,
        context: value.match_range.context,
        locator,
    })
}

fn reader_text_position(
    value: crate::layout::SearchTextPosition,
) -> Result<ReaderTextPositionV1, ReaderErrorV1> {
    Ok(ReaderTextPositionV1 {
        block_index: u32_from_usize(value.block_index, "text position block index")?,
        line_index: u32_from_usize(value.line_index, "text position line index")?,
        run_index: u32_from_usize(value.run_index, "text position run index")?,
        char_index: u32_from_usize(value.char_index, "text position char index")?,
    })
}

/// How much of the book a search over this revision could see: the
/// pages laid out so far, and whether that is now all of them.
fn revision_search_scope(revision: &RuntimeRevision) -> Result<(u32, bool), ReaderErrorV1> {
    Ok((
        u32_from_usize(revision.known_extent.page_count, "searched page count")?,
        revision.final_extent.is_some(),
    ))
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
