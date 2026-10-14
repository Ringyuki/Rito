use super::{RuntimeRevisionAccessError, RuntimeRevisionHandle, RuntimeVersioned};
use crate::runtime::{
    RuntimeDocument, RuntimeFootnote, RuntimePageReadingAnchor, RuntimeSourceLocator,
    RuntimeSourceLocatorResolution,
};

impl RuntimeDocument {
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
}
