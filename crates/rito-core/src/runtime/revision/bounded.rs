use crate::runtime::{
    frame::revision_summary, metadata::layout_key, RuntimeBoundedRevisionRequest, RuntimeDocument,
    RuntimeRevisionAdvance, RuntimeRevisionError, RuntimeRevisionErrorKind,
    RuntimeRevisionPageRange, RuntimeRevisionSummary,
};

use super::error::{engine_error, revision_error, unknown_revision};

impl RuntimeDocument {
    /// Creates a whole-book revision through the request/advance protocol
    /// hosts drive. The book paginates in one step, so the advance arrives
    /// complete: its page range is the whole table.
    pub fn create_bounded_revision(
        &mut self,
        request: RuntimeBoundedRevisionRequest,
    ) -> Result<RuntimeRevisionAdvance, RuntimeRevisionError> {
        let summary = self
            .create_revision_with_line_breaking(&request.layout_config, request.line_breaking)
            .map_err(|error| {
                revision_error(
                    RuntimeRevisionErrorKind::EngineFailure,
                    error.message().to_owned(),
                )
            })?;
        Ok(RuntimeRevisionAdvance {
            newly_known_pages: RuntimeRevisionPageRange {
                start_page: 0,
                end_page_exclusive: summary.known_extent.page_count,
            },
            revision: summary,
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
