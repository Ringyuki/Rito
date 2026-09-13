use crate::{
    layout::LayoutConfig,
    runtime::{RuntimeRevisionHandle, RuntimeRevisionSummary, RuntimeSourceLocator},
};

use super::ReaderLocator;

/// Engine backing for an artifact-owned reader revision.
///
/// The protocol identity stays reader-owned; engine handles never cross the
/// reader boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ReaderRevisionBacking {
    ChapterLocal,
    Publication,
}

#[derive(Debug)]
pub(super) struct ReaderPublicationRevisionOwner {
    pub(super) owner: RuntimeRevisionHandle,
    pub(super) layout: LayoutConfig,
    pub(super) spread_count: usize,
    pub(super) artifact_ref_count: u32,
}

impl ReaderPublicationRevisionOwner {
    pub(super) fn from_summary(summary: &RuntimeRevisionSummary, layout: LayoutConfig) -> Self {
        Self {
            owner: RuntimeRevisionHandle::from(summary),
            layout,
            spread_count: summary.spread_count,
            artifact_ref_count: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct ReaderVisibleIntent {
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
pub(super) struct ReaderForegroundCandidate {
    pub(super) accepted_request_id: u64,
    pub(super) expected_visible_artifact_id: Option<u64>,
    pub(super) candidate_artifact_id: u64,
    pub(super) revision_id: u64,
    pub(super) locator: ReaderLocator,
    pub(super) layout: LayoutConfig,
}
