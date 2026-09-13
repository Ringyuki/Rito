use crate::{
    layout::LayoutConfig,
    runtime::{
        frame::revision_summary, metadata::layout_key, RuntimeDocument, RuntimeRevisionError,
        RuntimeRevisionSummary,
    },
};

use super::error::{engine_error, unknown_revision};

impl RuntimeDocument {
    /// Creates a whole-book revision: the book paginates in one step and
    /// the summary describes the complete page table.
    ///
    /// The first call scans every spine XHTML source once to establish
    /// exact publication-wide footnote targets and definitions. The scan
    /// is cached and does not mark lazy chapters or binary resources as
    /// loaded. Malformed XHTML contributes no footnote data, matching
    /// eager preparation.
    pub fn create_revision(
        &mut self,
        layout_config: &LayoutConfig,
    ) -> Result<RuntimeRevisionSummary, RuntimeRevisionError> {
        self.build_revision(layout_config).map_err(engine_error)
    }

    pub fn get_revision_summary(
        &self,
        revision_id: &str,
    ) -> Result<RuntimeRevisionSummary, RuntimeRevisionError> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| unknown_revision(revision_id))?;
        let key =
            layout_key(&revision.layout_config, &self.pinned_font_policy).map_err(engine_error)?;
        Ok(revision_summary(revision_id, &key, revision))
    }
}
