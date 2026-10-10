use crate::{
    layout::LayoutConfig,
    runtime::{RuntimeDocument, RuntimeRevisionError, RuntimeRevisionSummary},
};

use super::error::engine_error;

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
}
