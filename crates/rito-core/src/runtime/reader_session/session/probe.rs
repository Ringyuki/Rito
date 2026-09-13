//! Test-only readers of session state used by the reader session test suites:
//! live revision and artifact counts, exact-cache and layout counters,
//! visible intent and candidate ids, and direct access to the runtime
//! document.

use crate::runtime::RuntimeDocument;

use super::{ReaderRevisionBacking, ReaderSession};

impl ReaderSession {
    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn live_revision_count(&self) -> usize {
        self.revisions.len()
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn has_live_revision(&self, revision_id: u64) -> bool {
        self.revisions.contains_key(&revision_id)
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) const fn exact_cache_hit_count(&self) -> u64 {
        self.exact_cache_hit_count
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) const fn exact_layout_quantum_count(&self) -> u64 {
        self.exact_layout_quantum_count
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn artifact_owner_backing(
        &self,
        artifact_id: u64,
    ) -> Option<(ReaderRevisionBacking, u64)> {
        self.artifacts
            .get(&artifact_id)
            .map(|owner| (owner.backing, owner.revision_id))
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn has_live_artifact(&self, artifact_id: u64) -> bool {
        self.artifacts.contains_key(&artifact_id)
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn runtime_revision_version(
        &self,
        revision_id: u64,
    ) -> Option<u32> {
        self.revisions
            .get(&revision_id)
            .map(|revision| revision.owner.revision_version)
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn set_runtime_revision_version(
        &mut self,
        revision_id: u64,
        revision_version: u32,
    ) {
        self.revisions
            .get_mut(&revision_id)
            .expect("revision owner is live")
            .owner
            .revision_version = revision_version;
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn revision_artifact_ref_count(
        &self,
        revision_id: u64,
    ) -> Option<u32> {
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
    pub(in crate::runtime::reader_session) fn has_visible_intent(&self) -> bool {
        self.visible_intent.is_some()
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn visible_artifact_id(&self) -> Option<u64> {
        self.visible_intent
            .as_ref()
            .map(|intent| intent.visible_artifact_id)
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn foreground_candidate_artifact_id(
        &self,
    ) -> Option<u64> {
        self.foreground_candidate
            .as_ref()
            .map(|candidate| candidate.candidate_artifact_id)
    }

    #[cfg(test)]
    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn publication_revision_count(&self) -> usize {
        self.publication_revisions.len()
    }

    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn publication_footnote_source_scan_count(
        &self,
    ) -> usize {
        self.document.publication_footnote_source_scan_count()
    }

    #[cfg(test)]
    #[cfg(test)]
    pub(in crate::runtime::reader_session) fn active_publication_revision_version(
        &self,
    ) -> Option<u32> {
        self.active_publication_revision_id.and_then(|revision_id| {
            self.publication_revisions
                .get(&revision_id)
                .map(|revision| revision.owner.revision_version)
        })
    }
}

#[cfg(test)]
impl ReaderSession {
    /// Test-only document access for host-metric injection cycles.
    pub(crate) fn document_for_tests(&self) -> &RuntimeDocument {
        &self.document
    }
}
