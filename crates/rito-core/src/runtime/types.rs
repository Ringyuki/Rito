use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::source_locator::{
    RuntimeSourceLocator, RuntimeSourceLocatorMatchedBy, RuntimeSourceLocatorPendingReason,
};
use super::{SearchRuntimeResult, SearchTextPosition};

use crate::{
    epub::{PackageDocument, TocEntry},
    interaction::{FootnoteEntry, FootnoteKind},
    layout::{LayoutConfig, PaginationFlowChapterRange},
    resources::PublicationResources,
    xhtml::ChapterSource,
};

/// One painted rectangle of a text range on a page, addressed by the
/// run it belongs to and the run-local UTF-16 offsets it covers.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRangeRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub block_index: usize,
    pub line_index: usize,
    pub run_index: usize,
    pub start_char_index: usize,
    pub end_char_index: usize,
}

/// One text run's span inside a page's concatenated text, in UTF-16
/// offsets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRunOffset {
    pub start: usize,
    pub end: usize,
    pub block_index: usize,
    pub line_index: usize,
    pub run_index: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeResourceKind {
    Image,
    Font,
    Stylesheet,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeResource {
    pub revision_id: String,
    pub kind: RuntimeResourceKind,
    pub href: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFrameResourceWarmPlan {
    pub revision_id: String,
    pub center_spread_index: usize,
    pub display_spread_index: usize,
    pub spread_indexes: Vec<usize>,
}

impl RuntimeResource {
    pub fn byte_length(&self) -> usize {
        self.bytes.len()
    }
}

/// The page and spread counts of a revision's page table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionExtent {
    pub page_count: usize,
    pub spread_count: usize,
}

/// A published whole-book revision: its identity, the layout it was
/// paginated under and the size of its page table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionSummary {
    pub revision_id: String,
    pub revision_version: u32,
    pub layout_key: String,
    pub page_count: usize,
    pub spread_count: usize,
}

