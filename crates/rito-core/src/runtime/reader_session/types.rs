use std::{error::Error, fmt};

pub const READER_DISPLAY_LIST_VERSION: u32 = 1;
pub const READER_CAPABILITY_PROFILE_STRING_TEXT: u32 = 1;
pub const READER_IMAGE_RESOURCE_BYTES_MAX: u64 = 32 * 1024 * 1024;
pub const READER_FONT_RESOURCE_BYTES_MAX: u64 = 16 * 1024 * 1024;
pub const READER_STYLESHEET_RESOURCE_BYTES_MAX: u64 = 4 * 1024 * 1024;
/// Externally visible identities stay in the positive signed-64-bit range for
/// exact interop across native runtimes, while wire slots remain `u64`.
pub const READER_EXTERNAL_ID_MAX: u64 = i64::MAX as u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderSpreadMode {
    Single,
    Double,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderTextRenderingProfile {
    /// Core owns shaping, line breaking, and pagination. The adapter rasterizes
    /// positioned string runs with the revision's declared font inputs.
    PlatformStringRuns,
    /// Reserved for glyph IDs, positions, and clusters owned entirely by Core.
    PositionedGlyphRuns,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderLocatorMatch {
    SourceRange,
    SourcePoint,
    Anchor,
    Progression,
    Href,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderResourceKind {
    Image,
    Font,
    Stylesheet,
}

pub const fn reader_resource_bytes_max(kind: ReaderResourceKind) -> u64 {
    match kind {
        ReaderResourceKind::Image => READER_IMAGE_RESOURCE_BYTES_MAX,
        ReaderResourceKind::Font => READER_FONT_RESOURCE_BYTES_MAX,
        ReaderResourceKind::Stylesheet => READER_STYLESHEET_RESOURCE_BYTES_MAX,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderSourcePoint {
    pub node_path: Vec<u32>,
    /// UTF-16 code-unit offset within the canonical XHTML text node.
    pub text_offset: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderSourceRange {
    pub start: ReaderSourcePoint,
    pub end: ReaderSourcePoint,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderLocator {
    pub href: String,
    pub anchor_id: Option<String>,
    pub source_point: Option<ReaderSourcePoint>,
    pub source_range: Option<ReaderSourceRange>,
    pub progression: Option<f64>,
}

/// Immutable publication metadata projected from the EPUB package document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderPublicationMetadata {
    pub title: String,
    pub language: String,
    pub identifier: String,
    pub creator: Option<String>,
}

/// One package spine item. Non-linear items remain present and simply omit a
/// linear index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderPublicationSpineItem {
    pub spine_index: u32,
    pub linear_index: Option<u32>,
    pub idref: String,
    pub href: String,
}

/// Canonical destination of one table-of-contents entry.
#[derive(Debug, Clone, PartialEq)]
pub enum ReaderPublicationTocTarget {
    Locator {
        spine_index: u32,
        locator: ReaderLocator,
    },
    External {
        href: String,
    },
    Unresolved {
        href: String,
    },
}

/// A table-of-contents node. IDs are dense preorder identities within the
/// immutable publication snapshot.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderPublicationTocEntry {
    pub toc_id: u32,
    pub label: String,
    pub target: ReaderPublicationTocTarget,
    pub children: Vec<ReaderPublicationTocEntry>,
}

/// Static publication snapshot owned by a reader session.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderPublication {
    pub protocol_version: u32,
    pub session_id: u64,
    pub metadata: ReaderPublicationMetadata,
    pub spine: Vec<ReaderPublicationSpineItem>,
    pub toc: Vec<ReaderPublicationTocEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderLayout {
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub margin_top: f64,
    pub margin_right: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub spread_mode: ReaderSpreadMode,
    pub first_page_alone: bool,
    pub spread_gap: f64,
    pub root_font_size: f64,
    pub line_height_override: Option<f64>,
    pub font_family_override: Option<String>,
    /// Device pixels per CSS pixel the host rasterizes this artifact at.
    /// Every raster snap in the display list lands on that grid. It is a
    /// paint parameter, not a layout one: pagination, page counts and
    /// revision identity are identical at every ratio.
    pub render_ratio: f64,
}

/// Foreground request for an exact paint-ready artifact.
///
/// The target chapter is parsed, styled and paginated whole inside this one
/// call, so the exact locator either publishes here or fails with a terminal
/// error; nothing is retained for a later request. A successful request
/// returns a live candidate; it does not change the visible intent until
/// `ReaderForegroundHandoff` is accepted.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderArtifactRequest {
    pub session_id: u64,
    pub request_id: u64,
    pub layout: ReaderLayout,
    pub locator: ReaderLocator,
    pub text_profile: ReaderTextRenderingProfile,
}

/// Direction is encoded as a fixed-width discriminant in `RITONAV1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderAdjacentDirection {
    Previous,
    Next,
}

/// Owned request for one artifact adjacent to an already-published artifact.
///
/// `from_artifact_id` is the stable navigation token. Runtime cursor strings
/// and platform-sized indexes never cross the protocol boundary. A turn that
/// crosses a chapter boundary paginates the whole neighbor chapter in this
/// one call. A successful result remains invisible until an explicit
/// foreground handoff. When the target cannot be published yet, Core retains
/// progress only for a newer request with the same source artifact and
/// direction; adapters distinguish that suspension from a terminal boundary
/// through `ReaderSession::has_pending_adjacent`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderAdjacentRequest {
    pub session_id: u64,
    pub request_id: u64,
    pub from_artifact_id: u64,
    pub direction: ReaderAdjacentDirection,
}

/// Host acknowledgement that atomically makes one foreground artifact
/// visible.
///
/// Foreground artifact and adjacent requests only create owned candidates.
/// The first candidate may be adopted with `expected_visible_artifact_id`
/// set to `None`; every replacement must name the artifact that is still
/// visible. This keeps slow or superseded foreground work from changing the
/// reader position behind the host's rendered frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderForegroundHandoff {
    pub session_id: u64,
    pub expected_visible_artifact_id: Option<u64>,
    pub candidate_artifact_id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderForegroundHandoffAck {
    pub intent_request_id: u64,
    pub replaced_artifact_id: Option<u64>,
    pub visible_artifact_id: u64,
}

/// One host-scheduled publication-revision quantum.
///
/// Core never creates a thread or repeats this work by itself. The expected
/// artifact is a compare-and-swap guard against publishing work for an intent
/// that a newer seek or turn already replaced. Retained exact work and a live
/// foreground candidate also block background work so user navigation always
/// takes priority over speculative publication completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderBackgroundRequest {
    pub session_id: u64,
    pub expected_visible_artifact_id: u64,
    pub max_top_level_nodes_per_quantum: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderBackgroundState {
    /// This call consumed one bounded publication footnote-index quantum.
    /// No publication layout work ran in the same call.
    Indexing,
    /// This call created the publication revision and ran its first quantum.
    Started,
    /// This call consumed exactly one continuation quantum.
    Advanced,
    /// The visible locator was already covered; no layout quantum was needed.
    Reused,
    /// A live handoff candidate already exists for this visible intent.
    CandidatePending,
    /// The publication is complete and no further continuation exists.
    Complete,
}

/// Result of one cooperative background step.
///
/// `artifact` is a CAS handoff candidate. It never changes which artifact is
/// visible inside Core; the host may adopt it only while
/// `replaces_artifact_id` is still current.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderBackgroundAdvance {
    pub state: ReaderBackgroundState,
    pub intent_request_id: u64,
    pub replaces_artifact_id: u64,
    pub artifact: Option<ReaderArtifact>,
    /// Whether adopting `artifact` would put different content on
    /// screen than `replaces_artifact_id` is showing.
    ///
    /// False is the ordinary handoff: the same page, renumbered onto
    /// the whole-book layout. True means pagination resolved the
    /// reading position onto a different page, so adopting moves the
    /// reader — a host that must not move the reader unprompted should
    /// release the candidate instead. Always false when there is no
    /// candidate.
    pub moves_visible_content: bool,
}

