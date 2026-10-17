pub const NAME: &str = "runtime";
pub const OWNS: &str =
    "Engine-owned document handles, layout revisions, frame caches, and resource lifetimes";

use std::{cell::OnceCell, collections::BTreeMap, num::NonZeroUsize};

mod access;
mod chapter_engine_session;
mod chapter_local;
mod chapter_styles;
mod chapter_text;
mod chapter_tree_report;
mod chapter_trees;
mod cleanup;
mod font_catalog;
mod fragment_backend;
mod fragment_frame;
mod frame;
mod metadata;
mod navigation;
mod page;
mod page_artifact;
mod page_target;
mod pending;
mod pinned_font_policy;
mod publication_footnotes;
mod reader_session;
mod resource;
mod revision;
mod revision_fonts;
mod search;
mod source_locator;
mod spread;
mod text_interaction;
mod types;

use crate::epub::{
    open_runtime_document, open_runtime_document_owned, EpubError, EpubResult, LoadedEpubDocument,
};

pub use access::{
    RuntimeRevisionAccessError, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle,
    RuntimeVersioned,
};
use cleanup::{PendingRuntimeRevisionCleanup, RuntimeCleanupQueue, RUNTIME_CLEANUP_QUANTUM};
pub use font_catalog::{
    RuntimeFontCatalog, RuntimeFontFamily, RuntimeFontFamilyFace, RuntimeFontSource,
};
use frame::RuntimeRevision;
use page::page_targets;
pub use pinned_font_policy::{
    RuntimePinnedFontFaceInput, RuntimePinnedFontFaceSummary, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput, RuntimePinnedFontPolicySummary,
    HOST_FONT_HREF_PREFIX, RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION,
};
use publication_footnotes::{PublicationFootnoteIndex, PublicationFootnoteProgress};
pub use reader_session::*;
use resource::{
    find_binary_resource_metadata, find_text_resource, resource_not_found, runtime_binary_resource,
    runtime_text_resource,
};
pub use search::{SearchRuntimeResult, SearchTextPosition};

pub use source_locator::{
    annotation_target_from_json, annotation_target_to_json, AnnotationOrphanReason,
    AnnotationPosition, AnnotationQuote, AnnotationTarget, AnnotationTargetResolution,
    RuntimePageReadingAnchor, RuntimePageReadingAnchorUnavailableReason, RuntimeSourceLocator,
    RuntimeSourceLocatorError, RuntimeSourceLocatorErrorKind, RuntimeSourceLocatorMatchedBy,
    RuntimeSourceLocatorPendingReason, RuntimeSourceLocatorResolution, RuntimeSourcePoint,
    RuntimeSourceRange, ANNOTATION_TARGET_VERSION,
};
pub use text_interaction::{
    RuntimeExactSourceRange, RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution,
    RuntimeExactTextRangeRect, RuntimeTextCaret, RuntimeTextCaretResolution,
    RuntimeTextCaretResponse, RuntimeTextPointRequest, RuntimeTextRange,
    RuntimeTextRangeFromPointsRequest, RuntimeTextRangeFromPointsResolution,
    RuntimeTextRangeFromPointsResponse, RuntimeTextRangeRequest, RuntimeTextRangeResolution,
    RuntimeTextRangeResponse, RuntimeTextRangeToPointRequest, RuntimeTextRangeToPointResponse,
    RuntimeTextSelectionGranularity, RuntimeTextSelectionMovementRequest,
    RuntimeTextSelectionMovementResolution, RuntimeTextSelectionMovementResponse,
    RuntimeTextSourceSpan, RuntimeTextSourceSpanEndpoint,
};
pub use types::*;

#[derive(Debug)]
pub struct RuntimeDocument {
    document: LoadedEpubDocument,
    prepared: Option<std::rc::Rc<crate::epub::PreparedLoadedDocument>>,
    prepared_base: Option<crate::epub::PreparedLoadedDocumentBase>,
    publication_footnotes: OnceCell<PublicationFootnoteIndex>,
    publication_footnote_progress: Option<PublicationFootnoteProgress>,
    #[cfg(test)]
    publication_footnote_scan_count: usize,
    page_target_context: OnceCell<page_target::RuntimePageTargetContext>,
    source_chapter_indices: BTreeMap<String, source_locator::RuntimeSourceChapterIndex>,
    parsed_chapters: BTreeMap<usize, std::rc::Rc<crate::epub::ParsedLoadedChapterSource>>,
    /// Each chapter's style tables as last resolved, reused by every
    /// layout they hold under.
    chapter_styles: chapter_styles::ChapterStyleCache,
    font_face_sources: OnceCell<Vec<crate::epub::ResolvedFontFaceSource>>,
    fragment_engine: OnceCell<Option<std::rc::Rc<fragment_frame::RuntimeFragmentEngine>>>,
    pinned_font_policy: pinned_font_policy::RuntimePinnedFontPolicy,
    next_revision_index: usize,
    revisions: BTreeMap<String, RuntimeRevision>,
    chapter_local_revisions: BTreeMap<String, RuntimeRevision>,
    cleanup_queue: RuntimeCleanupQueue,
    /// Publication faces the host's font decoder rejected (normalized
    /// family names). The browser cannot paint these faces — its
    /// sanitizer refuses the bytes — so the engine must not shape with
    /// them either: a face only the shaper holds measures runs the paint
    /// then draws with a fallback font, splitting layout from ink
    /// (b12's contents heading opened a 14px hole mid-word).
    unavailable_font_families: std::collections::BTreeSet<String>,
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

