pub const NAME: &str = "runtime";
pub const OWNS: &str =
    "Engine-owned document handles, layout revisions, frame caches, and resource lifetimes";

use std::{cell::OnceCell, collections::BTreeMap};

mod bundle;
mod bundle_wire;
mod chapter_text;
mod frame;
mod metadata;
mod navigation;
mod page;
mod resource;
mod revision;
mod search;
mod transfer_store;
mod types;

use crate::{
    epub::{
        open_runtime_document, open_runtime_document_owned, EpubError, EpubResult,
        LoadedEpubDocument,
    },
    layout::TextMeasurementCache,
};

pub use bundle_wire::{
    decode_runtime_bundle, encode_runtime_bundle, DecodedRuntimeBundle,
    RUNTIME_BUNDLE_HEADER_BYTES, RUNTIME_BUNDLE_MAGIC, RUNTIME_BUNDLE_MAGIC_TEXT,
    RUNTIME_BUNDLE_VERSION,
};
use chapter_text::runtime_chapter_text_index_entries;
use frame::{RuntimeChapterTextIndexSource, RuntimeRevision};
use metadata::{chapter_sources_from_document, runtime_font_faces, runtime_publication_resources};
use navigation::{active_chapter_preview, resolve_href_locator};
use page::{page_targets, page_text_positions, text_range_geometry};
use resource::{
    find_binary_resource, find_text_resource, resource_not_found, runtime_binary_resource,
    runtime_text_resource,
};
use search::search_revision;
pub use transfer_store::{RuntimeResourceTransferPayload, RuntimeResourceTransferStore};
pub use types::*;

#[derive(Debug)]
pub struct RuntimeDocument {
    document: LoadedEpubDocument,
    prepared: Option<crate::epub::PreparedLoadedDocument>,
    prepared_base: Option<crate::epub::PreparedLoadedDocumentBase>,
    full_chapter_text_indices: OnceCell<BTreeMap<String, RuntimeChapterTextIndex>>,
    parsed_chapters: BTreeMap<usize, crate::epub::ParsedLoadedChapterSource>,
    text_measurement_cache: TextMeasurementCache,
    next_revision_index: usize,
    revisions: BTreeMap<String, RuntimeRevision>,
}

impl RuntimeDocument {
    pub fn open(bytes: &[u8]) -> EpubResult<Self> {
        Ok(Self::from_loaded_document(open_runtime_document(bytes)?))
    }

    pub fn open_owned(bytes: Vec<u8>) -> EpubResult<Self> {
        Ok(Self::from_loaded_document(open_runtime_document_owned(
            bytes,
        )?))
    }

    pub fn from_loaded_document(document: LoadedEpubDocument) -> Self {
        Self {
            document,
            prepared: None,
            prepared_base: None,
            full_chapter_text_indices: OnceCell::new(),
            parsed_chapters: BTreeMap::new(),
            text_measurement_cache: TextMeasurementCache::default(),
            next_revision_index: 1,
            revisions: BTreeMap::new(),
        }
    }

    pub fn document(&self) -> &LoadedEpubDocument {
        &self.document
    }

    pub fn publication_info(&self) -> RuntimePublicationInfo {
        RuntimePublicationInfo {
            package: self.document.package.clone(),
            resources: runtime_publication_resources(&self.document),
            chapters: chapter_sources_from_document(&self.document),
            font_faces: runtime_font_faces(&self.document),
        }
    }

    pub fn has_revision(&self, revision_id: &str) -> bool {
        self.revisions.contains_key(revision_id)
    }

    pub fn release_revision(&mut self, revision_id: &str) -> bool {
        self.revisions.remove(revision_id).is_some()
    }

    pub fn revision_count(&self) -> usize {
        self.revisions.len()
    }

    pub(super) fn active_chapter_preview(
        &self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<Option<RuntimeActiveChapterPreview>> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        Ok(active_chapter_preview(
            &self.document,
            revision,
            spread_index,
        ))
    }

