use std::collections::{BTreeMap, BTreeSet};

use crate::{
    layout::LayoutConfig,
    runtime::{
        RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionHandle, RuntimeDocument,
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
    ReaderTextRangeRequestV1, ReaderTextRectV1, ReaderTextRenderingProfileV1,
    READER_EXTERNAL_ID_MAX_V1,
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

use project::owner_from_advance;

// Budgeted for the peek prefetch window: visible + outgoing page-turn
// artifact + one peeked neighbor per direction + an in-flight foreground
// candidate, with one slot of slack.
pub const READER_LIVE_ARTIFACT_CAP_V1: u32 = 6;

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
    layout: LayoutConfig,
    known_local_spread_count: usize,
    final_local_spread_count: Option<usize>,
    artifact_ref_count: u32,
}

#[derive(Debug, Clone, Copy)]
struct ReaderPendingAdjacentV1 {
    from_artifact_id: u64,
    direction: ReaderAdjacentDirectionV1,
}

impl ReaderPendingAdjacentV1 {
    fn matches(&self, request: &ReaderAdjacentRequestV1) -> bool {
        self.from_artifact_id == request.from_artifact_id && self.direction == request.direction
    }
}

impl ReaderRevisionOwnerV1 {
    fn from_advance(
        advance: RuntimeChapterLocalRevisionAdvance,
        layout: LayoutConfig,
        artifact_ref_count: u32,
    ) -> Self {
        Self {
            owner: owner_from_advance(&advance),
            layout,
            known_local_spread_count: advance.revision.known_extent.local_spread_count,
            final_local_spread_count: advance
                .revision
                .final_extent
                .map(|extent| extent.local_spread_count),
            artifact_ref_count,
        }
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
    // Read-only adjacent artifacts produced by `peek_adjacent`. Only these
    // may take the `commit_peeked_artifact` fast path to visibility; the
    // set keeps arbitrary live artifacts from being promoted.
    peeked_artifacts: BTreeSet<u64>,
    visible_intent: Option<ReaderVisibleIntentV1>,
    foreground_candidate: Option<ReaderForegroundCandidateV1>,
    // At most one adjacent turn stays retained after `TargetNotPublished`;
    // a newer request with the same source artifact and direction resumes it.
    pending_adjacent: Option<ReaderPendingAdjacentV1>,
    /// Device pixels per CSS pixel the host rasterizes artifacts at; paint
    /// snaps land on that grid. Pagination never reads it.
    render_ratio: f64,
    #[cfg(test)]
    exact_cache_hit_count: u64,
    #[cfg(test)]
    exact_layout_quantum_count: u64,
}

impl ReaderSessionV1 {
    /// Sets the device pixels per CSS pixel the host rasterizes at. Every
    /// raster snap in the display list lands on that grid; pagination is
    /// identical at every ratio. Artifacts requested after the change
    /// carry the new ratio, earlier ones keep theirs — a host re-requests
    /// what it shows.
    pub fn set_render_ratio(&mut self, ratio: f64) -> Result<(), ReaderErrorV1> {
        if !ratio.is_finite() || ratio <= 0.0 {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidRequest,
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
