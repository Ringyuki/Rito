pub const NAME: &str = "epub";
pub const OWNS: &str = "EPUB container, package, spine, manifest, TOC, and publication metadata";

pub(crate) mod archive;
mod document;
mod fonts;
mod layout_bridge;
mod parser;
mod paths;
mod prepared;
mod toc;

use std::{error::Error, fmt};

use crate::{
    css::CssSummary,
    interaction::InteractionSummary,
    layout::LayoutSummary,
    resources::PublicationResources,
    style::StyleSummary,
    xhtml::{ChapterSource, XhtmlSummary},
};
use serde::{Deserialize, Serialize};

pub(crate) use document::ChapterSourceScanSession;
pub use document::{
    open_document, open_runtime_document, open_runtime_document_owned, LoadedBinaryResource,
    LoadedChapter, LoadedEpubDocument, LoadedTextResource,
};
#[cfg(test)]
pub(crate) use fonts::{
    font_face_source_cache_metrics, reset_font_face_source_cache_metrics,
    FontFaceSourceCacheMetrics,
};
pub(crate) use fonts::{
    resolve_font_face_sources, shapeable_publication_families_for_layout_with_sources,
    text_measurement_font_assembly_for_layout_with_sources,
    text_measurement_fonts_for_layout_with_sources, ResolvedFontFaceSource,
    ShapeablePublicationFontFace,
};
#[cfg(feature = "legacy-css-diagnostics")]
pub use layout_bridge::{
    analyze_loaded_document_with_layout_and_line_breaking,
    analyze_publication_with_layout_and_line_breaking,
};
pub(crate) use layout_bridge::{
    build_prepared_loaded_document_runtime_layout, prepare_runtime_layout_chapter,
    PreparedRuntimeLayoutChapter, PreparedRuntimeLayoutOptions,
};
pub use layout_bridge::{
    load_publication, load_publication_with_layout, load_publication_with_layout_and_line_breaking,
    summarize_loaded_document_with_layout, summarize_loaded_document_with_layout_and_line_breaking,
};
pub(crate) use paths::{is_external_href, join_epub_href, join_zip_path, opf_dir};
pub(crate) use prepared::{
    loaded_document_resources, parsed_loaded_chapter_source, prepare_loaded_document,
    prepare_loaded_document_base, prepare_loaded_document_with_base,
    prepare_loaded_document_with_base_and_footnote_targets, ParsedLoadedChapterSource,
    PreparedLoadedDocument, PreparedLoadedDocumentBase, StylesheetSourceLedger,
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
}

impl EpubError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for EpubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for EpubError {}

pub type EpubResult<T> = Result<T, EpubError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubPublication {
    pub package: PackageDocument,
    pub resources: PublicationResources,
    pub chapters: Vec<ChapterSource>,
    pub xhtml: XhtmlSummary,
    /// Compatibility parser diagnostics, populated only by an explicit
    /// `analyze_*` entry point. Normal production loading leaves this `None`.
    #[serde(default)]
    pub css: Option<CssSummary>,
    /// Compatibility cascade diagnostics, populated only by an explicit
    /// `analyze_*` entry point. Normal production loading leaves this `None`.
    #[serde(default)]
    pub style: Option<StyleSummary>,
    pub layout: LayoutSummary,
    pub interaction: InteractionSummary,
}
