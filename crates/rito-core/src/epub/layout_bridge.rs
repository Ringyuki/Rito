use std::collections::BTreeMap;

#[cfg(feature = "legacy-css-diagnostics")]
use crate::style::{
    resolve_prepared_chapter_style_with_legacy_compatibility, ParsedStyleChapterInput,
};
use crate::{
    layout::{
        create_layout_config, InlineSegmentChapterInput, LayoutConfig, LayoutConfigInput,
        LineBreaking, MarginInput, SpreadMode,
    },
    style::{
        resolve_prepared_chapter_style, rewrite_font_families, ChapterStyleOptions,
        FontFallbackPolicy, PreparedStyleChapterInput, StyleCapabilityReport, StyledNode,
    },
};

mod runtime;
#[cfg(test)]
mod tests;

pub(crate) use runtime::{
    build_prepared_loaded_document_runtime_layout, PreparedRuntimeLayoutOptions,
};

use super::{
    fonts::text_measurement_font_assembly_for_layout, open_document, EpubError, EpubPublication,
    EpubResult, LoadedEpubDocument, ParsedLoadedChapterSource, PreparedLoadedDocument,
};

pub fn load_publication(bytes: &[u8]) -> EpubResult<EpubPublication> {
    let layout_config = default_publication_layout_config();
    load_publication_with_layout(bytes, &layout_config)
}

pub fn load_publication_with_layout(
    bytes: &[u8],
    layout_config: &LayoutConfig,
) -> EpubResult<EpubPublication> {
    load_publication_with_layout_and_line_breaking(bytes, layout_config, LineBreaking::Greedy)
}

pub fn load_publication_with_layout_and_line_breaking(
    bytes: &[u8],
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
) -> EpubResult<EpubPublication> {
    let document = open_document(bytes)?;
    summarize_loaded_document_with_mode(
        &document,
        layout_config,
        line_breaking,
        PublicationDiagnosticsMode::None,
    )
}

/// Builds a publication and explicitly collects the compatibility CSS/style
/// diagnostics. Normal loading omits these reports so it never invokes the
/// retired parser merely to populate parity hashes.
#[cfg(feature = "legacy-css-diagnostics")]
pub fn analyze_publication_with_layout_and_line_breaking(
    bytes: &[u8],
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
) -> EpubResult<EpubPublication> {
    let document = open_document(bytes)?;
    summarize_loaded_document_with_mode(
        &document,
        layout_config,
        line_breaking,
        PublicationDiagnosticsMode::Compatibility,
    )
}

pub fn summarize_loaded_document_with_layout(
    document: &LoadedEpubDocument,
    layout_config: &LayoutConfig,
) -> EpubResult<EpubPublication> {
    summarize_loaded_document_with_layout_and_line_breaking(
        document,
        layout_config,
        LineBreaking::Greedy,
    )
}

pub fn summarize_loaded_document_with_layout_and_line_breaking(
    document: &LoadedEpubDocument,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
) -> EpubResult<EpubPublication> {
    summarize_loaded_document_with_mode(
        document,
        layout_config,
        line_breaking,
        PublicationDiagnosticsMode::None,
    )
}

/// Loaded-document counterpart of
/// [`analyze_publication_with_layout_and_line_breaking`].
#[cfg(feature = "legacy-css-diagnostics")]
pub fn analyze_loaded_document_with_layout_and_line_breaking(
    document: &LoadedEpubDocument,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
) -> EpubResult<EpubPublication> {
    summarize_loaded_document_with_mode(
        document,
        layout_config,
        line_breaking,
        PublicationDiagnosticsMode::Compatibility,
    )
}

fn summarize_loaded_document_with_mode(
    document: &LoadedEpubDocument,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    diagnostics_mode: PublicationDiagnosticsMode,
) -> EpubResult<EpubPublication> {
    Ok(
        build_loaded_document_with_mode(document, layout_config, line_breaking, diagnostics_mode)?
            .publication,
    )
}

#[derive(Clone, Copy)]
enum PublicationDiagnosticsMode {
    None,
    #[cfg(feature = "legacy-css-diagnostics")]
    Compatibility,
}

#[derive(Clone, Copy)]
pub(super) enum StyleResolutionMode {
    Strict,
    #[cfg(feature = "legacy-css-diagnostics")]
    LegacyCompatibility,
}

impl From<PublicationDiagnosticsMode> for StyleResolutionMode {
    fn from(value: PublicationDiagnosticsMode) -> Self {
        match value {
            PublicationDiagnosticsMode::None => Self::Strict,
            #[cfg(feature = "legacy-css-diagnostics")]
            PublicationDiagnosticsMode::Compatibility => Self::LegacyCompatibility,
        }
    }
}

pub(crate) struct BuiltEpubPublication {
    pub(crate) publication: EpubPublication,
}

pub(crate) struct PreparedRuntimeLayoutChapter {
    pub(crate) idref: String,
    pub(crate) styled_nodes: Vec<StyledNode>,
    pub(crate) page_paint: Option<serde_json::Value>,
    pub(crate) layout_style_table: rito_style_contract::LayoutStyleTableV1,
    pub(crate) inline_style_table: rito_style_contract::InlineStyleTableV1,
}