    /// Opens a publication from its skeleton shard; images, audio and video
    /// arrive later through [`RuntimeDocument::supply_shard`].
    pub fn open_shards(
        skeleton: &[u8],
        key: Option<&crate::epub::shard::ShardKey>,
    ) -> EpubResult<Self> {
        Ok(Self::from_loaded_document(
            crate::epub::open_runtime_document_from_shards(skeleton, key)?,
        ))
    }

    /// Verifies one content shard of a publication opened from shards and
    /// keeps its files; returns the shard's id. Supplying a shard twice is
    /// harmless.
    pub fn supply_shard(
        &mut self,
        shard: &[u8],
        key: Option<&crate::epub::shard::ShardKey>,
    ) -> EpubResult<u32> {
        let store = self
            .document
            .shard_store()
            .ok_or_else(|| EpubError::new("the publication was not opened from shards"))?
            .clone();
        store.supply(shard, key)
    }

    /// Every content shard, ordered for fetching ahead of need from the
    /// chapter at `href`; see [`LoadedEpubDocument::content_shards_near`].
    pub fn content_shards_near(&self, href: &str) -> Vec<u32> {
        self.document.content_shards_near(href)
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
            page_target_context: OnceCell::new(),
            source_chapter_indices: BTreeMap::new(),
            parsed_chapters: BTreeMap::new(),
            chapter_styles: chapter_styles::ChapterStyleCache::default(),
            font_face_sources: OnceCell::new(),
            fragment_engine: OnceCell::new(),
            pinned_font_policy,
            next_revision_index: 1,
            revisions: BTreeMap::new(),
            chapter_local_revisions: BTreeMap::new(),
            cleanup_queue: RuntimeCleanupQueue::default(),
            unavailable_font_families: std::collections::BTreeSet::new(),
        }
    }

    /// Records faces the host's font decoder rejected and, when the
    /// fragment engine already shaped with one of them, discards the
    /// engine so its rebuild registers only paintable faces.
    pub fn set_unavailable_font_faces(&mut self, families: &[String]) {
        // A host names a face by the alias it registered it under, or by
        // its declared family.
        let known: std::collections::BTreeSet<String> = self
            .resolved_font_face_sources()
            .iter()
            .flat_map(|source| {
                let alias = self
                    .document
                    .fonts
                    .get(source.resource_index())
                    .map(|resource| source.paint_alias(&resource.bytes).to_ascii_lowercase());
                std::iter::once(source.family().trim().to_ascii_lowercase()).chain(alias)
            })
            .collect();
        let mut added_known = false;
        for family in families {
            let normalized = family.trim().to_ascii_lowercase();
            if normalized.is_empty() {
                continue;
            }
            if self.unavailable_font_families.insert(normalized.clone())
                && known.contains(&normalized)
            {
                added_known = true;
            }
        }
        if added_known && self.fragment_engine.get().is_some() {
            self.fragment_engine = OnceCell::new();
        }
    }

    pub fn document(&self) -> &LoadedEpubDocument {
        &self.document
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
        self.service_cleanup_queue();
        true
    }

    pub(super) fn remove_chapter_local_revision(&mut self, revision_id: &str) -> bool {
        let Some(revision) = self.chapter_local_revisions.remove(revision_id) else {
            self.service_cleanup_queue();
            return false;
        };
        self.cleanup_queue.enqueue_revision(revision);
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

    pub fn revision_count(&self) -> usize {
        self.revisions.len() + self.chapter_local_revisions.len()
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
            RuntimeResourceKind::Font if href.starts_with(HOST_FONT_HREF_PREFIX) => {
                let bytes = self
                    .pinned_font_policy
                    .bytes_for_href(href)
                    .ok_or_else(|| resource_not_found(kind, href))?;
                Ok(RuntimeResource {
                    revision_id: revision_id.to_owned(),
                    kind,
                    href: href.to_owned(),
                    media_type: sfnt_media_type(bytes).to_owned(),
                    bytes: bytes.to_vec(),
                    width: None,
                    height: None,
                })
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
            RuntimeResourceKind::Font if href.starts_with(HOST_FONT_HREF_PREFIX) => self
                .pinned_font_policy
                .bytes_for_href(href)
                .map(<[u8]>::len),
            RuntimeResourceKind::Font => find_binary_resource_metadata(&self.document.fonts, href)
                .map(|metadata| metadata.byte_length()),
            RuntimeResourceKind::Stylesheet => find_text_resource(&self.document.stylesheets, href)
                .map(|resource| resource.text.len()),
        }
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

    /// The targets of one page of a revision this document holds, through
    /// the classifier `get_page_targets` runs: every host surface agrees on
    /// what a target is, where a link leads and under which key a footnote
    /// is held.
    pub(in crate::runtime) fn classify_page_targets(
        &self,
        revision: &RuntimeRevision,
        page_index: usize,
        targets: &[page_artifact::PageArtifactTarget],
    ) -> Vec<page_target::PageTargetClass> {
        let context = self
            .page_target_context
            .get_or_init(|| page_target::RuntimePageTargetContext::new(&self.document));
        page_target::classify_page_targets(&self.document, context, revision, page_index, targets)
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
pub(crate) mod tests;

/// The media type of an OpenType face by its sfnt version tag.
fn sfnt_media_type(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"OTTO") {
        "font/otf"
    } else {
        "font/ttf"
    }
}
