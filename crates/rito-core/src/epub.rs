pub const NAME: &str = "epub";
pub const OWNS: &str = "EPUB container, package, spine, manifest, TOC, and publication metadata";

pub(crate) mod archive;
mod check;
mod document;
mod fonts;
mod layout_bridge;
mod parser;
mod paths;
mod prepared;
mod reader;
pub mod shard;
mod toc;

use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

pub use check::{check_publication, PublicationProblem};
pub(crate) use document::ChapterSourceScanSession;
pub use document::{
    open_document, open_runtime_document, open_runtime_document_from_shards,
    open_runtime_document_owned, LoadedBinaryResource, LoadedChapter, LoadedEpubDocument,
    LoadedTextResource,
};
pub(crate) use fonts::{
    parse_font_family_list, publication_font_face_catalog, resolve_font_face_sources,
    ResolvedFontFaceSource,
};
pub(crate) use layout_bridge::{
    chapter_style_options, chapter_style_table, chapter_style_viewport, check_chapter_style_sources,
};
pub(crate) use paths::{is_external_href, join_epub_href, join_zip_path, opf_dir};
#[cfg(test)]
pub(crate) use prepared::prepare_loaded_document;
pub(crate) use prepared::{
    loaded_document_resources, parsed_loaded_chapter_source, prepare_loaded_document_base,
    prepare_loaded_document_with_base, prepare_loaded_document_with_base_and_footnote_targets,
    ParsedLoadedChapterSource, PreparedLoadedDocument, PreparedLoadedDocumentBase,
    StylesheetSourceLedger,
};

pub const CONTAINER_PATH: &str = "META-INF/container.xml";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageMetadata {
    pub title: String,
    pub language: String,
    pub identifier: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestItem {
    pub id: String,
    pub href: String,
    pub media_type: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineItem {
    pub idref: String,
    pub linear: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocEntry {
    pub label: String,
    pub href: String,
    #[serde(default)]
    pub children: Vec<TocEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageDocument {
    pub metadata: PackageMetadata,
    pub manifest: Vec<ManifestItem>,
    pub spine: Vec<SpineItem>,
    #[serde(default)]
    pub toc: Vec<TocEntry>,
}

impl PackageDocument {
    pub fn manifest_item(&self, id: &str) -> Option<&ManifestItem> {
        self.manifest.iter().find(|item| item.id == id)
    }

    pub fn spine_len(&self) -> usize {
        self.spine.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpubError {
    message: String,
    pending_shards: Vec<u32>,
}

impl EpubError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            pending_shards: Vec::new(),
        }
    }

    /// A read that needs content shards the host has not supplied yet.
    pub fn shards_pending(mut shard_ids: Vec<u32>, message: impl Into<String>) -> Self {
        shard_ids.sort_unstable();
        shard_ids.dedup();
        Self {
            message: message.into(),
            pending_shards: shard_ids,
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    /// The content shards whose absence caused this error, ascending; empty
    /// for every other failure.
    pub fn pending_shards(&self) -> &[u32] {
        &self.pending_shards
    }

    pub fn is_pending(&self) -> bool {
        !self.pending_shards.is_empty()
    }
}

impl fmt::Display for EpubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for EpubError {}

pub type EpubResult<T> = Result<T, EpubError>;