pub(crate) fn prepare_runtime_layout_chapter(
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
    font_fallbacks: Option<&FontFallbackPolicy<'_>>,
) -> EpubResult<Option<PreparedRuntimeLayoutChapter>> {
    let inputs = layout_inputs(
        &prepared.stylesheet_ledger,
        &prepared.chapters,
        &prepared.filtered_footnote_nodes,
        layout_config,
        font_fallbacks,
        StyleResolutionMode::Strict,
    )?;
    let tables = inputs
        .chapter_style_tables
        .into_iter()
        .next()
        .map(|chapter| (chapter.layout, chapter.inline));
    let input = inputs.chapters.into_iter().next();
    let (Some(input), Some((layout_style_table, inline_style_table))) = (input, tables) else {
        return Ok(None);
    };
    Ok(Some(PreparedRuntimeLayoutChapter {
        idref: input.idref.to_owned(),
        styled_nodes: input.pagination_styled_nodes.unwrap_or(input.styled_nodes),
        page_paint: input.page_paint,
        layout_style_table,
        inline_style_table,
    }))
}

fn build_loaded_document_with_mode(
    document: &LoadedEpubDocument,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    diagnostics_mode: PublicationDiagnosticsMode,
) -> EpubResult<BuiltEpubPublication> {
    let prepared = super::prepare_loaded_document(document);
    build_prepared_loaded_document_with_layout_and_line_breaking(
        document,
        &prepared,
        layout_config,
        line_breaking,
        diagnostics_mode,
    )
}

fn build_prepared_loaded_document_with_layout_and_line_breaking(
    document: &LoadedEpubDocument,
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    diagnostics_mode: PublicationDiagnosticsMode,
) -> EpubResult<BuiltEpubPublication> {
    let text_measurement_fonts =
        text_measurement_font_assembly_for_layout(document, layout_config, None, Vec::new()).fonts;
    let inputs = layout_inputs(
        &prepared.stylesheet_ledger,
        &prepared.chapters,
        &prepared.filtered_footnote_nodes,
        layout_config,
        None,
        diagnostics_mode.into(),
    )?;
    let style_capabilities = inputs.capabilities.summary();
    let built_layout = crate::layout::build_inline_segments(
        inputs.chapters,
        &prepared.resources,
        layout_config,
        line_breaking,
        &text_measurement_fonts,
    );
    let chapters = prepared
        .chapters
        .iter()
        .map(|chapter| chapter.source.clone())
        .collect();
    let (css, style) = match diagnostics_mode {
        PublicationDiagnosticsMode::None => (None, None),
        #[cfg(feature = "legacy-css-diagnostics")]
        PublicationDiagnosticsMode::Compatibility => {
            let viewport = Some(crate::css::CssViewport::new(
                layout_config.viewport_width,
                layout_config.viewport_height,
            ));
            let legacy_stylesheets = prepared.stylesheet_ledger.legacy_artifacts();
            let style = crate::style::summarize_style_from_parsed_chapters(
                legacy_stylesheets.stylesheet_rules(),
                prepared
                    .chapters
                    .iter()
                    .map(|chapter| ParsedStyleChapterInput {
                        idref: &chapter.source.idref,
                        href: &chapter.source.href,
                        nodes: &chapter.parsed.nodes,
                        body_attributes: chapter.parsed.body_attributes.as_ref(),
                        author_stylesheets: &chapter.parsed.author_stylesheets,
                    }),
                viewport,
                chapter_style_options(layout_config),
            );
            (Some(legacy_stylesheets.css().clone()), Some(style))
        }
    };

    let publication = EpubPublication {
        package: document.package.clone(),
        resources: prepared.resources.clone(),
        chapters,
        xhtml: prepared.xhtml.clone(),
        css,
        style,
        layout: built_layout.summary.clone(),
        interaction: prepared.interaction.clone(),
        style_capabilities,
    };

    Ok(BuiltEpubPublication { publication })
}

fn default_publication_layout_config() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 420.0,
        height: 640.0,
        margin: MarginInput::All(24.0),
        spread: SpreadMode::Single,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    })
}

