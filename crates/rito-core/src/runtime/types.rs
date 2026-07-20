use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::source_locator::{
    RuntimeSourceLocator, RuntimeSourceLocatorMatchedBy, RuntimeSourceLocatorPendingReason,
};

use crate::{
    epub::{PackageDocument, TocEntry},
    interaction::{FootnoteEntry, FootnoteKind},
    layout::{
        FontVerticalMetricDemand, FontVerticalMetricSample, LayoutConfig, LineBreaking,
        PaginationFlowChapterRange, SearchRuntimeResult, SearchTextPosition, TextRangeRect,
        TextRunOffset,
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

/// Maximum top-level source nodes that one continuation quantum may accept.
///
/// Greedy leaf paragraphs at the root and inside ordinary transparent
/// containers share internal descendant-node and line-box quanta. Visually
/// decorated or floated containers, tables, optimal paragraphs, paragraph
/// or container preparation, and individual shaping calls remain atomic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionWorkBudget {
    pub max_top_level_nodes: usize,
}

/// Hard memory bound for a provisional chapter-local revision.
///
/// A caller may choose a smaller cap, but cannot request a larger window.
pub const RUNTIME_CHAPTER_LOCAL_PAGE_CAP_MAX: usize = 16;

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
pub struct RuntimeBoundedChapterLocalRevisionRequest {
    pub layout_config: LayoutConfig,
    #[serde(default = "default_revision_line_breaking")]
    pub line_breaking: LineBreaking,
    pub target_chapter_index: usize,
    pub target_locator: RuntimeSourceLocator,
    pub local_page_cap: usize,
    pub budget: RuntimeRevisionWorkBudget,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalRevisionHandle {
    pub revision_id: String,
    pub revision_version: u32,
    pub coordinate: RuntimeChapterLocalCoordinate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalRevisionCursor {
    pub owner: RuntimeChapterLocalRevisionHandle,
    pub cursor: String,
    pub target_locator: RuntimeSourceLocator,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeContinueChapterLocalRevisionRequest {
    pub continuation: RuntimeChapterLocalRevisionCursor,
    pub budget: RuntimeRevisionWorkBudget,
}

/// Transfers a chapter-local break token into a fresh bounded revision.
///
/// The source revision remains immutable and independently releasable. The
/// layout session itself is moved, so the destination window resumes at the
/// exact page boundary without replaying the chapter prefix.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRolloverChapterLocalRevisionRequest {
    pub continuation: RuntimeChapterLocalRevisionCursor,
    pub budget: RuntimeRevisionWorkBudget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalRevisionExtent {
    pub local_page_count: usize,
    pub local_spread_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalPageRange {
    pub start_local_page: usize,
    pub end_local_page_exclusive: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalRevisionSummary {
    pub revision_id: String,
    pub revision_version: u32,
    pub layout_key: String,
    pub status: RuntimeRevisionStatus,
    pub coordinate: RuntimeChapterLocalCoordinate,
    pub local_page_cap: usize,
    pub known_extent: RuntimeChapterLocalRevisionExtent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_extent: Option<RuntimeChapterLocalRevisionExtent>,
    pub page_cap_reached: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalRevisionAdvance {
    pub revision: RuntimeChapterLocalRevisionSummary,
    pub previous_known_extent: RuntimeChapterLocalRevisionExtent,
    pub newly_known_local_pages: RuntimeChapterLocalPageRange,
    pub processed_top_level_nodes: usize,
    pub target: RuntimeChapterLocalSourceLocatorResolution,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<RuntimeChapterLocalRevisionCursor>,
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
    pub kind: RuntimeContinuationErrorKind,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<Box<RuntimeChapterLocalRevisionSummary>>,
}

/// Request for the experimental core-only bounded revision path.
///
/// The first bounded request scans every spine XHTML source once to establish
/// exact publication-wide footnote targets and definitions. The scan is cached
/// and does not mark lazy chapters or binary resources as loaded. Unreadable
/// future spine resources are skipped so their failure remains deferred until
/// continuation reaches them. Malformed XHTML contributes no footnote data,
/// matching eager preparation.
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCalibrateRevisionFontVerticalMetricsRequest {
    pub revision_id: String,
    pub revision_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation: Option<RuntimeRevisionCursor>,
    pub font_vertical_metrics: Vec<FontVerticalMetricSample>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionFontVerticalMetricCalibration {
    pub revision: RuntimeRevisionSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<RuntimeRevisionCursor>,
    pub calibrated_published_run_count: usize,
    pub calibrated_unpublished_run_count: usize,
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
    /// Top-level source nodes accepted during this quantum. A continuation
    /// that only resumes an accepted paragraph can report zero while still
    /// making deterministic line-layout progress.
    pub processed_top_level_nodes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<RuntimeRevisionCursor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeContinuationErrorKind {
    InvalidBudget,
    InvalidChapterLocalTarget,
    InvalidPageCap,
    UnknownRevision,
    StaleRevisionVersion,
    UnknownCursor,
    CursorOwnerMismatch,
    ChapterLocalOwnerMismatch,
    ChapterLocalTargetMismatch,
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
    /// Durable source identity to project before publishing the replacement view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preserve_locator: Option<RuntimeSourceLocator>,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRevisionPresentation {
    pub revision: RuntimeRevisionSummary,
    pub navigation: RuntimeRevisionNavigation,
    pub toc_targets: RuntimeTocTargets,
    pub font_families: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_vertical_metric_demands: Option<Vec<FontVerticalMetricDemand>>,
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
    pub font_vertical_metric_demands: Option<Vec<FontVerticalMetricDemand>>,
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

/// Paint-ready frame whose indexes are explicitly chapter-local.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterLocalFrame {
    pub owner: RuntimeChapterLocalRevisionHandle,
    pub local_spread_index: usize,
    pub local_page_indexes: Vec<usize>,
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

fn default_revision_line_breaking() -> LineBreaking {
    LineBreaking::Greedy
}
