//! Production style-engine selection boundary.
//!
//! All runtime layout entry points go through the strict Stylo resolver. The
//! legacy parser is reachable only through the explicitly named compatibility
//! resolver used by compatibility diagnostics.

use std::fmt;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

use rito_source::{NodeId, SourceArena};
use rito_stylo::{
    canonicalize_font_family_value, ColorScheme, StyleDocument, StyleError, StyleOrigin,
    StylesheetInput, Viewport as StyloViewport,
};

#[cfg(feature = "legacy-css-diagnostics")]
use crate::xhtml::ElementAttributes;
use crate::{
    css::{CssColorScheme, CssViewport},
    epub::StylesheetSourceLedger,
    xhtml::{AuthorStylesheetSource, DocumentNode},
};

#[cfg(feature = "legacy-css-diagnostics")]
use super::{build_chapter_rules, resolve_chapter_style_nodes};
use super::{
    stylo_materialize::{
        materialize_stylo_chapter, StyloMaterializeInput, StyloMaterializeRejection,
    },
    stylo_sources::{
        select_stylo_sources, validate_stylo_source_arena, StyleCapabilityImpact,
        StyleCapabilityReport, StyloSourceRejection,
    },
    ChapterStyleOptions,
};

#[derive(Clone, Copy)]
pub(crate) struct PreparedStyleChapterInput<'a> {
    pub(crate) stylesheet_ledger: &'a StylesheetSourceLedger,
    pub(crate) chapter_href: &'a str,
    pub(crate) source_arena: Option<&'a Arc<SourceArena>>,
    pub(crate) body_source_node_id: Option<NodeId>,
    pub(crate) nodes: &'a [DocumentNode],
    pub(crate) pagination_nodes: Option<&'a [DocumentNode]>,
    #[cfg(feature = "legacy-css-diagnostics")]
    pub(crate) body_attributes: Option<&'a ElementAttributes>,
    pub(crate) author_stylesheets: &'a [AuthorStylesheetSource],
}

pub(crate) struct ResolvedPreparedChapterStyle {
    pub(crate) styled_nodes: Vec<super::StyledNode>,
    pub(crate) pagination_styled_nodes: Option<Vec<super::StyledNode>>,
    pub(crate) page_paint: Option<serde_json::Value>,
    /// The typed layout styles this chapter's nodes resolved to, retained
    /// past materialization so typed consumers never re-derive styles from
    /// the JSON style maps.
    pub(crate) layout_style_table: rito_style_contract::LayoutStyleTableV1,
    /// The typed inline styles, retained for the same consumers.
    pub(crate) inline_style_table: rito_style_contract::InlineStyleTableV1,
    /// What this chapter's CSS asked for that the engine could not represent.
    /// Consumers use it to describe reduced fidelity instead of discovering it
    /// as a missing feature.
    pub(crate) capabilities: StyleCapabilityReport,
}

#[cfg(feature = "legacy-css-diagnostics")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StyleBackendFailureReason {
    SourceTopology,
    UnsupportedConfiguration,
    SourceGate,
    InvalidViewport,
    StyloEngine,
    Materialization,
}

/// A typed failure from the strict production Stylo pipeline.
///
/// Variants retain the original source-gate, Stylo, or materialization error
/// instead of collapsing failures into the old fallback counter.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum StyleBackendError {
    MissingSourceArena,
    MissingBodySourceNodeId,
    UnsupportedConfiguration(&'static str),
    SourceSelection(StyloSourceRejection),
    SourceArena(StyloSourceRejection),
    InvalidViewport(&'static str),
    DocumentConstruction(StyleError),
    CascadeOrProjection(StyleError),
    Materialization(StyloMaterializeRejection),
}

#[cfg(feature = "legacy-css-diagnostics")]
impl StyleBackendError {
    fn reason(&self) -> StyleBackendFailureReason {
        match self {
            Self::MissingSourceArena | Self::MissingBodySourceNodeId => {
                StyleBackendFailureReason::SourceTopology
            }
            Self::UnsupportedConfiguration(_) => {
                StyleBackendFailureReason::UnsupportedConfiguration
            }
            Self::SourceSelection(_) | Self::SourceArena(_) => {
                StyleBackendFailureReason::SourceGate
            }
            Self::InvalidViewport(_) => StyleBackendFailureReason::InvalidViewport,
            Self::DocumentConstruction(_) | Self::CascadeOrProjection(_) => {
                StyleBackendFailureReason::StyloEngine
            }
            Self::Materialization(_) => StyleBackendFailureReason::Materialization,
        }
    }
}

impl fmt::Display for StyleBackendError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSourceArena => formatter.write_str("canonical source arena is missing"),
            Self::MissingBodySourceNodeId => {
                formatter.write_str("canonical body source node id is missing")
            }
            Self::UnsupportedConfiguration(reason) => {
                write!(formatter, "unsupported style configuration: {reason}")
            }
            Self::SourceSelection(error) => {
                write!(formatter, "stylesheet source selection rejected: {error:?}")
            }
            Self::SourceArena(error) => {
                write!(formatter, "source arena validation rejected: {error:?}")
            }
            Self::InvalidViewport(reason) => write!(formatter, "invalid viewport: {reason}"),
            Self::DocumentConstruction(error) => {
                write!(formatter, "Stylo document construction failed: {error}")
            }
            Self::CascadeOrProjection(error) => {
                write!(formatter, "Stylo cascade or projection failed: {error}")
            }
            Self::Materialization(error) => {
                write!(formatter, "Stylo materialization rejected: {error:?}")
            }
        }
    }
}

