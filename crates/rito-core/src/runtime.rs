pub const NAME: &str = "runtime";
pub const OWNS: &str =
    "Engine-owned document handles, layout revisions, frame caches, and resource lifetimes";

use std::{cell::OnceCell, collections::BTreeMap, num::NonZeroUsize};

mod access;
mod bundle;
mod bundle_wire;
mod chapter_engine_session;
mod chapter_text;
mod chapter_tree_report;
mod cleanup;
mod continuation;
mod fragment_backend;
mod fragment_frame;
mod fragment_page_report;
mod fragment_shadow;
mod frame;
mod metadata;
mod navigation;
mod page;
mod page_artifact;
mod page_semantics;
mod page_target;
mod pinned_font_policy;
mod publication_footnotes;
mod reader_v1;
mod resource;
mod revision;
mod revision_fonts;
mod search;
mod shape_provenance_diagnostic;
mod source_locator;
mod style_table_summary;
mod text_interaction;
mod transfer_store;
mod types;

use crate::{
    epub::{
        open_runtime_document, open_runtime_document_owned, EpubError, EpubResult,
        LoadedEpubDocument,
    },
    layout::{LayoutConfig, TextMeasurementCache},
};

pub use access::{
    RuntimeRevisionAccessError, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle,
    RuntimeVersioned,
};
pub use bundle_wire::{
    decode_runtime_bundle, encode_runtime_bundle, DecodedRuntimeBundle,
    RUNTIME_BUNDLE_HEADER_BYTES, RUNTIME_BUNDLE_MAGIC, RUNTIME_BUNDLE_MAGIC_TEXT,
    RUNTIME_BUNDLE_VERSION,
};
use chapter_text::runtime_chapter_text_index_entries;
pub use chapter_tree_report::{
    RuntimeChapterTreeChapter, RuntimeChapterTreeReport, RUNTIME_CHAPTER_TREE_REPORT_SCHEMA_VERSION,
};
use cleanup::{PendingRuntimeRevisionCleanup, RuntimeCleanupQueue, RUNTIME_CLEANUP_QUANTUM};
pub use fragment_page_report::{
    RuntimeFragmentPageChapter, RuntimeFragmentPageReport,
    RUNTIME_FRAGMENT_PAGE_REPORT_SCHEMA_VERSION,
};
pub use fragment_shadow::{
    RuntimeFragmentShadowReport, RUNTIME_FRAGMENT_SHADOW_PROVIDER_STUB_BLOCK,
    RUNTIME_FRAGMENT_SHADOW_SCHEMA_VERSION,
};
use frame::{RuntimeChapterTextIndexSource, RuntimeRevision};
use metadata::{chapter_sources_from_document, runtime_font_faces, runtime_publication_resources};
use navigation::{active_chapter_preview, resolve_href_locator};
use page::{page_targets, page_text_positions, text_range_geometry};
use page_semantics::page_semantics;
pub use page_semantics::{
    RuntimePageSemantics, RuntimeSemanticBounds, RuntimeSemanticNode, RuntimeSemanticRole,
};
pub use pinned_font_policy::{
    RuntimePinnedFontFaceInput, RuntimePinnedFontFaceSummary, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput, RuntimePinnedFontPolicySummary,
    RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION,
};
use publication_footnotes::{PublicationFootnoteIndex, PublicationFootnoteProgress};
pub use reader_v1::*;
use resource::{
    find_binary_resource_metadata, find_text_resource, resource_not_found, runtime_binary_resource,
    runtime_text_resource,
};
use search::search_revision;
pub use shape_provenance_diagnostic::{
    RuntimeShapeAffectedCodepointFrequency, RuntimeShapeProvenanceDiagnostic,
    RUNTIME_SHAPE_PROVENANCE_DIAGNOSTIC_SCHEMA_VERSION,
};
pub use style_table_summary::{
    RuntimeChapterStyleTableSummary, RuntimeStyleTableSummary,
    RUNTIME_STYLE_TABLE_SUMMARY_SCHEMA_VERSION,
};

pub use source_locator::{
    RuntimePageReadingAnchor, RuntimePageReadingAnchorUnavailableReason, RuntimeSourceLocator,
    RuntimeSourceLocatorError, RuntimeSourceLocatorErrorKind, RuntimeSourceLocatorMatchedBy,
    RuntimeSourceLocatorPendingReason, RuntimeSourceLocatorResolution, RuntimeSourcePoint,
    RuntimeSourceRange,
};
pub use text_interaction::{
    RuntimeExactSourceRange, RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution,
    RuntimeExactSourceRangeResponse, RuntimeExactTextRangeRect, RuntimeTextCaret,
    RuntimeTextCaretResolution, RuntimeTextCaretResponse, RuntimeTextPointRequest,
    RuntimeTextRange, RuntimeTextRangeFromPointsRequest, RuntimeTextRangeFromPointsResolution,
    RuntimeTextRangeFromPointsResponse, RuntimeTextRangeRequest, RuntimeTextRangeResolution,
    RuntimeTextRangeResponse, RuntimeTextRangeToPointRequest, RuntimeTextRangeToPointResponse,
    RuntimeTextSelectionGranularity, RuntimeTextSelectionMovementRequest,
    RuntimeTextSelectionMovementResolution, RuntimeTextSelectionMovementResponse,
    RuntimeTextSourceSpan, RuntimeTextSourceSpanEndpoint,
};
pub use transfer_store::{RuntimeResourceTransferPayload, RuntimeResourceTransferStore};
pub use types::*;

