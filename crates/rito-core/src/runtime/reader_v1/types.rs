use std::{error::Error, fmt};

pub const READER_DISPLAY_LIST_VERSION_V1: u32 = 1;
pub const READER_CAPABILITY_PROFILE_STRING_TEXT_V1: u32 = 1;
pub const READER_IMAGE_RESOURCE_BYTES_MAX_V1: u64 = 32 * 1024 * 1024;
pub const READER_FONT_RESOURCE_BYTES_MAX_V1: u64 = 16 * 1024 * 1024;
pub const READER_STYLESHEET_RESOURCE_BYTES_MAX_V1: u64 = 4 * 1024 * 1024;
/// Externally visible identities stay in the positive signed-64-bit range for
/// exact interop across native runtimes, while wire slots remain `u64`.
pub const READER_EXTERNAL_ID_MAX_V1: u64 = i64::MAX as u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderSpreadModeV1 {
    Single,
    Double,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderTextRenderingProfileV1 {
    /// Core owns shaping, line breaking, and pagination. The adapter rasterizes
    /// positioned string runs with the revision's declared font inputs.
    PlatformStringRuns,
    /// Reserved for glyph IDs, positions, and clusters owned entirely by Core.
    PositionedGlyphRuns,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderLocatorMatchV1 {
    SourceRange,
    SourcePoint,
    Anchor,
    Progression,
    Href,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderResourceKindV1 {
    Image,
    Font,
    Stylesheet,
}

pub const fn reader_resource_bytes_max_v1(kind: ReaderResourceKindV1) -> u64 {
    match kind {
        ReaderResourceKindV1::Image => READER_IMAGE_RESOURCE_BYTES_MAX_V1,
        ReaderResourceKindV1::Font => READER_FONT_RESOURCE_BYTES_MAX_V1,
        ReaderResourceKindV1::Stylesheet => READER_STYLESHEET_RESOURCE_BYTES_MAX_V1,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderSourcePointV1 {
    pub node_path: Vec<u32>,
    /// UTF-16 code-unit offset within the canonical XHTML text node.
    pub text_offset: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderSourceRangeV1 {
    pub start: ReaderSourcePointV1,
    pub end: ReaderSourcePointV1,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderLocatorV1 {
    pub href: String,
    pub anchor_id: Option<String>,
    pub source_point: Option<ReaderSourcePointV1>,
    pub source_range: Option<ReaderSourceRangeV1>,
    pub progression: Option<f64>,
}

/// Immutable publication metadata projected from the EPUB package document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderPublicationMetadataV1 {
    pub title: String,
    pub language: String,
    pub identifier: String,
    pub creator: Option<String>,
}

/// One package spine item. Non-linear items remain present and simply omit a
/// linear index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderPublicationSpineItemV1 {
    pub spine_index: u32,
    pub linear_index: Option<u32>,
    pub idref: String,
    pub href: String,
}

/// Canonical destination of one table-of-contents entry.
#[derive(Debug, Clone, PartialEq)]
pub enum ReaderPublicationTocTargetV1 {
    Locator {
        spine_index: u32,
        locator: ReaderLocatorV1,
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
pub struct ReaderPublicationTocEntryV1 {
    pub toc_id: u32,
    pub label: String,
    pub target: ReaderPublicationTocTargetV1,
    pub children: Vec<ReaderPublicationTocEntryV1>,
}

/// Static publication snapshot owned by a reader session.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderPublicationV1 {
    pub protocol_version: u32,
    pub session_id: u64,
    pub metadata: ReaderPublicationMetadataV1,
    pub spine: Vec<ReaderPublicationSpineItemV1>,
    pub toc: Vec<ReaderPublicationTocEntryV1>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderLayoutV1 {
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub margin_top: f64,
    pub margin_right: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub spread_mode: ReaderSpreadModeV1,
    pub first_page_alone: bool,
    pub spread_gap: f64,
    pub root_font_size: f64,
    pub line_height_override: Option<f64>,
    pub font_family_override: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderWorkBudgetV1 {
    pub max_top_level_nodes_per_quantum: u32,
    pub max_foreground_quanta: u32,
    pub local_page_cap: u32,
}

/// Foreground request for an exact paint-ready artifact.
///
/// A successful request returns a live candidate; it does not change the
/// visible intent until `ReaderForegroundHandoffV1` is accepted.
///
/// If bounded work ends before the exact locator is published, Core returns
/// `TargetNotPublished` without producing a fallback artifact and retains one
/// unpublished continuation. A newer request for the same canonical locator,
/// layout, and local page cap resumes that continuation; any different valid
/// foreground seek supersedes it.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderArtifactRequestV1 {
    pub session_id: u64,
    pub request_id: u64,
    pub layout: ReaderLayoutV1,
    pub locator: ReaderLocatorV1,
    pub work: ReaderWorkBudgetV1,
    pub text_profile: ReaderTextRenderingProfileV1,
}

/// Direction is encoded as a fixed-width discriminant in `RITONAV1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderAdjacentDirectionV1 {
    Previous,
    Next,
}

/// Owned request for one artifact adjacent to an already-published artifact.
///
/// `from_artifact_id` is the stable navigation token. Runtime cursor strings
/// and platform-sized indexes never cross the protocol boundary. A successful
/// result remains invisible until an explicit foreground handoff. If bounded
/// work cannot yet publish the target, Core retains progress only for a newer
/// request with the same source artifact, direction, and local page cap;
/// adapters distinguish that suspension from a terminal boundary through
/// `ReaderSessionV1::has_pending_adjacent_v1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderAdjacentRequestV1 {
    pub session_id: u64,
    pub request_id: u64,
    pub from_artifact_id: u64,
    pub direction: ReaderAdjacentDirectionV1,
    pub work: ReaderWorkBudgetV1,
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
pub struct ReaderForegroundHandoffV1 {
    pub session_id: u64,
    pub expected_visible_artifact_id: Option<u64>,
    pub candidate_artifact_id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderForegroundHandoffAckV1 {
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
pub struct ReaderBackgroundRequestV1 {
    pub session_id: u64,
    pub expected_visible_artifact_id: u64,
    pub max_top_level_nodes_per_quantum: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderBackgroundStateV1 {
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
pub struct ReaderBackgroundAdvanceV1 {
    pub state: ReaderBackgroundStateV1,
    pub intent_request_id: u64,
    pub replaces_artifact_id: u64,
    pub artifact: Option<ReaderArtifactV1>,
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
pub struct ReaderBackgroundHandoffV1 {
    pub session_id: u64,
    pub expected_visible_artifact_id: u64,
    pub candidate_artifact_id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderBackgroundHandoffAckV1 {
    pub intent_request_id: u64,
    pub replaced_artifact_id: u64,
    pub visible_artifact_id: u64,
}

/// What a platform may expect when it requests one adjacent spread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderAdjacentAvailabilityV1 {
    /// The spread is already published and can be projected without layout.
    Available,
    /// The same bounded revision can publish it through continuation work.
    Pending,
    /// The adjacent target is in another linear spine chapter.
    ChapterBoundary,
    /// No adjacent linear chapter exists in this direction.
    Terminal,
    /// The bounded page cap was reached before the target became available.
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderNavigationV1 {
    pub previous: ReaderAdjacentAvailabilityV1,
    pub next: ReaderAdjacentAvailabilityV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderDisplayListV1 {
    pub format_version: u32,
    pub command_count: u32,
    pub semantic_digest: [u8; 32],
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderResourceRefV1 {
    pub kind: ReaderResourceKindV1,
    pub href: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderFontRefV1 {
    pub family: String,
    pub href: String,
    pub style: String,
    pub weight: u16,
    pub shape_fingerprint: String,
    pub byte_length: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReaderRectV1 {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderHitEntryV1 {
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
    pub bounds: ReaderRectV1,
    pub text: String,
    pub href: Option<String>,
    pub source_point: Option<ReaderSourcePointV1>,
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
pub struct ReaderSearchRequestV1 {
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
pub struct ReaderSearchResultV1 {
    pub page_index: u32,
    pub spread_index: u32,
    /// Where the match sits in the page's laid-out text, in the same
    /// coordinates `ReaderPageV1::text_runs` reports — feed these
    /// straight to `get_text_range_geometry` to paint the hit.
    pub start: ReaderTextPositionV1,
    pub end: ReaderTextPositionV1,
    /// Surrounding text for a result list.
    pub context: String,
    /// Durable source anchor for the match, absent when the layout did
    /// not retain enough source identity to build one. A host that
    /// stores a hit should store this, not the page index.
    pub locator: Option<ReaderLocatorV1>,
}

/// Results of one search over the revision backing an artifact.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderSearchResponseV1 {
    pub artifact_id: u64,
    pub query: String,
    /// True when the search stopped at the request's limit, so the host
    /// knows the list is a prefix rather than everything in scope.
    pub truncated: bool,
    /// Pages that existed to be searched when this ran. Scope grows as
    /// background pagination lays out more of the book, so the same
    /// query run twice legitimately returns different lists; this says
    /// how much was covered, which `truncated` cannot express.
    pub searched_page_count: u32,
    /// True once the revision behind the artifact has finished laying
    /// out, so the scope is the whole book and re-running the query
    /// cannot find more.
    pub scope_complete: bool,
    pub results: Vec<ReaderSearchResultV1>,
}

/// A position inside a page's laid-out text, in the same coordinates
/// `ReaderPageV1::text_runs` reports: block, line, run, then character
/// offset within that run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderTextPositionV1 {
    pub block_index: u32,
    pub line_index: u32,
    pub run_index: u32,
    pub char_index: u32,
}

/// Asks where a text range sits on a page so a host can paint a
/// selection or highlight anchored to source text rather than to a
/// pixel guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderTextRangeRequestV1 {
    pub session_id: u64,
    pub artifact_id: u64,
    pub page_index: u32,
    pub start: ReaderTextPositionV1,
    pub end: ReaderTextPositionV1,
}

/// One run-aligned rectangle of a resolved text range.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReaderTextRectV1 {
    pub bounds: ReaderRectV1,
    pub block_index: u32,
    pub line_index: u32,
    pub run_index: u32,
    pub start_char_index: u32,
    pub end_char_index: u32,
}

/// Geometry of a resolved text range. `rects` are in the artifact's
/// display-list space, exactly like [`ReaderHitEntryV1::bounds`], so a
/// host paints them straight onto the surface it drew the page on.
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderTextRangeGeometryV1 {
    pub artifact_id: u64,
    pub page_index: u32,
    pub rects: Vec<ReaderTextRectV1>,
}

/// EPUB semantic role of a footnote definition, taken verbatim from the
/// publication's `epub:type`. Hosts use it to title the popup (a
/// footnote and an endnote are read differently).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderFootnoteKindV1 {
    Footnote,
    Endnote,
    Rearnote,
    Note,
}

/// A resolved footnote definition. `text` is the plain reading text;
/// `html` is the same content as an allowlist-sanitized fragment that
/// preserves safe structure (emphasis, links, lists).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderFootnoteV1 {
    pub artifact_id: u64,
    pub key: String,
    pub kind: ReaderFootnoteKindV1,
    pub text: String,
    pub html: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderSemanticRoleV1 {
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
/// space, exactly like [`ReaderHitEntryV1::bounds`].
#[derive(Debug, Clone, PartialEq)]
pub struct ReaderSemanticNodeV1 {
    pub role: ReaderSemanticRoleV1,
    pub level: Option<u8>,
    pub text: Option<String>,
    pub alt: Option<String>,
    pub href: Option<String>,
    pub bounds: ReaderRectV1,
    pub children: Vec<ReaderSemanticNodeV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderTextRunOffsetV1 {
    pub start: u64,
    pub end: u64,
    pub block_index: u32,
    pub line_index: u32,
    pub run_index: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderPageV1 {
    pub page_index: u32,
    pub width: f64,
    pub height: f64,
    pub hits: Vec<ReaderHitEntryV1>,
    pub semantics: Vec<ReaderSemanticNodeV1>,
    pub text: String,
    pub text_length: u64,
    pub text_runs: Vec<ReaderTextRunOffsetV1>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReaderArtifactV1 {
    pub protocol_version: u32,
    pub capability_profile_id: u32,
    pub session_id: u64,
    pub request_id: u64,
    pub revision_id: u64,
    pub revision_version: u32,
    pub artifact_id: u64,
    pub locator: ReaderLocatorV1,
    pub matched_by: ReaderLocatorMatchV1,
    pub local_page_index: u32,
    pub local_spread_index: u32,
    pub local_page_indexes: Vec<u32>,
    pub width: f64,
    pub height: f64,
    pub terminal_extent: bool,
    /// Zero-based page number within the whole publication, present
    /// only for artifacts published from a whole-book (publication)
    /// revision. Chapter-local artifacts have no book-wide numbering —
    /// their `local_page_index` is a window ordinal — so the field is
    /// absent rather than zero.
    ///
    /// A fresh `request_artifact` (an exact seek, or a reflow at the
    /// same locator) is always served chapter-local, so it **drops**
    /// book numbering: both this and `book_page_count` go back to
    /// `None` until the background pump republishes a publication
    /// artifact and the host adopts it. Re-requesting the current page
    /// therefore loses the page number rather than refreshing it.
    pub book_page_index: Option<u32>,
    /// Whole-publication page count, present only once that revision's
    /// layout is complete. It is absent while pagination is still
    /// growing, so a host can render "page N" immediately and add
    /// "of M" when this appears — completion offers one final candidate
    /// through the ordinary background handoff so a reader who never
    /// turns a page still receives it.
    pub book_page_count: Option<u32>,
    pub navigation: ReaderNavigationV1,
    pub text_profile: ReaderTextRenderingProfileV1,
    pub display_list: ReaderDisplayListV1,
    pub resources: Vec<ReaderResourceRefV1>,
    pub fonts: Vec<ReaderFontRefV1>,
    pub pages: Vec<ReaderPageV1>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderResourceV1 {
    pub artifact_id: u64,
    pub kind: ReaderResourceKindV1,
    pub href: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReaderDisposeAckV1 {
    pub session_id: u64,
    pub released_artifacts: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderErrorKindV1 {
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
pub struct ReaderErrorV1 {
    pub kind: ReaderErrorKindV1,
    pub message: String,
}

impl ReaderErrorV1 {
    pub(super) fn new(kind: ReaderErrorKindV1, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl fmt::Display for ReaderErrorV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for ReaderErrorV1 {}
