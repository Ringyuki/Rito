pub const NAME: &str = "xhtml";
pub const OWNS: &str = "XHTML parsing, source tree, source spans, and document semantics";

mod footnote_scan;
mod parser;

use std::collections::BTreeMap;
use std::sync::Arc;

use rito_source::{NodeId, SourceArena};

pub(crate) use footnote_scan::{scan_epub_type_attribute_hints, EpubTypeAttributeHint};
pub use parser::parse_xhtml;
#[cfg(any(
    feature = "bench-internals",
    all(test, feature = "legacy-css-diagnostics")
))]
pub(crate) use parser::parse_xhtml_from_source;
pub(crate) use parser::parse_xhtml_with_source;
pub(crate) use parser::summarize_parsed_chapters;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSource {
    pub idref: String,
    pub href: String,
    pub linear: bool,
    pub text_length: usize,
    pub text_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XhtmlSummary {
    pub chapter_count: usize,
    pub chapters: Vec<XhtmlChapterSummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XhtmlChapterSummary {
    pub idref: String,
    pub href: String,
    pub attribute_counts: BTreeMap<String, usize>,
    pub body_attributes: Option<ElementAttributes>,
    pub counts: XhtmlNodeCounts,
    pub first_text: String,
    pub image_sources: Vec<String>,
    pub last_text: String,
    pub max_depth: usize,
    pub stylesheet_hrefs: Option<Vec<String>>,
    pub embedded_stylesheets: Option<Vec<String>>,
    pub tag_counts: BTreeMap<String, usize>,
    pub text_hash: String,
    pub top_level_count: usize,
    pub warning_count: usize,
    pub warnings_hash: String,
    pub detail_hash: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XhtmlNodeCounts {
    pub block: usize,
    pub image: usize,
    pub inline: usize,
    pub text: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementAttributes {
    pub all_attributes: Option<BTreeMap<String, String>>,
    pub class: Option<String>,
    pub colspan: Option<u32>,
    pub href: Option<String>,
    pub id: Option<String>,
    pub language: Option<String>,
    pub rowspan: Option<u32>,
    pub style: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseResult {
    pub nodes: Vec<DocumentNode>,
    pub warnings: Vec<String>,
    pub body_attributes: Option<ElementAttributes>,
    pub(crate) body_source_node_id: Option<NodeId>,
    pub stylesheet_hrefs: Option<Vec<String>>,
    pub embedded_stylesheets: Option<Vec<String>>,
    pub(crate) author_stylesheets: Vec<AuthorStylesheetSource>,
}

/// One XHTML parse together with the canonical source arena that owns every
/// `NodeId` carried by its semantic projection.
///
/// Production chapter preparation retains this pair so later style engines
/// can consume the exact source topology without reparsing XHTML.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ParsedXhtmlSource {
    pub(crate) source_arena: Arc<SourceArena>,
    pub(crate) parsed: ParseResult,
}

/// Author stylesheet occurrences in canonical `SourceArena` document order.
///
/// The legacy resolver historically kept linked and embedded sheets in two
/// separate vectors, which loses cascade order when the two source kinds are
/// interleaved. Keep those compatibility vectors on `ParseResult`, but use
/// this ordered ledger for style resolution and differential evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AuthorStylesheetSource {
    External {
        source_node_id: NodeId,
        href: String,
        selection_issues: Vec<String>,
        media_environment_issues: Vec<String>,
    },
    Embedded {
        source_node_id: NodeId,
        css: String,
        selection_issues: Vec<String>,
        media_environment_issues: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum DocumentNode {
    Block(ElementNode),
    Inline(ElementNode),
    Text(TextNode),
    Image(ImageNode),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ElementNode {
    pub tag: String,
    pub attributes: Option<ElementAttributes>,
    pub children: Vec<DocumentNode>,
    pub source_ref: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextNode {
    pub content: String,
    pub source_text: Option<String>,
    pub source_ref: SourceRef,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageNode {
    pub src: String,
    pub alt: String,
    pub attributes: Option<ElementAttributes>,
    pub source_ref: SourceRef,
    /// The node came from folding an `<svg>` wrapper whose
    /// `preserveAspectRatio` (SVG 2 §8.6, default `xMidYMid meet`) makes
    /// the content contain-fit the declared viewport instead of stretching
    /// with it; only `none` stretches.
    pub svg_contain: bool,
    /// The folded `<svg>`'s own intrinsic dimensions (its `viewBox` size,
    /// or absolute `width`/`height` attributes). An SVG's intrinsic ratio
    /// comes from these, never from the raster it happens to embed
    /// (measured: a 1434×2048 viewBox around a 1119×1600 JPEG sizes at
    /// the viewBox ratio in Chromium — 914.03px at 640 wide, not 915.10).
    pub svg_viewport: Option<(f64, f64)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRef {
    pub node_path: Vec<usize>,
    /// Stable identity in a caller-owned canonical source arena.
    ///
    /// This is process-local engine state, not part of the serialized runtime
    /// contract. Synthetic nodes and legacy test fixtures leave it unset.
    #[serde(skip)]
    pub(crate) source_node_id: Option<NodeId>,
}