#[derive(Debug)]
pub struct RuntimeDocument {
    document: LoadedEpubDocument,
    prepared: Option<crate::epub::PreparedLoadedDocument>,
    prepared_base: Option<crate::epub::PreparedLoadedDocumentBase>,
    publication_footnotes: OnceCell<PublicationFootnoteIndex>,
    publication_footnote_progress: Option<PublicationFootnoteProgress>,
    #[cfg(test)]
    publication_footnote_scan_count: usize,
    full_chapter_text_indices: OnceCell<BTreeMap<String, RuntimeChapterTextIndex>>,
    page_target_context: OnceCell<page_target::RuntimePageTargetContext>,
    source_chapter_indices: BTreeMap<String, source_locator::RuntimeSourceChapterIndex>,
    parsed_chapters: BTreeMap<usize, crate::epub::ParsedLoadedChapterSource>,
    font_face_sources: OnceCell<Vec<crate::epub::ResolvedFontFaceSource>>,
    fragment_engine: OnceCell<Option<fragment_frame::RuntimeFragmentEngine>>,
    text_measurement_cache: TextMeasurementCache,
    pinned_font_policy: pinned_font_policy::RuntimePinnedFontPolicy,
    next_revision_index: usize,
    next_continuation_index: usize,
    revisions: BTreeMap<String, RuntimeRevision>,
    chapter_local_revisions: BTreeMap<String, RuntimeRevision>,
    continuations: continuation::RuntimeContinuationStore,
    cleanup_queue: RuntimeCleanupQueue,
    /// Whether completed whole-book revisions may hand pagination to the
    /// fragment engine. Off by default while the fragment backend's
    /// interaction surface (selection, source locators) is still
    /// unimplemented: routing would trade working interactions for
    /// fragment pagination. Probes and tests opt in.
    fragment_page_table_enabled: bool,
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
        Self::from_loaded_document_and_pinned_font_policy(
            document,
            pinned_font_policy::RuntimePinnedFontPolicy::empty(),
        )
    }

    fn from_loaded_document_and_pinned_font_policy(
        document: LoadedEpubDocument,
        pinned_font_policy: pinned_font_policy::RuntimePinnedFontPolicy,
    ) -> Self {
        Self {
            document,
            prepared: None,
            prepared_base: None,
            publication_footnotes: OnceCell::new(),
            publication_footnote_progress: None,
            #[cfg(test)]
            publication_footnote_scan_count: 0,
            full_chapter_text_indices: OnceCell::new(),
            page_target_context: OnceCell::new(),
            source_chapter_indices: BTreeMap::new(),
            parsed_chapters: BTreeMap::new(),
            font_face_sources: OnceCell::new(),
            fragment_engine: OnceCell::new(),
            text_measurement_cache: TextMeasurementCache::default(),
            pinned_font_policy,
            next_revision_index: 1,
            next_continuation_index: 1,
            revisions: BTreeMap::new(),
            chapter_local_revisions: BTreeMap::new(),
            continuations: continuation::RuntimeContinuationStore::default(),
            cleanup_queue: RuntimeCleanupQueue::default(),
            fragment_page_table_enabled: false,
        }
    }

    /// Opts completed whole-book revisions into fragment-engine
    /// pagination. See the field's caveats; this is a cutover lever, not
    /// a stable API.
    pub fn set_fragment_page_table_enabled(&mut self, enabled: bool) {
        self.fragment_page_table_enabled = enabled;
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
        let Some(revision) = self.revisions.remove(revision_id) else {
            self.service_cleanup_queue();
            return false;
        };
        self.cleanup_queue.enqueue_revision(revision);
        if let Some(continuation) = self.continuations.remove_revision(revision_id) {
            self.cleanup_queue.enqueue_continuation(continuation);
        }
        self.service_cleanup_queue();
        true
    }

    pub(super) fn remove_chapter_local_revision(&mut self, revision_id: &str) -> bool {
        let Some(revision) = self.chapter_local_revisions.remove(revision_id) else {
            self.service_cleanup_queue();
            return false;
        };
        self.cleanup_queue.enqueue_revision(revision);
        if let Some(continuation) = self.continuations.remove_revision(revision_id) {
            self.cleanup_queue.enqueue_continuation(continuation);
        }
        self.service_cleanup_queue();
        true
    }

    fn service_cleanup_queue(&mut self) {
        let budget = NonZeroUsize::new(RUNTIME_CLEANUP_QUANTUM)
            .expect("runtime cleanup quantum is non-zero");
        let progress = self.cleanup_queue.advance(budget);
        debug_assert!(
            progress.complete || progress.consumed_units == budget.get(),
            "incomplete runtime cleanup must consume the complete service quantum"
        );
    }

    pub(super) fn enqueue_layout_config_cleanup(&mut self, layout_config: LayoutConfig) {
        self.cleanup_queue.enqueue_layout_config(layout_config);
    }

    pub(super) fn retire_layout_config(&mut self, layout_config: LayoutConfig) {
        self.enqueue_layout_config_cleanup(layout_config);
        self.service_cleanup_queue();
    }

    pub(super) fn run_with_owned_layout_config<T, E>(
        &mut self,
        layout_config: LayoutConfig,
        work: impl FnOnce(&mut Self, &LayoutConfig) -> Result<T, E>,
    ) -> Result<(LayoutConfig, T), E> {
        match work(self, &layout_config) {
            Ok(value) => Ok((layout_config, value)),
            Err(error) => {
                self.retire_layout_config(layout_config);
                Err(error)
            }
        }
    }

    pub fn revision_count(&self) -> usize {
        self.revisions.len() + self.chapter_local_revisions.len()
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
        self.get_resource_for_revision(revision_id, kind, href)
    }

    pub(super) fn get_chapter_local_resource_inner(
        &mut self,
        revision_id: &str,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> EpubResult<RuntimeResource> {
        if !self.chapter_local_revisions.contains_key(revision_id) {
            return Err(EpubError::new(format!(
                "unknown chapter-local revision: {revision_id}"
            )));
        }
        self.get_resource_for_revision(revision_id, kind, href)
    }

    fn get_resource_for_revision(
        &mut self,
        revision_id: &str,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> EpubResult<RuntimeResource> {
        match kind {
            RuntimeResourceKind::Image => {
                self.document.ensure_image_dimensions_loaded(href)?;
                let metadata = find_binary_resource_metadata(&self.document.images, href)
                    .ok_or_else(|| resource_not_found(kind, href))?;
                let bytes = self
                    .document
                    .read_image_bytes(metadata.href())?
                    .ok_or_else(|| resource_not_found(kind, href))?;
                Ok(runtime_binary_resource(revision_id, kind, metadata, bytes))
            }
            RuntimeResourceKind::Font => {
                let metadata = find_binary_resource_metadata(&self.document.fonts, href)
                    .ok_or_else(|| resource_not_found(kind, href))?;
                let bytes = self
                    .document
                    .read_font_bytes(metadata.href())?
                    .ok_or_else(|| resource_not_found(kind, href))?;
                Ok(runtime_binary_resource(revision_id, kind, metadata, bytes))
            }
            RuntimeResourceKind::Stylesheet => find_text_resource(&self.document.stylesheets, href)
                .map(|resource| runtime_text_resource(revision_id, kind, resource))
                .ok_or_else(|| resource_not_found(kind, href)),
        }
    }

    pub(crate) fn resource_byte_length(
        &self,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> Option<usize> {
        match kind {
            RuntimeResourceKind::Image => {
                find_binary_resource_metadata(&self.document.images, href)
                    .map(|metadata| metadata.byte_length())
            }
            RuntimeResourceKind::Font => find_binary_resource_metadata(&self.document.fonts, href)
                .map(|metadata| metadata.byte_length()),
            RuntimeResourceKind::Stylesheet => find_text_resource(&self.document.stylesheets, href)
                .map(|resource| resource.text.len()),
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
        Ok(search_revision(
            &self.document,
            revision_id,
            revision,
            request,
        ))
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
        let context = self
            .page_target_context
            .get_or_init(|| page_target::RuntimePageTargetContext::new(&self.document));
        page_targets(&self.document, context, revision_id, revision, page_index)
    }

    pub fn get_page_semantics(
        &self,
        revision_id: &str,
        page_index: usize,
    ) -> EpubResult<RuntimePageSemantics> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        page_semantics(revision_id, revision, page_index)
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
            .footnote(key)
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
            complete: revision.interactions.footnote_index_complete,
            pending_keys: revision
                .interactions
                .pending_footnote_keys
                .iter()
                .filter(|key| !revision.interactions.contains_footnote(key.as_str()))
                .cloned()
                .collect(),
            entries: revision.interactions.owned_footnotes(),
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

impl Drop for RuntimeDocument {
    fn drop(&mut self) {
        self.cleanup_queue.drain_sync();
        while let Some(continuation) = self.continuations.pop_first() {
            continuation::PendingRuntimeContinuationRecordCleanup::new(continuation).drain();
        }
        while let Some((_revision_id, revision)) = self.revisions.pop_first() {
            PendingRuntimeRevisionCleanup::new(revision).drain();
        }
        while let Some((_revision_id, revision)) = self.chapter_local_revisions.pop_first() {
            PendingRuntimeRevisionCleanup::new(revision).drain();
        }
        debug_assert!(self.cleanup_queue.is_empty());
    }
}

#[cfg(test)]
mod tests;