    pub fn get_resource(
        &mut self,
        revision_id: &str,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> EpubResult<RuntimeResource> {
        self.assert_revision_exists(revision_id)?;
        match kind {
            RuntimeResourceKind::Image => {
                self.document.ensure_image_dimensions_loaded(href)?;
                let resource = find_binary_resource(&self.document.images, href)
                    .ok_or_else(|| resource_not_found(kind, href))?
                    .clone();
                let bytes = self
                    .document
                    .read_image_bytes(&resource.href)?
                    .ok_or_else(|| resource_not_found(kind, href))?;
                Ok(runtime_binary_resource(revision_id, kind, &resource, bytes))
            }
            RuntimeResourceKind::Font => {
                let resource = find_binary_resource(&self.document.fonts, href)
                    .ok_or_else(|| resource_not_found(kind, href))?
                    .clone();
                let bytes = self
                    .document
                    .read_font_bytes(&resource.href)?
                    .ok_or_else(|| resource_not_found(kind, href))?;
                Ok(runtime_binary_resource(revision_id, kind, &resource, bytes))
            }
            RuntimeResourceKind::Stylesheet => find_text_resource(&self.document.stylesheets, href)
                .map(|resource| runtime_text_resource(revision_id, kind, resource))
                .ok_or_else(|| resource_not_found(kind, href)),
        }
    }

    pub fn search(
        &self,
        revision_id: &str,
        request: RuntimeSearchRequest,
    ) -> EpubResult<RuntimeSearchResponse> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        Ok(search_revision(revision_id, revision, request))
    }

    pub fn resolve_locator(
        &self,
        revision_id: &str,
        request: RuntimeLocatorRequest,
    ) -> EpubResult<ResolvedRuntimeLocator> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        resolve_href_locator(revision_id, &self.document.package, revision, request)
    }

    pub fn get_page_targets(
        &self,
        revision_id: &str,
        page_index: usize,
    ) -> EpubResult<RuntimePageTargets> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        page_targets(revision_id, revision, page_index)
    }

    pub fn get_page_text_positions(
        &self,
        revision_id: &str,
        page_index: usize,
    ) -> EpubResult<RuntimePageTextPositions> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        page_text_positions(revision_id, revision, page_index)
    }

    pub fn get_text_range_geometry(
        &self,
        revision_id: &str,
        request: RuntimeTextRangeGeometryRequest,
    ) -> EpubResult<RuntimeTextRangeGeometry> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        text_range_geometry(revision_id, revision, request)
    }

    pub fn get_footnote(&mut self, revision_id: &str, key: &str) -> EpubResult<RuntimeFootnote> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        let entry = revision
            .interactions
            .footnotes
            .get(key)
            .ok_or_else(|| EpubError::new(format!("unknown footnote: {key}")))?;
        Ok(RuntimeFootnote {
            revision_id: revision_id.to_owned(),
            key: key.to_owned(),
            kind: entry.kind,
            text: entry.text.clone(),
            html: entry.html.clone(),
        })
    }

    pub fn get_footnotes(&mut self, revision_id: &str) -> EpubResult<RuntimeFootnotes> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        Ok(RuntimeFootnotes {
            revision_id: revision_id.to_owned(),
            entries: revision.interactions.footnotes.clone(),
        })
    }

    pub fn get_chapter_text_indices(
        &mut self,
        revision_id: &str,
    ) -> EpubResult<RuntimeChapterTextIndices> {
        Ok(RuntimeChapterTextIndices {
            revision_id: revision_id.to_owned(),
            entries: self.chapter_text_indices_for_revision(revision_id)?.clone(),
        })
    }

    pub(super) fn chapter_text_indices_for_revision(
        &self,
        revision_id: &str,
    ) -> EpubResult<&BTreeMap<String, RuntimeChapterTextIndex>> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        match &revision.interactions.chapter_text_indices {
            RuntimeChapterTextIndexSource::Materialized(entries) => Ok(entries),
            RuntimeChapterTextIndexSource::FullDocument => {
                let prepared = self
                    .prepared
                    .as_ref()
                    .ok_or_else(|| EpubError::new("prepared document is unavailable"))?;
                Ok(self
                    .full_chapter_text_indices
                    .get_or_init(|| runtime_chapter_text_index_entries(prepared)))
            }
        }
    }

    fn assert_revision_exists(&self, revision_id: &str) -> EpubResult<()> {
        self.revisions
            .contains_key(revision_id)
            .then_some(())
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))
    }
}

#[cfg(test)]
mod tests;