/// Host acknowledgement that atomically adopts a previously returned
/// publication artifact while the foreground artifact is still current and no
/// foreground candidate is awaiting host adoption.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderBackgroundHandoff {
    pub session_id: u64,
    pub expected_visible_artifact_id: u64,
    pub candidate_artifact_id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderBackgroundHandoffAck {
    pub intent_request_id: u64,
    pub replaced_artifact_id: u64,
    pub visible_artifact_id: u64,
}

/// What a platform may expect when it requests one adjacent spread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderAdjacentAvailability {
    /// The spread is on the same revision's page table and projects
    /// without layout.
    Available,
    /// The adjacent target is in another linear spine chapter.
    ChapterBoundary,
    /// No adjacent linear chapter exists in this direction.
    Terminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderNavigation {
    pub previous: ReaderAdjacentAvailability,
    pub next: ReaderAdjacentAvailability,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderDisplayList {
    pub format_version: u32,
    pub command_count: u32,
    pub semantic_digest: [u8; 32],
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderResourceRef {
    pub kind: ReaderResourceKind,
    pub href: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderFontRef {
    pub family: String,
    pub href: String,
    pub style: String,
    pub weight: u16,
    pub shape_fingerprint: String,
    pub byte_length: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReaderRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderHitEntry {
    pub page_index: u32,
    /// Display-list space: the same coordinates the artifact's own
    /// commands paint in, spread page offset and page margins included.
    /// A host hit-tests taps on its painted surface directly against
    /// this, with no correction of its own.
    ///
    /// This deliberately differs from [`crate::runtime::RuntimePageTarget`],
    /// whose bounds stay content-box relative because the browser
    /// binding applies its own transform. The two producers serve
    /// different hosts; do not "unify" them without moving that
    /// transform too.
    pub bounds: ReaderRect,
    pub text: String,
    pub href: Option<String>,
    pub source_point: Option<ReaderSourcePoint>,
    pub image_src: Option<String>,
    pub image_alt: Option<String>,
    /// Canonical footnote key when this hit is a semantic noteref, in
    /// the publication-relative `href#fragment` form the footnote index
    /// is keyed by. Present for both indexed and not-yet-indexed
    /// definitions; [`Self::footnote_pending`] distinguishes them. Hosts
    /// pass it to `read_footnote` verbatim — no host-side normalization.
    pub footnote_key: Option<String>,
    /// True while the key's definition has not been indexed yet. The
    /// host may show a loading affordance; the key stays valid and the
    /// same read succeeds once the publication footnote index completes.
    pub footnote_pending: bool,
}

/// Asks the revision behind an artifact for matches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderSearchRequest {
    pub session_id: u64,
    pub artifact_id: u64,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    /// Maximum hits to return. Zero means unbounded, which on a whole
    /// book can be a long list — hosts should pass a real cap.
    pub limit: u32,
}

/// One in-book search hit.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderSearchResult {
    pub page_index: u32,
    pub spread_index: u32,
    /// Where the match sits in the page's laid-out text, in the same
    /// coordinates `ReaderPage::text_runs` reports — feed these
    /// straight to `get_text_range_geometry` to paint the hit.
    pub start: ReaderTextPosition,
    pub end: ReaderTextPosition,
    /// Surrounding text for a result list.
    pub context: String,
    /// Durable source anchor for the match, absent when the layout did
    /// not retain enough source identity to build one. A host that
    /// stores a hit should store this, not the page index.
    pub locator: Option<ReaderLocator>,
}

/// Results of one search over the revision backing an artifact.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderSearchResponse {
    pub artifact_id: u64,
    pub query: String,
    /// True when the search stopped at the request's limit, so the host
    /// knows the list is a prefix rather than everything in scope.
    pub truncated: bool,
    /// Pages the search covered: the page table of the revision behind
    /// the artifact — one chapter for a chapter-local artifact, the whole
    /// book for a publication one.
    pub searched_page_count: u32,
    pub results: Vec<ReaderSearchResult>,
}

/// A position inside a page's laid-out text, in the same coordinates
/// `ReaderPage::text_runs` reports: block, line, run, then character
/// offset within that run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderTextPosition {
    pub block_index: u32,
    pub line_index: u32,
    pub run_index: u32,
    pub char_index: u32,
}