impl std::error::Error for StyleBackendError {}

#[cfg(any(test, feature = "bench-internals"))]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct StyleBackendMetrics {
    pub(crate) stylo_successes: u64,
    pub(crate) legacy_fallbacks: u64,
    pub(crate) source_topology_fallbacks: u64,
    pub(crate) unsupported_configuration_fallbacks: u64,
    pub(crate) source_gate_fallbacks: u64,
    pub(crate) invalid_viewport_fallbacks: u64,
    pub(crate) stylo_engine_fallbacks: u64,
    pub(crate) materialization_fallbacks: u64,
}

static STYLO_SUCCESSES: AtomicU64 = AtomicU64::new(0);
#[cfg(feature = "legacy-css-diagnostics")]
static LEGACY_FALLBACKS: AtomicU64 = AtomicU64::new(0);
#[cfg(feature = "legacy-css-diagnostics")]
static SOURCE_TOPOLOGY_FALLBACKS: AtomicU64 = AtomicU64::new(0);
#[cfg(feature = "legacy-css-diagnostics")]
static UNSUPPORTED_CONFIGURATION_FALLBACKS: AtomicU64 = AtomicU64::new(0);
#[cfg(feature = "legacy-css-diagnostics")]
static SOURCE_GATE_FALLBACKS: AtomicU64 = AtomicU64::new(0);
#[cfg(feature = "legacy-css-diagnostics")]
static INVALID_VIEWPORT_FALLBACKS: AtomicU64 = AtomicU64::new(0);
#[cfg(feature = "legacy-css-diagnostics")]
static STYLO_ENGINE_FALLBACKS: AtomicU64 = AtomicU64::new(0);
#[cfg(feature = "legacy-css-diagnostics")]
static MATERIALIZATION_FALLBACKS: AtomicU64 = AtomicU64::new(0);

#[cfg(any(test, feature = "bench-internals"))]
pub(crate) fn style_backend_metrics() -> StyleBackendMetrics {
    let [legacy_fallbacks, source_topology_fallbacks, unsupported_configuration_fallbacks, source_gate_fallbacks, invalid_viewport_fallbacks, stylo_engine_fallbacks, materialization_fallbacks] =
        legacy_fallback_metrics();
    StyleBackendMetrics {
        stylo_successes: STYLO_SUCCESSES.load(Ordering::Relaxed),
        legacy_fallbacks,
        source_topology_fallbacks,
        unsupported_configuration_fallbacks,
        source_gate_fallbacks,
        invalid_viewport_fallbacks,
        stylo_engine_fallbacks,
        materialization_fallbacks,
    }
}

#[cfg(any(test, feature = "bench-internals"))]
fn legacy_fallback_metrics() -> [u64; 7] {
    #[cfg(feature = "legacy-css-diagnostics")]
    {
        [
            LEGACY_FALLBACKS.load(Ordering::Relaxed),
            SOURCE_TOPOLOGY_FALLBACKS.load(Ordering::Relaxed),
            UNSUPPORTED_CONFIGURATION_FALLBACKS.load(Ordering::Relaxed),
            SOURCE_GATE_FALLBACKS.load(Ordering::Relaxed),
            INVALID_VIEWPORT_FALLBACKS.load(Ordering::Relaxed),
            STYLO_ENGINE_FALLBACKS.load(Ordering::Relaxed),
            MATERIALIZATION_FALLBACKS.load(Ordering::Relaxed),
        ]
    }
    #[cfg(not(feature = "legacy-css-diagnostics"))]
    {
        [0; 7]
    }
}

pub(crate) fn resolve_prepared_chapter_style(
    input: PreparedStyleChapterInput<'_>,
    viewport: Option<CssViewport>,
    options: ChapterStyleOptions<'_>,
) -> Result<ResolvedPreparedChapterStyle, StyleBackendError> {
    match try_resolve_with_stylo(input, viewport, options) {
        Ok(resolved) => {
            STYLO_SUCCESSES.fetch_add(1, Ordering::Relaxed);
            Ok(resolved)
        }
        Err(error) => {
            log_stylo_failure("production failure", &error);
            Err(error)
        }
    }
}

