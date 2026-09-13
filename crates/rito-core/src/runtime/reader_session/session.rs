use std::collections::{BTreeMap, BTreeSet};

use crate::{
    layout::LayoutConfig,
    runtime::{
        RuntimeChapterLocalRevisionHandle, RuntimeCreatedChapterLocalRevision, RuntimeDocument,
    },
};

use super::{
    artifact::{
        build_reader_artifact, published_spread_target, ArtifactIdentity, ResolvedArtifactOwner,
        ResolvedArtifactTarget,
    },
    convert::{
        layout_config, runtime_locator, runtime_resource_kind, u32_from_usize, usize_from_u32,
    },
    publication::{
        ReaderForegroundCandidate, ReaderPublicationRevisionOwner, ReaderRevisionBacking,
        ReaderVisibleIntent,
    },
    publication_info::build_reader_publication,
    reader_resource_bytes_max, ReaderAdjacentAvailability, ReaderAdjacentDirection,
    ReaderAdjacentRequest, ReaderArtifact, ReaderArtifactRequest, ReaderBackgroundAdvance,
    ReaderBackgroundHandoff, ReaderBackgroundHandoffAck, ReaderBackgroundRequest,
    ReaderBackgroundState, ReaderDisposeAck, ReaderError, ReaderErrorKind, ReaderFootnote,
    ReaderFootnoteKind, ReaderForegroundHandoff, ReaderForegroundHandoffAck, ReaderLocator,
    ReaderNavigation, ReaderPublication, ReaderRect, ReaderResource, ReaderResourceKind,
    ReaderSearchRequest, ReaderSearchResponse, ReaderSearchResult, ReaderTextPosition,
    ReaderTextRangeGeometry, ReaderTextRangeRequest, ReaderTextRect, ReaderTextRenderingProfile,
    READER_EXTERNAL_ID_MAX,
};

mod content;
mod errors;
mod exact_cache;
mod handoff;
mod navigate;
mod open;
#[cfg(test)]
mod probe;
mod project;
mod publication_pipeline;
mod publish;
mod request;
mod retire;

use project::owner_from_created;

// Budgeted for the peek prefetch window: visible + outgoing page-turn
// artifact + one peeked neighbor per direction + an in-flight foreground
// candidate, with one slot of slack.
pub const READER_LIVE_ARTIFACT_CAP: u32 = 6;

#[derive(Debug, Clone)]
struct ReaderArtifactOwner {
    request_id: u64,
    revision_id: u64,
    backing: ReaderRevisionBacking,
    locator: ReaderLocator,
    local_spread_index: usize,
    resources: Vec<(ReaderResourceKind, String)>,
    /// Fingerprint of the text this artifact's pages actually draw.
    ///
    /// Locators cannot answer "would the reader see something else":
    /// a chapter-local anchor and a whole-book anchor for the same page
    /// carry different progressions, so comparing them reports a move
    /// that is not one. Comparing what was drawn does answer it.
    painted_digest: u64,
}

#[derive(Debug)]
struct ReaderRevisionOwner {
    owner: RuntimeChapterLocalRevisionHandle,
    layout: LayoutConfig,
    local_spread_count: usize,
    artifact_ref_count: u32,
}

#[derive(Debug, Clone, Copy)]
struct ReaderPendingAdjacent {
    from_artifact_id: u64,
    direction: ReaderAdjacentDirection,
}

impl ReaderPendingAdjacent {
    fn matches(&self, request: &ReaderAdjacentRequest) -> bool {
        self.from_artifact_id == request.from_artifact_id && self.direction == request.direction
    }
}

impl ReaderRevisionOwner {
    fn from_created(
        created: &RuntimeCreatedChapterLocalRevision,
        layout: LayoutConfig,
        artifact_ref_count: u32,
    ) -> Self {
        Self {
            owner: owner_from_created(created),
            layout,
            local_spread_count: created.revision.local_spread_count,
            artifact_ref_count,
        }
    }
}

#[derive(Debug)]
pub struct ReaderSession {
    session_id: u64,
    document: RuntimeDocument,
    publication: ReaderPublication,
    latest_request_id: u64,
    next_revision_id: u64,
    next_artifact_id: u64,
    revisions: BTreeMap<u64, ReaderRevisionOwner>,
    publication_revisions: BTreeMap<u64, ReaderPublicationRevisionOwner>,
    active_publication_revision_id: Option<u64>,
    artifacts: BTreeMap<u64, ReaderArtifactOwner>,
    released_artifacts: BTreeSet<u64>,
    // Read-only adjacent artifacts produced by `peek_adjacent`. Only these
    // may take the `commit_peeked_artifact` fast path to visibility; the
    // set keeps arbitrary live artifacts from being promoted.
    peeked_artifacts: BTreeSet<u64>,
    visible_intent: Option<ReaderVisibleIntent>,
    foreground_candidate: Option<ReaderForegroundCandidate>,
    // At most one adjacent turn stays retained after `TargetNotPublished`;
    // a newer request with the same source artifact and direction resumes it.
    pending_adjacent: Option<ReaderPendingAdjacent>,
    /// Device pixels per CSS pixel the host rasterizes artifacts at; paint
    /// snaps land on that grid. Pagination never reads it.
    render_ratio: f64,
    #[cfg(test)]
    exact_cache_hit_count: u64,
    #[cfg(test)]
    exact_layout_quantum_count: u64,
}

impl ReaderSession {
    /// Sets the device pixels per CSS pixel the host rasterizes at. Every
    /// raster snap in the display list lands on that grid; pagination is
    /// identical at every ratio. Artifacts requested after the change
    /// carry the new ratio, earlier ones keep theirs — a host re-requests
    /// what it shows.
    pub fn set_render_ratio(&mut self, ratio: f64) -> Result<(), ReaderError> {
        if !ratio.is_finite() || ratio <= 0.0 {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidRequest,
                format!("render ratio must be finite and positive, got {ratio}"),
            ));
        }
        self.render_ratio = ratio;
        Ok(())
    }

    /// The ratio artifacts are currently painted at.
    pub fn render_ratio(&self) -> f64 {
        self.render_ratio
    }
}