/// Asks where a text range sits on a page so a host can paint a
/// selection or highlight anchored to source text rather than to a
/// pixel guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderTextRangeRequest {
    pub session_id: u64,
    pub artifact_id: u64,
    pub page_index: u32,
    pub start: ReaderTextPosition,
    pub end: ReaderTextPosition,
}

/// One run-aligned rectangle of a resolved text range.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReaderTextRect {
    pub bounds: ReaderRect,
    pub block_index: u32,
    pub line_index: u32,
    pub run_index: u32,
    pub start_char_index: u32,
    pub end_char_index: u32,
}

/// Geometry of a resolved text range. `rects` are in the artifact's
/// display-list space, exactly like [`ReaderHitEntry::bounds`], so a
/// host paints them straight onto the surface it drew the page on.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderTextRangeGeometry {
    pub artifact_id: u64,
    pub page_index: u32,
    pub rects: Vec<ReaderTextRect>,
}

/// EPUB semantic role of a footnote definition, taken verbatim from the
/// publication's `epub:type`. Hosts use it to title the popup (a
/// footnote and an endnote are read differently).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderFootnoteKind {
    Footnote,
    Endnote,
    Rearnote,
    Note,
}

/// A resolved footnote definition. `text` is the plain reading text;
/// `html` is the same content as an allowlist-sanitized fragment that
/// preserves safe structure (emphasis, links, lists).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderFootnote {
    pub artifact_id: u64,
    pub key: String,
    pub kind: ReaderFootnoteKind,
    pub text: String,
    pub html: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderSemanticRole {
    Heading,
    Paragraph,
    List,
    ListItem,
    Image,
    Link,
    Blockquote,
    Table,
    Generic,
}