/// Explicit identity for the only chapter represented by a chapter-local
/// revision. Page and spread coordinates in that revision are local to this
/// chapter and must never be interpreted as publication-absolute indexes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalCoordinate {
    pub kind: RuntimeChapterLocalCoordinateKind,
    pub chapter_index: usize,
    pub href: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeChapterLocalCoordinateKind {
    ChapterLocal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalRevisionRequest {
    pub layout_config: LayoutConfig,
    pub target_chapter_index: usize,
    pub target_locator: RuntimeSourceLocator,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalRevisionHandle {
    pub revision_id: String,
    pub revision_version: u32,
    pub coordinate: RuntimeChapterLocalCoordinate,
}

/// A published chapter-local revision: its identity, the chapter it
/// paginated and the size of that chapter's page table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalRevisionSummary {
    pub revision_id: String,
    pub revision_version: u32,
    pub layout_key: String,
    pub coordinate: RuntimeChapterLocalCoordinate,
    pub local_page_count: usize,
    pub local_spread_count: usize,
}

/// The result of creating a chapter-local revision: its summary and where
/// the requested locator landed on the chapter's page table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCreatedChapterLocalRevision {
    pub revision: RuntimeChapterLocalRevisionSummary,
    pub target: RuntimeChapterLocalSourceLocatorResolution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeChapterLocalSourceLocatorResolution {
    Resolved {
        owner: RuntimeChapterLocalRevisionHandle,
        locator: RuntimeSourceLocator,
        spine_idref: String,
        local_page_index: usize,
        local_spread_index: usize,
        matched_by: RuntimeSourceLocatorMatchedBy,
    },
    Pending {
        owner: RuntimeChapterLocalRevisionHandle,
        locator: RuntimeSourceLocator,
        spine_idref: String,
        reason: RuntimeSourceLocatorPendingReason,
        matched_by: RuntimeSourceLocatorMatchedBy,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalRevisionError {
    pub kind: RuntimeRevisionErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeRevisionErrorKind {
    InvalidChapterLocalTarget,
    UnknownRevision,
    StaleRevisionVersion,
    ChapterLocalOwnerMismatch,
    EngineFailure,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionError {
    pub kind: RuntimeRevisionErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionPresentation {
    pub revision: RuntimeRevisionSummary,
    pub navigation: RuntimeRevisionNavigation,
    pub toc_targets: RuntimeTocTargets,
    pub font_families: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_font_faces: Option<RuntimeRequiredFontFaces>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionBundle {
    pub revision: RuntimeRevisionSummary,
    pub navigation: RuntimeRevisionNavigation,
    pub toc_targets: RuntimeTocTargets,
    pub footnotes: RuntimeFootnotes,
    pub chapter_text_indices: RuntimeChapterTextIndices,
    pub font_families: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_font_faces: Option<RuntimeRequiredFontFaces>,
}

pub const RUNTIME_REQUIRED_FONT_FACES_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequiredFontFaces {
    pub schema_version: u32,
    pub revision_id: String,
    pub faces: Vec<RuntimeRequiredFontFace>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequiredFontFace {
    pub family: String,
    pub href: String,
    pub style: String,
    pub weight: u16,
    pub shape_fingerprint: String,
    pub byte_length: usize,
    pub source_order: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionNavigation {
    pub revision_id: String,
    pub page_count: usize,
    pub spread_count: usize,
    pub spreads: Vec<RuntimeSpreadNavigation>,
    pub chapters: Vec<RuntimeChapterNavigation>,
    pub chapter_map: BTreeMap<String, PaginationFlowChapterRange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSpreadNavigation {
    pub spread_index: usize,
    pub page_indexes: Vec<usize>,
    pub left_page_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_page_index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTocTargets {
    pub revision_id: String,
    pub targets: Vec<RuntimeTocTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTocTarget {
    pub entry: TocEntry,
    pub page_index: usize,
    pub spread_index: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterNavigation {
    pub idref: String,
    pub href: String,
    pub linear: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_page: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_page: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_count: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePublicationInfo {
    pub package: PackageDocument,
    pub resources: PublicationResources,
    pub chapters: Vec<ChapterSource>,
    pub font_faces: Vec<RuntimeFontFaceSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFontFaceSummary {
    pub family: String,
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
}

/// Describes one cached frame's bytes: the `RITODL1` primitive list the
/// frame's display commands lower to at `ratio` device pixels per CSS
/// pixel. The command count, kind counts and hash describe the semantic
/// display list the bytes were lowered from — the frame's identity, which
/// the JSON projection is validated against — while `primitive_count`
/// and `byte_length` describe the bytes themselves.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFrameCommandBufferMetadata {
    pub revision_id: String,
    pub spread_index: usize,
    pub width: Value,
    pub height: Value,
    pub protocol_version: u32,
    pub ratio: f64,
    pub command_count: usize,
    pub command_counts: BTreeMap<String, usize>,
    pub primitive_count: usize,
    pub byte_length: usize,
    pub command_hash: String,
    pub resource_ref_count: usize,
    pub resource_table: Vec<String>,
    pub font_families: Vec<String>,
    pub image_dominated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeFrameCommandBuffer {
    pub metadata: RuntimeFrameCommandBufferMetadata,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInitialFrameRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spread_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_progress: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInitialFrameDecision {
    pub revision_id: String,
    pub spread_index: usize,
    pub display_spread_index: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSearchRequest {
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSearchResponse {
    pub revision_id: String,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub result_count: usize,
    pub results: Vec<RuntimeSearchResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSearchResult {
    pub page_index: usize,
    pub spread_index: usize,
    pub match_range: SearchRuntimeResult,
    pub source: RuntimeSearchSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeSearchSource {
    Resolved {
        href: String,
        source_range: super::source_locator::RuntimeSourceRange,
    },
    Unavailable {
        reason: RuntimeSearchSourceUnavailableReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeSearchSourceUnavailableReason {
    SourceUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLocatorRequest {
    pub href: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRuntimeLocator {
    pub revision_id: String,
    pub href: String,
    pub spine_idref: String,
    pub page_index: usize,
    pub spread_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fragment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePrefetchRequest {
    pub spread_indexes: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePrefetchResponse {
    pub revision_id: String,
    pub warmed_spread_indexes: Vec<usize>,
    pub missing_spread_indexes: Vec<usize>,
    pub cached_frame_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimePageTargetKind {
    Text,
    Link,
    Image,
    Footnote,
    /// The href is a semantic noteref, but its definition has not been
    /// indexed yet. Hosts can defer the popup without misclassifying it as a
    /// normal link.
    FootnotePending,
}

/// Visual bounds in page-content coordinates, after layout transforms and
/// clipping have been applied.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePageTargetBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePageTargetText {
    pub hash: String,
    /// UTF-16 code-unit length, matching the reader's text-position model.
    pub length: usize,
}

/// One paint-order page target. `kind` follows the semantic priority
/// resolved/pending footnote > link > standalone image > text. Linked images
/// remain links and retain their image metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePageTarget {
    pub kind: RuntimePageTargetKind,
    pub bounds: RuntimePageTargetBounds,
    pub block_index: usize,
    pub line_index: usize,
    pub run_index: usize,
    pub label: String,
    pub text: RuntimePageTargetText,
    /// Original EPUB href. Internal canonicalization is carried separately by
    /// `target_locator`, preserving source-relative and fragment-only values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    /// Canonical locator for the target's source node. It is absent when the
    /// layout did not retain enough source identity to construct one safely.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_locator: Option<RuntimeSourceLocator>,
    /// Canonical destination for an internal href. External hrefs deliberately
    /// have no target locator.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_locator: Option<RuntimeSourceLocator>,
    /// Publication TOC label for the canonical internal destination. This is
    /// independent of whether the destination has been paginated yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_src: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_alt: Option<String>,
    /// Exact canonical key for resolved and pending footnote targets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footnote_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePageTargets {
    pub revision_id: String,
    pub page_index: usize,
    pub spread_index: usize,
    pub entry_count: usize,
    pub text_hash: String,
    pub entries: Vec<RuntimePageTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePageTextPositions {
    pub revision_id: String,
    pub page_index: usize,
    pub spread_index: usize,
    pub text: String,
    pub text_length: usize,
    pub text_hash: String,
    pub offsets: Vec<TextRunOffset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextRangeGeometryRequest {
    pub page_index: usize,
    pub start: SearchTextPosition,
    pub end: SearchTextPosition,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextRangeGeometry {
    pub revision_id: String,
    pub page_index: usize,
    pub spread_index: usize,
    pub rect_count: usize,
    pub rects: Vec<TextRangeRect>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFootnote {
    pub revision_id: String,
    pub key: String,
    pub kind: FootnoteKind,
    pub text: String,
    pub html: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFootnotes {
    pub revision_id: String,
    /// True when publication-wide discovery and selected definition parsing
    /// are complete for this revision.
    pub complete: bool,
    /// Canonical noteref keys whose definitions are not available yet.
    pub pending_keys: Vec<String>,
    pub entries: BTreeMap<String, FootnoteEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterTextSpan {
    pub node_path: Vec<usize>,
    pub source_start: usize,
    pub source_end: usize,
    pub normalized_start: usize,
    pub normalized_end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterTextIndex {
    pub href: String,
    pub normalized_text: String,
    pub spans: Vec<RuntimeChapterTextSpan>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterTextIndices {
    pub revision_id: String,
    pub entries: BTreeMap<String, RuntimeChapterTextIndex>,
}
