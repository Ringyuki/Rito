use crate::{
    layout::LayoutConfig,
    runtime::{RuntimeRevisionAdvance, RuntimeRevisionHandle, RuntimeSourceLocator},
};

use super::ReaderLocatorV1;

/// Engine backing for an artifact-owned reader revision.
///
/// The protocol identity stays reader-owned; engine handles never cross the
/// reader boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ReaderRevisionBackingV1 {
    ChapterLocal,
    Publication,
}

#[derive(Debug)]
pub(super) struct ReaderPublicationRevisionOwnerV1 {
    pub(super) owner: RuntimeRevisionHandle,
    pub(super) layout: LayoutConfig,
    pub(super) known_spread_count: usize,
    pub(super) final_spread_count: Option<usize>,
    pub(super) artifact_ref_count: u32,
    /// Whether the one completion candidate has been offered. Artifacts
    /// minted before the whole-book layout finished carry no book page
    /// count, so a reader who never turns a page would never learn the
    /// total; completion offers one final candidate through the same
    /// handoff channel, exactly once.
    pub(super) completion_handoff_offered: bool,
}

impl ReaderPublicationRevisionOwnerV1 {
    pub(super) fn from_advance(advance: RuntimeRevisionAdvance, layout: LayoutConfig) -> Self {
        Self {
            owner: RuntimeRevisionHandle::from(&advance.revision),
            layout,
            known_spread_count: advance.revision.known_extent.spread_count,
            final_spread_count: advance
                .revision
                .final_extent
                .map(|extent| extent.spread_count),
            artifact_ref_count: 0,
            completion_handoff_offered: false,
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct ReaderVisibleIntentV1 {
    pub(super) accepted_request_id: u64,
    pub(super) visible_artifact_id: u64,
    pub(super) locator: RuntimeSourceLocator,
    pub(super) layout: LayoutConfig,
    pub(super) pending_handoff_artifact_id: Option<u64>,
}

/// One live foreground result waiting for a host-owned visibility commit.
///
/// All fields are retained independently from the public artifact so the
/// adoption boundary can reject stale or internally inconsistent ownership
/// without mutating the current visible intent.
#[derive(Debug, Clone)]
pub(super) struct ReaderForegroundCandidateV1 {
    pub(super) accepted_request_id: u64,
    pub(super) expected_visible_artifact_id: Option<u64>,
    pub(super) candidate_artifact_id: u64,
    pub(super) revision_id: u64,
    pub(super) locator: ReaderLocatorV1,
    pub(super) layout: LayoutConfig,
}
