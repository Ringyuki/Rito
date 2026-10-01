use super::{RuntimeRevisionAccessError, RuntimeRevisionHandle, RuntimeVersioned};
use crate::runtime::{
    AnnotationTarget, AnnotationTargetResolution, ResolvedRuntimeLocator,
    RuntimeChapterTextIndices, RuntimeDocument, RuntimeFootnote, RuntimeFootnotes,
    RuntimeLocatorRequest, RuntimePageReadingAnchor, RuntimeSearchRequest, RuntimeSearchResponse,
    RuntimeSourceLocator, RuntimeSourceLocatorResolution, RuntimeSourceRange,
};

impl RuntimeDocument {
    pub fn search_at(
        &self,
        handle: &RuntimeRevisionHandle,
        request: RuntimeSearchRequest,
    ) -> Result<RuntimeVersioned<RuntimeSearchResponse>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.search(revision_id, request)
        })
    }

    pub fn resolve_locator_at(
        &self,
        handle: &RuntimeRevisionHandle,
        request: RuntimeLocatorRequest,
    ) -> Result<RuntimeVersioned<ResolvedRuntimeLocator>, RuntimeRevisionAccessError> {
        self.versioned_read(handle, |document, revision_id| {
            document.resolve_locator(revision_id, request)
        })
    }

    pub fn resolve_source_locator_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        locator: RuntimeSourceLocator,
    ) -> Result<RuntimeVersioned<RuntimeSourceLocatorResolution>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, revision_id| {
            document.resolve_source_locator(revision_id, locator)
        })
    }

    pub fn get_page_reading_anchor_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        page_index: usize,
    ) -> Result<RuntimeVersioned<RuntimePageReadingAnchor>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, revision_id| {
            document.get_page_reading_anchor(revision_id, page_index)
        })
    }

    pub fn get_footnote_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        key: &str,
    ) -> Result<RuntimeVersioned<RuntimeFootnote>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, revision_id| {
            document.get_footnote(revision_id, key)
        })
    }

    pub fn get_footnotes_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<RuntimeVersioned<RuntimeFootnotes>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, RuntimeDocument::get_footnotes)
    }

    pub fn get_chapter_text_indices_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
    ) -> Result<RuntimeVersioned<RuntimeChapterTextIndices>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, RuntimeDocument::get_chapter_text_indices)
    }

    /// Builds an annotation target. The target depends only on the chapter
    /// source, not on the revision; the handle keeps the request on the
    /// document the caller is reading.
    pub fn create_annotation_target_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        href: &str,
        source_range: &RuntimeSourceRange,
    ) -> Result<RuntimeVersioned<AnnotationTarget>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, _| {
            document.create_annotation_target(href, source_range)
        })
    }

    pub fn resolve_annotation_target_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        target: &AnnotationTarget,
    ) -> Result<RuntimeVersioned<AnnotationTargetResolution>, RuntimeRevisionAccessError> {
        self.versioned_write(handle, |document, _| {
            document.resolve_annotation_target(target)
        })
    }
}