/// Explicit compatibility-only resolver. Production and runtime callers use
/// [`resolve_prepared_chapter_style`] and therefore never enter this branch.
#[cfg(feature = "legacy-css-diagnostics")]
pub(crate) fn resolve_prepared_chapter_style_with_legacy_compatibility(
    input: PreparedStyleChapterInput<'_>,
    viewport: Option<CssViewport>,
    options: ChapterStyleOptions<'_>,
) -> ResolvedPreparedChapterStyle {
    match try_resolve_with_stylo(input, viewport, options) {
        Ok(resolved) => {
            STYLO_SUCCESSES.fetch_add(1, Ordering::Relaxed);
            resolved
        }
        Err(error) => {
            log_stylo_failure("explicit compatibility fallback", &error);
            record_legacy_fallback(error.reason());
            resolve_with_legacy_compatibility(input, viewport, options)
        }
    }
}

fn try_resolve_with_stylo(
    input: PreparedStyleChapterInput<'_>,
    viewport: Option<CssViewport>,
    options: ChapterStyleOptions<'_>,
) -> Result<ResolvedPreparedChapterStyle, StyleBackendError> {
    let root_font_size = configured_root_font_size(options.root_font_size)?;
    let source_arena = input
        .source_arena
        .ok_or(StyleBackendError::MissingSourceArena)?;
    let body_source_node_id = input
        .body_source_node_id
        .ok_or(StyleBackendError::MissingBodySourceNodeId)?;
    let selection = select_stylo_sources(
        input.stylesheet_ledger,
        input.chapter_href,
        input.author_stylesheets,
    )
    .map_err(StyleBackendError::SourceSelection)?;
    let mut capabilities = selection.capabilities;
    validate_stylo_source_arena(source_arena, &mut capabilities)
        .map_err(StyleBackendError::SourceArena)?;
    let viewport = stylo_viewport(viewport)?;

    // The EPUB support profile is the UA policy: it supplies the HTML
    // box-generation defaults publication content assumes, including table
    // box generation. The legacy pair it replaced (a minimal sheet plus
    // `* { display: block }`) could not generate a table box at all, so
    // every `<table>` laid out as a plain block.
    let mut stylesheets = Vec::with_capacity(selection.stylesheets.len() + 3);
    stylesheets.push(StylesheetInput::new(
        rito_stylo::epub_ua_stylesheet(),
        selection.document_url.clone(),
        StyleOrigin::UserAgent,
    ));
    if let Some(override_sheet) = typography_override_stylesheet(options, &selection.document_url)?
    {
        stylesheets.push(override_sheet);
    }
    stylesheets.extend(selection.stylesheets);
    let mut document = StyleDocument::from_source_with_root_font_size(
        Arc::clone(source_arena),
        &selection.document_url,
        viewport,
        root_font_size,
        &stylesheets,
    )
    .map_err(StyleBackendError::DocumentConstruction)?;
    drop(stylesheets);
    let projection = document
        .resolve_production_slice_v1()
        .map_err(StyleBackendError::CascadeOrProjection)?;
    let (inline, layout) = projection.into_parts();
    drop(document);
    let resolved = materialize_stylo_chapter(StyloMaterializeInput {
        source_arena,
        inline: &inline,
        layout: &layout,
        nodes: input.nodes,
        pagination_nodes: input.pagination_nodes,
        body_node_id: body_source_node_id,
        options,
    })
    .map_err(StyleBackendError::Materialization)?;
    for subject in &resolved.degradations {
        capabilities.record(StyleCapabilityImpact::Degraded, 0, subject.clone());
    }
    Ok(ResolvedPreparedChapterStyle {
        styled_nodes: resolved.styled_nodes,
        pagination_styled_nodes: resolved.pagination_styled_nodes,
        page_paint: resolved.page_paint,
        layout_style_table: layout.into_table(),
        inline_style_table: inline.into_table(),
        capabilities,
    })
}

fn configured_root_font_size(value: f64) -> Result<f32, StyleBackendError> {
    let value = value as f32;
    if value.is_finite() && value > 0.0 {
        Ok(value)
    } else {
        Err(StyleBackendError::UnsupportedConfiguration(
            "root font size must be finite and greater than zero",
        ))
    }
}

