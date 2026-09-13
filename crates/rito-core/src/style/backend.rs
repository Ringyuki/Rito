//! The production style resolver: selected stylesheets go through Stylo and
//! come back as the typed style tables the fragment engine reads.

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

use crate::{epub::StylesheetSourceLedger, xhtml::AuthorStylesheetSource};

use super::{
    stylo_sources::{select_stylo_sources, validate_stylo_source_arena, StyloSourceRejection},
    ChapterStyleOptions, CssColorScheme, CssViewport,
};

#[derive(Clone, Copy)]
pub(crate) struct PreparedStyleChapterInput<'a> {
    pub(crate) stylesheet_ledger: &'a StylesheetSourceLedger,
    pub(crate) chapter_href: &'a str,
    pub(crate) source_arena: Option<&'a Arc<SourceArena>>,
    pub(crate) body_source_node_id: Option<NodeId>,
    pub(crate) author_stylesheets: &'a [AuthorStylesheetSource],
}

/// One chapter's typed style tables: the interned layout and inline styles
/// every source node resolved to.
pub(crate) struct ResolvedPreparedChapterStyle {
    pub(crate) layout_style_table: rito_style_contract::LayoutStyleTable,
    pub(crate) inline_style_table: rito_style_contract::InlineStyleTable,
}

/// A typed failure from the Stylo pipeline, retaining the original
/// source-gate or Stylo error.
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
        }
    }
}

impl std::error::Error for StyleBackendError {}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct StyleBackendMetrics {
    pub(crate) stylo_successes: u64,
}

static STYLO_SUCCESSES: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
pub(crate) fn style_backend_metrics() -> StyleBackendMetrics {
    StyleBackendMetrics {
        stylo_successes: STYLO_SUCCESSES.load(Ordering::Relaxed),
    }
}

pub(crate) fn resolve_prepared_chapter_style(
    input: PreparedStyleChapterInput<'_>,
    viewport: Option<CssViewport>,
    options: ChapterStyleOptions<'_>,
) -> Result<ResolvedPreparedChapterStyle, StyleBackendError> {
    let resolved = try_resolve_with_stylo(input, viewport, options)?;
    STYLO_SUCCESSES.fetch_add(1, Ordering::Relaxed);
    Ok(resolved)
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
    if input.body_source_node_id.is_none() {
        return Err(StyleBackendError::MissingBodySourceNodeId);
    }
    let selection = select_stylo_sources(
        input.stylesheet_ledger,
        input.chapter_href,
        input.author_stylesheets,
    )
    .map_err(StyleBackendError::SourceSelection)?;
    validate_stylo_source_arena(source_arena).map_err(StyleBackendError::SourceArena)?;
    let viewport = stylo_viewport(viewport)?;

    // The EPUB support profile is the UA policy: it supplies the HTML
    // box-generation defaults publication content assumes, including table
    // box generation (a minimal sheet with `* { display: block }` cannot
    // generate a table box, so every `<table>` would lay out as a plain
    // block).
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
        .resolve_production_slice()
        .map_err(StyleBackendError::CascadeOrProjection)?;
    let (inline, layout) = projection.into_parts();
    Ok(ResolvedPreparedChapterStyle {
        layout_style_table: layout.into_table(),
        inline_style_table: inline.into_table(),
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
    // The selector is `*`, not `body`: `line-height` and `font-family` are
    // inherited, and inheritance loses to any declaration on the element
    // itself whatever its origin. A rule on `body` alone is therefore
    // invisible in every book that styles its own paragraphs — which is
    // nearly all of them.
    //
    // Importance is what separates the two intents:
    //
    // * unforced (user origin, normal) loses to the book's own explicit
    //   declarations, so a decorative title or an icon-font span keeps the
    //   face its author chose, while body text — which merely inherits —
    //   takes the reader's. That is "respect the book's own fonts".
    // * forced (user origin, `!important`) outranks even author
    //   `!important`, so the reader's value wins everywhere.
    let mut declarations = Vec::with_capacity(2);
    let important = |forced: bool| if forced { " !important" } else { "" };
    if let Some(line_height) = options.line_height_override {
        let line_height = configured_line_height(line_height)?;
        declarations.push(format!(
            "line-height: {line_height}{}",
            important(options.line_height_force)
        ));
    }
    if let Some(font_family) = options.font_family_override {
        let canonical = canonicalize_font_family_value(font_family).ok_or(
            StyleBackendError::UnsupportedConfiguration(
                "font family override must be a valid CSS font-family list",
            ),
        )?;
        declarations.push(format!(
            "font-family: {canonical}{}",
            important(options.font_family_force)
        ));
    }
    if declarations.is_empty() {
        return Ok(None);
    }
    Ok(Some(StylesheetInput::new(
        format!("* {{ {}; }}", declarations.join("; ")),
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
