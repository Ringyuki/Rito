use super::{RuntimeRevisionAccessError, RuntimeRevisionHandle, RuntimeVersioned};
use crate::runtime::{
    RuntimeDocument, RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResponse,
    RuntimePageSemantics, RuntimePageTargets, RuntimePageTextPositions, RuntimeTextCaretResponse,
    RuntimeTextPointRequest, RuntimeTextRangeGeometry, RuntimeTextRangeGeometryRequest,
    RuntimeTextRangeRequest, RuntimeTextRangeResponse,
};

impl RuntimeDocument {
    pub fn resolve_exact_source_range_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        request: RuntimeExactSourceRangeRequest,
    ) -> Result<RuntimeVersioned<RuntimeExactSourceRangeResponse>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, revision_id| {
            document.resolve_exact_source_range_for_revision(revision_id, request)
        })
    }

    pub fn get_page_targets_at(
        &self,
        handle: &RuntimeRevisionHandle,
        page_index: usize,
    ) -> Result<RuntimeVersioned<RuntimePageTargets>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.get_page_targets(revision_id, page_index)
        })
    }

    pub fn get_page_semantics_at(
        &self,
        handle: &RuntimeRevisionHandle,
        page_index: usize,
    ) -> Result<RuntimeVersioned<RuntimePageSemantics>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.get_page_semantics(revision_id, page_index)
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

    pub fn resolve_text_caret_at(
        &self,
        handle: &RuntimeRevisionHandle,
        request: RuntimeTextPointRequest,
    ) -> Result<RuntimeVersioned<RuntimeTextCaretResponse>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.resolve_text_caret_for_revision(revision_id, request)
        })
    }

    pub fn resolve_text_range_at(
        &self,
        handle: &RuntimeRevisionHandle,
        request: RuntimeTextRangeRequest,
    ) -> Result<RuntimeVersioned<RuntimeTextRangeResponse>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.resolve_text_range_for_revision(revision_id, request)
        })
    }
}