/// Accessibility node. Its `bounds` share the artifact's display-list
/// space, exactly like [`ReaderHitEntry::bounds`].
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderSemanticNode {
    pub role: ReaderSemanticRole,
    pub level: Option<u8>,
    pub text: Option<String>,
    pub alt: Option<String>,
    pub href: Option<String>,
    pub bounds: ReaderRect,
    pub children: Vec<ReaderSemanticNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderTextRunOffset {
    pub start: u64,
    pub end: u64,
    pub block_index: u32,
    pub line_index: u32,
    pub run_index: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderPage {
    pub page_index: u32,
    pub width: f64,
    pub height: f64,
    pub hits: Vec<ReaderHitEntry>,
    pub semantics: Vec<ReaderSemanticNode>,
    pub text: String,
    pub text_length: u64,
    pub text_runs: Vec<ReaderTextRunOffset>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderArtifact {
    pub protocol_version: u32,
    pub capability_profile_id: u32,
    pub session_id: u64,
    pub request_id: u64,
    pub revision_id: u64,
    pub revision_version: u32,
    pub artifact_id: u64,
    pub locator: ReaderLocator,
    pub matched_by: ReaderLocatorMatch,
    pub local_page_index: u32,
    pub local_spread_index: u32,
    pub local_page_indexes: Vec<u32>,
    pub width: f64,
    pub height: f64,
    /// Zero-based page number within the whole publication, present
    /// only for artifacts published from a whole-book (publication)
    /// revision. Chapter-local artifacts have no book-wide numbering —
    /// their `local_page_index` is a window ordinal — so the field is
    /// absent rather than zero.
    ///
    /// A fresh `request_artifact` (an exact seek, or a reflow at the
    /// same locator) is always served chapter-local, so it **drops**
    /// book numbering: both this and `book_page_count` go back to
    /// `None` until the background pump publishes a publication
    /// artifact and the host adopts it. Re-requesting the current page
    /// therefore loses the page number rather than refreshing it.
    pub book_page_index: Option<u32>,
    /// Whole-publication page count, present together with
    /// `book_page_index` on every artifact published from a publication
    /// revision (the revision holds its complete page table from the
    /// moment it exists) and absent on chapter-local artifacts.
    pub book_page_count: Option<u32>,
    pub navigation: ReaderNavigation,
    pub text_profile: ReaderTextRenderingProfile,
    pub display_list: ReaderDisplayList,
    pub resources: Vec<ReaderResourceRef>,
    pub fonts: Vec<ReaderFontRef>,
    pub pages: Vec<ReaderPage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderResource {
    pub artifact_id: u64,
    pub kind: ReaderResourceKind,
    pub href: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderDisposeAck {
    pub session_id: u64,
    pub released_artifacts: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderErrorKind {
    InvalidSession,
    InvalidRequest,
    InvalidLayout,
    InvalidLocator,
    UnsupportedTextProfile,
    StaleRequest,
    TargetNotPublished,
    UnknownArtifact,
    NumericOverflow,
    InvalidWire,
    EngineFailure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderError {
    pub kind: ReaderErrorKind,
    pub message: String,
}

impl ReaderError {
    pub(super) fn new(kind: ReaderErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl fmt::Display for ReaderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for ReaderError {}