fn typography_override_stylesheet(
    options: ChapterStyleOptions<'_>,
    document_url: &str,
) -> Result<Option<StylesheetInput>, StyleBackendError> {
    let mut declarations = Vec::with_capacity(2);
    if let Some(line_height) = options.line_height_override {
        let line_height = configured_line_height(line_height)?;
        declarations.push(format!("line-height: {line_height} !important"));
    }
    if let Some(font_family) = options.font_family_override {
        let canonical = canonicalize_font_family_value(font_family).ok_or(
            StyleBackendError::UnsupportedConfiguration(
                "font family override must be a valid CSS font-family list",
            ),
        )?;
        declarations.push(format!("font-family: {canonical} !important"));
    }
    if declarations.is_empty() {
        return Ok(None);
    }
    Ok(Some(StylesheetInput::new(
        format!("body {{ {}; }}", declarations.join("; ")),
        document_url,
        StyleOrigin::User,
    )))
}

fn configured_line_height(value: f64) -> Result<f32, StyleBackendError> {
    let value = value as f32;
    if value.is_finite() && value >= 0.0 {
        Ok(value)
    } else {
        Err(StyleBackendError::UnsupportedConfiguration(
            "line height override must be finite and non-negative",
        ))
    }
}

fn log_stylo_failure(action: &str, error: &StyleBackendError) {
    #[cfg(feature = "bench-internals")]
    if std::env::var_os("RITO_STYLO_FALLBACK_DIAGNOSTICS").is_some() {
        eprintln!("rito Stylo {action}: {error}");
    }
    #[cfg(not(feature = "bench-internals"))]
    let _ = (action, error);
}

fn stylo_viewport(viewport: Option<CssViewport>) -> Result<StyloViewport, StyleBackendError> {
    let viewport = viewport.ok_or(StyleBackendError::InvalidViewport("viewport is missing"))?;
    let width = finite_positive_f32(viewport.width, "width")?;
    let height = finite_positive_f32(viewport.height, "height")?;
    let device_pixel_ratio =
        finite_positive_f32(viewport.device_pixel_ratio, "device pixel ratio")?;
    if !(width * device_pixel_ratio).is_finite() || !(height * device_pixel_ratio).is_finite() {
        return Err(StyleBackendError::InvalidViewport(
            "physical dimensions overflow f32",
        ));
    }
    Ok(StyloViewport {
        width,
        height,
        device_pixel_ratio,
        color_scheme: match viewport.color_scheme {
            CssColorScheme::Light => ColorScheme::Light,
            CssColorScheme::Dark => ColorScheme::Dark,
        },
    })
}

fn finite_positive_f32(value: f64, field: &'static str) -> Result<f32, StyleBackendError> {
    let converted = value as f32;
    if converted.is_finite() && converted > 0.0 {
        Ok(converted)
    } else {
        Err(StyleBackendError::InvalidViewport(field))
    }
}

#[cfg(feature = "legacy-css-diagnostics")]
fn record_legacy_fallback(reason: StyleBackendFailureReason) {
    LEGACY_FALLBACKS.fetch_add(1, Ordering::Relaxed);
    let counter = match reason {
        StyleBackendFailureReason::SourceTopology => &SOURCE_TOPOLOGY_FALLBACKS,
        StyleBackendFailureReason::UnsupportedConfiguration => &UNSUPPORTED_CONFIGURATION_FALLBACKS,
        StyleBackendFailureReason::SourceGate => &SOURCE_GATE_FALLBACKS,
        StyleBackendFailureReason::InvalidViewport => &INVALID_VIEWPORT_FALLBACKS,
        StyleBackendFailureReason::StyloEngine => &STYLO_ENGINE_FALLBACKS,
        StyleBackendFailureReason::Materialization => &MATERIALIZATION_FALLBACKS,
    };
    counter.fetch_add(1, Ordering::Relaxed);
}

#[cfg(feature = "legacy-css-diagnostics")]
fn resolve_with_legacy_compatibility(
    input: PreparedStyleChapterInput<'_>,
    viewport: Option<CssViewport>,
    options: ChapterStyleOptions<'_>,
) -> ResolvedPreparedChapterStyle {
    let legacy = input.stylesheet_ledger.legacy_artifacts();
    let rules = build_chapter_rules(
        legacy.stylesheet_rules(),
        input.author_stylesheets,
        options.root_font_size,
    );
    let resolved = resolve_chapter_style_nodes(
        input.nodes,
        &rules,
        input.body_attributes,
        viewport,
        options,
    );
    let pagination_styled_nodes = input.pagination_nodes.map(|nodes| {
        resolve_chapter_style_nodes(nodes, &rules, input.body_attributes, viewport, options)
            .styled_nodes
    });
    ResolvedPreparedChapterStyle {
        styled_nodes: resolved.styled_nodes,
        pagination_styled_nodes,
        page_paint: resolved.page_paint,
        // The legacy resolver has no typed projection and no source-gate
        // capability report; diagnostics-only.
        layout_style_table: rito_style_contract::LayoutStyleTableV1::new(0),
        inline_style_table: rito_style_contract::InlineStyleTableV1::new(0),
        capabilities: StyleCapabilityReport::default(),
    }
}
