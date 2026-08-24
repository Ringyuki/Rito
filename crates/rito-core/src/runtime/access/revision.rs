use super::{RuntimeRevisionAccessError, RuntimeRevisionHandle, RuntimeVersioned};
use crate::runtime::{
    RuntimeChapterTreeReport, RuntimeDocument, RuntimeRevisionBundle, RuntimeRevisionNavigation,
    RuntimeRevisionPresentation, RuntimeRevisionSummary, RuntimeShapeProvenanceDiagnostic,
    RuntimeStyleTableSummary,
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

    pub fn revision_presentation_at(
        &self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<RuntimeVersioned<RuntimeRevisionPresentation>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, RuntimeDocument::revision_presentation)
    }

    pub fn shape_provenance_diagnostic_at(
        &self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<RuntimeVersioned<RuntimeShapeProvenanceDiagnostic>, RuntimeRevisionAccessError>
    {
        self.versioned_read(handle, |document, revision_id| {
            document.shape_provenance_diagnostic(revision_id)
        })
    }

    pub fn style_table_summary_at(
        &self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<RuntimeVersioned<RuntimeStyleTableSummary>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.style_table_summary(revision_id)
        })
    }

    pub fn chapter_tree_report_at(
        &self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<RuntimeVersioned<RuntimeChapterTreeReport>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.chapter_tree_report(revision_id)
        })
    }
}
