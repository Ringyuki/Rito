use super::{RuntimeRevisionAccessError, RuntimeRevisionHandle, RuntimeVersioned};
use crate::runtime::{
    RuntimeDocument, RuntimePageTargets, RuntimePageTextPositions, RuntimeTextRangeGeometry,
    RuntimeTextRangeGeometryRequest,
};

impl RuntimeDocument {
    pub fn get_page_targets_at(
        &self,
        handle: &RuntimeRevisionHandle,
        page_index: usize,
    ) -> Result<RuntimeVersioned<RuntimePageTargets>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.get_page_targets(revision_id, page_index)
        })
    }

    pub fn get_page_text_positions_at(
        &self,
        handle: &RuntimeRevisionHandle,
        page_index: usize,
    ) -> Result<RuntimeVersioned<RuntimePageTextPositions>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.get_page_text_positions(revision_id, page_index)
        })
    }

    pub fn get_text_range_geometry_at(
        &self,
        handle: &RuntimeRevisionHandle,
        request: RuntimeTextRangeGeometryRequest,
    ) -> Result<RuntimeVersioned<RuntimeTextRangeGeometry>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.get_text_range_geometry(revision_id, request)
        })
    }
}
