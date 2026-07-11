use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    epub::{PackageDocument, TocEntry},
    interaction::{FootnoteEntry, FootnoteKind},
    layout::{
        LayoutConfig, LineBreaking, PaginationFlowChapterRange, SearchRuntimeResult,
        SearchTextPosition, TextRangeRect, TextRunOffset,
    },
    render::{DisplayListResourceRefs, PackedDisplayCommandRecordStats},
    resources::PublicationResources,
    xhtml::ChapterSource,
};

pub const DEFAULT_INITIAL_PREVIEW_CHAPTER_LIMIT: usize = 8;
pub const DEFAULT_DEFERRED_FULL_REFLOW_DELAY_MS: u64 = 1000;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionExtent {
    pub page_count: usize,
    pub spread_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeRevisionStatus {
    Warming,
    Ready,
    Complete,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionSummary {
    pub revision_id: String,
    pub revision_version: u32,
    pub layout_key: String,
    pub status: RuntimeRevisionStatus,
    pub known_extent: RuntimeRevisionExtent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_extent: Option<RuntimeRevisionExtent>,
    /// Backward-compatible alias for `known_extent.page_count`.
    pub page_count: usize,
    /// Backward-compatible alias for `known_extent.spread_count`.
    pub spread_count: usize,
}

/// Maximum top-level nodes that one continuation quantum may start.
///
/// A single large paragraph, table, or other node is currently atomic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionWorkBudget {
    pub max_top_level_nodes: usize,
}

/// Request for the experimental core-only bounded revision path.
///
/// Cross-chapter footnote references are not yet guaranteed to match an eager
/// revision, and this API is not wired into the production worker/WASM reader.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBoundedRevisionRequest {
    pub layout_config: LayoutConfig,
    #[serde(default = "default_revision_line_breaking")]
    pub line_breaking: LineBreaking,
    pub budget: RuntimeRevisionWorkBudget,
}

/// Opaque one-shot handle bound to one revision version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionCursor {
    pub revision_id: String,
    pub revision_version: u32,
    pub cursor: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeContinueRevisionRequest {
    pub revision_id: String,
    pub revision_version: u32,
    pub cursor: String,
    pub budget: RuntimeRevisionWorkBudget,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCancelRevisionRequest {
    pub revision_id: String,
    pub revision_version: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionPageRange {
    pub start_page: usize,
    pub end_page_exclusive: usize,
}

/// The newly published stable prefix and the cursor for the next quantum.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionAdvance {
    pub revision: RuntimeRevisionSummary,
    pub previous_known_extent: RuntimeRevisionExtent,
    pub newly_known_pages: RuntimeRevisionPageRange,
    pub processed_top_level_nodes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<RuntimeRevisionCursor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeContinuationErrorKind {
    InvalidBudget,
    UnknownRevision,
    StaleRevisionVersion,
    UnknownCursor,
    CursorOwnerMismatch,
    RevisionNotContinuable,
    EngineFailure,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeContinuationError {
    pub kind: RuntimeContinuationErrorKind,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<Box<RuntimeRevisionSummary>>,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct RuntimeRevisionRequest {
    pub layout_config: LayoutConfig,
    pub line_breaking: LineBreaking,
    pub preview_chapter_limit: Option<usize>,
    pub preview_chapter_index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInitialPreviewRevisionRequest {
    pub layout_config: LayoutConfig,
    #[serde(default = "default_revision_line_breaking")]
    pub line_breaking: LineBreaking,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFullRevisionBundleRequest {
    pub layout_config: LayoutConfig,
    #[serde(default = "default_revision_line_breaking")]
    pub line_breaking: LineBreaking,
    pub active_spread_index: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActiveChapterPreviewRevisionRequest {
    pub layout_config: LayoutConfig,
    #[serde(default = "default_revision_line_breaking")]
    pub line_breaking: LineBreaking,
    pub previous_revision_id: String,
    pub active_spread_index: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePreviewRevisionBundleRequest {
    pub layout_config: LayoutConfig,
    #[serde(default = "default_revision_line_breaking")]
    pub line_breaking: LineBreaking,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_revision_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_spread_index: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeViewRevisionMode {
    Preview,
    Full,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeViewRevisionRequest {
    pub layout_config: LayoutConfig,
    #[serde(default = "default_revision_line_breaking")]
    pub line_breaking: LineBreaking,
    pub active_spread_index: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_revision_id: Option<String>,
    pub mode: RuntimeViewRevisionMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeViewRevisionKind {
    Preview,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeViewRevisionDisplay {
    Revision,
    VisualPreview,
}

#[doc(hidden)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeViewRevisionMetadata {
    Complete,
    OmitFullChapterTextIndices,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCreatedViewRevision {
    pub kind: RuntimeViewRevisionKind,
    pub display: RuntimeViewRevisionDisplay,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_up: Option<RuntimeViewRevisionFollowUp>,
    pub revision: RuntimeCreatedRevisionBundle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeViewRevisionFollowUp {
    pub delay_ms: u64,
    pub request: RuntimeViewRevisionRequest,
}

impl RuntimeRevisionRequest {
    pub fn is_preview(&self) -> bool {
        self.preview_chapter_limit.is_some() || self.preview_chapter_index.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCreatedRevisionBundle {
    pub bundle: RuntimeRevisionBundle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_frame: Option<RuntimeInitialFrameDecision>,
    pub preview: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionBundle {
    pub revision: RuntimeRevisionSummary,
    pub navigation: RuntimeRevisionNavigation,
    pub toc_targets: RuntimeTocTargets,
    pub footnotes: RuntimeFootnotes,
    pub chapter_text_indices: RuntimeChapterTextIndices,
    pub font_families: Vec<String>,
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

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActiveChapterPreview {
    pub chapter_index: usize,
    pub progress: f64,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFrame {
    pub revision_id: String,
    pub spread_index: usize,
    pub page_indexes: Vec<usize>,
    pub width: Value,
    pub height: Value,
    pub commands: Vec<Value>,
    pub command_count: usize,
    pub command_counts: BTreeMap<String, usize>,
    pub command_hash: String,
    pub resource_refs: DisplayListResourceRefs,
    pub font_families: Vec<String>,
    pub image_dominated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFrameCommandBufferMetadata {
    pub revision_id: String,
    pub spread_index: usize,
    pub width: Value,
    pub height: Value,
    pub protocol_version: u32,
    pub command_count: usize,
    pub command_counts: BTreeMap<String, usize>,
    pub record_stats: PackedDisplayCommandRecordStats,
    pub byte_length: usize,
    pub command_hash: String,
    pub resource_ref_count: usize,
    pub resource_table: Vec<String>,
    pub font_families: Vec<String>,
    pub image_dominated: bool,
    pub string_table: Vec<String>,
    pub payload_table: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePageTargets {
    pub revision_id: String,
    pub page_index: usize,
    pub spread_index: usize,
    pub entry_count: usize,
    pub text_hash: String,
    pub entries: Vec<Value>,
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

fn default_revision_line_breaking() -> LineBreaking {
    LineBreaking::Greedy
}
