use crate::runtime::{
    frame::revision_summary, metadata::layout_key, RuntimeBoundedRevisionRequest, RuntimeDocument,
    RuntimeRevisionError, RuntimeRevisionErrorKind, RuntimeRevisionSummary,
};

use super::error::{engine_error, revision_error, unknown_revision};

impl RuntimeDocument {
    /// Creates a whole-book revision through the request protocol hosts
    /// drive; the book paginates in one step and the summary describes
    /// the complete page table.
    pub fn create_bounded_revision(
        &mut self,
        request: RuntimeBoundedRevisionRequest,
    ) -> Result<RuntimeRevisionSummary, RuntimeRevisionError> {
        self.create_revision(&request.layout_config)
            .map_err(|error| {
                revision_error(
                    RuntimeRevisionErrorKind::EngineFailure,
                    error.message().to_owned(),
                )
            })
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
