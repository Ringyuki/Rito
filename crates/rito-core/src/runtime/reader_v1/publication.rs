use crate::{
    layout::LayoutConfig,
    runtime::{
        RuntimeRevisionAdvance, RuntimeRevisionCursor, RuntimeRevisionHandle, RuntimeSourceLocator,
    },
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
    pub(super) reader_revision_id: u64,
    pub(super) owner: RuntimeRevisionHandle,
    pub(super) continuation: Option<RuntimeRevisionCursor>,
    pub(super) layout: LayoutConfig,
    pub(super) known_spread_count: usize,
    pub(super) final_spread_count: Option<usize>,
    pub(super) artifact_ref_count: u32,
}

impl ReaderPublicationRevisionOwnerV1 {
    pub(super) fn from_advance(
        reader_revision_id: u64,
        advance: RuntimeRevisionAdvance,
        layout: LayoutConfig,
    ) -> Self {
        Self {
            reader_revision_id,
            owner: RuntimeRevisionHandle::from(&advance.revision),
            continuation: advance.continuation,
            layout,
            known_spread_count: advance.revision.known_extent.spread_count,
            final_spread_count: advance
                .revision
                .final_extent
                .map(|extent| extent.spread_count),
            artifact_ref_count: 0,
        }
    }

    pub(super) fn apply_advance(&mut self, advance: RuntimeRevisionAdvance) {
        self.owner = RuntimeRevisionHandle::from(&advance.revision);
        self.continuation = advance.continuation;
        self.known_spread_count = advance.revision.known_extent.spread_count;
        self.final_spread_count = advance
            .revision
            .final_extent
            .map(|extent| extent.spread_count);
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