fn layout_inputs<'a>(
    stylesheet_ledger: &'a super::StylesheetSourceLedger,
    chapters: &'a [ParsedLoadedChapterSource],
    filtered_footnote_nodes: &'a BTreeMap<String, Vec<crate::xhtml::DocumentNode>>,
    layout_config: &LayoutConfig,
    font_fallbacks: Option<&FontFallbackPolicy<'_>>,
    style_resolution_mode: StyleResolutionMode,
) -> EpubResult<LayoutInputs<'a>> {
    let viewport = Some(crate::css::CssViewport::new(
        layout_config.viewport_width,
        layout_config.viewport_height,
    ));

    let mut capabilities = StyleCapabilityReport::default();
    let mut chapter_style_tables = Vec::with_capacity(chapters.len());
    let chapters = chapters
        .iter()
        .map(|chapter| -> EpubResult<InlineSegmentChapterInput<'a>> {
            let pagination_nodes = filtered_footnote_nodes
                .get(&chapter.source.idref)
                .map(Vec::as_slice);
            if matches!(style_resolution_mode, StyleResolutionMode::Strict)
                && is_recovered_empty_chapter(chapter)
            {
                chapter_style_tables.push(ChapterStyleTable {
                    idref: chapter.source.idref.clone(),
                    layout: rito_style_contract::LayoutStyleTableV1::new(0),
                    inline: rito_style_contract::InlineStyleTableV1::new(0),
                });
                return Ok(InlineSegmentChapterInput {
                    idref: &chapter.source.idref,
                    href: &chapter.source.href,
                    styled_nodes: Vec::new(),
                    pagination_styled_nodes: None,
                    page_paint: None,
                });
            }
            let mut resolved = {
                #[cfg(any(test, feature = "bench-internals"))]
                let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                    crate::layout::bounded_work_probe::ContinuationTimingStage::StyleResolution,
                );
                let input = PreparedStyleChapterInput {
                    stylesheet_ledger,
                    chapter_href: &chapter.source.href,
                    source_arena: chapter.source_arena.as_ref(),
                    body_source_node_id: chapter.parsed.body_source_node_id,
                    nodes: &chapter.parsed.nodes,
                    pagination_nodes,
                    #[cfg(feature = "legacy-css-diagnostics")]
                    body_attributes: chapter.parsed.body_attributes.as_ref(),
                    author_stylesheets: &chapter.parsed.author_stylesheets,
                };
                match style_resolution_mode {
                    StyleResolutionMode::Strict => resolve_prepared_chapter_style(
                        input,
                        viewport,
                        chapter_style_options(layout_config),
                    )
                    .map_err(|error| {
                        EpubError::new(format!(
                            "style resolution failed for chapter {:?}: {error}",
                            chapter.source.href
                        ))
                    })?,
                    #[cfg(feature = "legacy-css-diagnostics")]
                    StyleResolutionMode::LegacyCompatibility => {
                        resolve_prepared_chapter_style_with_legacy_compatibility(
                            input,
                            viewport,
                            chapter_style_options(layout_config),
                        )
                    }
                }
            };
            if let Some(font_fallbacks) = font_fallbacks {
                #[cfg(any(test, feature = "bench-internals"))]
                let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                    crate::layout::bounded_work_probe::ContinuationTimingStage::FontFallbackRewrite,
                );
                rewrite_font_families(&mut resolved.styled_nodes, font_fallbacks);
                if let Some(nodes) = resolved.pagination_styled_nodes.as_mut() {
                    rewrite_font_families(nodes, font_fallbacks);
                }
            }
            capabilities.absorb(resolved.capabilities);
            chapter_style_tables.push(ChapterStyleTable {
                idref: chapter.source.idref.clone(),
                layout: resolved.layout_style_table,
                inline: resolved.inline_style_table,
            });
            Ok(InlineSegmentChapterInput {
                idref: &chapter.source.idref,
                href: &chapter.source.href,
                styled_nodes: resolved.styled_nodes,
                pagination_styled_nodes: resolved.pagination_styled_nodes,
                page_paint: resolved.page_paint,
            })
        })
        .collect::<EpubResult<Vec<_>>>()?;
    Ok(LayoutInputs {
        chapters,
        chapter_style_tables,
        capabilities,
    })
}

/// Chapter layout inputs plus what the publication's CSS asked for that this
/// engine could not represent.
struct LayoutInputs<'a> {
    chapters: Vec<InlineSegmentChapterInput<'a>>,
    chapter_style_tables: Vec<ChapterStyleTable>,
    capabilities: StyleCapabilityReport,
}

/// One chapter's typed style tables, retained alongside the JSON styled
/// nodes so typed consumers (the fragment pipeline, diagnostics) read
/// interned styles instead of re-deriving them from string maps.
pub(crate) struct ChapterStyleTable {
    pub(crate) idref: String,
    pub(crate) layout: rito_style_contract::LayoutStyleTableV1,
    pub(crate) inline: rito_style_contract::InlineStyleTableV1,
}

/// Formal XHTML parse failures are retained as warning-only empty chapters.
/// They have no source topology to cascade, so the strict path can represent
/// them directly without invoking either style backend. A non-empty semantic
/// projection without its arena is not recoverable and continues into the
/// strict backend's typed topology error.
fn is_recovered_empty_chapter(chapter: &ParsedLoadedChapterSource) -> bool {
    chapter.source_arena.is_none() && chapter.parsed.nodes.is_empty()
}

fn chapter_style_options(layout_config: &LayoutConfig) -> ChapterStyleOptions<'_> {
    ChapterStyleOptions {
        root_font_size: layout_config.root_font_size,
        line_height_override: layout_config.line_height_override,
        line_height_force: layout_config.line_height_force.unwrap_or(false),
        font_family_override: layout_config.font_family_override.as_deref(),
        font_family_force: layout_config.font_family_force.unwrap_or(false),
    }
}
