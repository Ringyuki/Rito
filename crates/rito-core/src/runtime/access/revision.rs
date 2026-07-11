use super::{RuntimeRevisionAccessError, RuntimeRevisionHandle, RuntimeVersioned};
use crate::runtime::{
    RuntimeDocument, RuntimeRevisionBundle, RuntimeRevisionNavigation, RuntimeRevisionSummary,
};

impl RuntimeDocument {
    pub fn get_revision_summary_at(
        &self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<RuntimeVersioned<RuntimeRevisionSummary>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, RuntimeDocument::get_revision_summary)
    }

    pub fn revision_bundle_at(
        &self,
        handle: &RuntimeRevisionHandle,
        include_toc_targets: bool,
    ) -> Result<RuntimeVersioned<RuntimeRevisionBundle>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.revision_bundle(revision_id, include_toc_targets)
        })
    }

    pub fn revision_navigation_at(
        &self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<RuntimeVersioned<RuntimeRevisionNavigation>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document
                .revision_bundle_navigation(revision_id, false)
                .map(|(_, navigation, _)| navigation)
        })
    }
}
