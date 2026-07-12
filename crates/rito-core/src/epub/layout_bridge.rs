use std::collections::BTreeMap;

use crate::{
    layout::{
        create_layout_config, BuiltLayout, InlineSegmentChapterInput, LayoutConfig,
        LayoutConfigInput, LineBreaking, MarginInput, SpreadMode, TextMeasurementFonts,
    },
    style::{
        rewrite_font_families, ChapterStyleOptions, FontFallbackPolicy, ParsedStyleChapterInput,
        StyledNode, StylesheetRuleMap,
    },
};

mod runtime;

pub(crate) use runtime::{
    build_prepared_loaded_document_runtime_layout, PreparedRuntimeLayoutOptions,
};

use super::{
    fonts::text_measurement_font_assembly_for_layout, open_document, EpubPublication, EpubResult,
    LoadedEpubDocument, ParsedLoadedChapterSource, PreparedLoadedDocument,
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
    summarize_loaded_document_with_layout_and_line_breaking(&document, layout_config, line_breaking)
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
    Ok(
        build_loaded_document_with_layout_and_line_breaking(
            document,
            layout_config,
            line_breaking,
        )?
        .publication,
    )
}

pub(crate) struct BuiltEpubPublication {
    pub(crate) publication: EpubPublication,
}

pub(crate) struct PreparedRuntimeLayoutChapter {
    pub(crate) idref: String,
    pub(crate) styled_nodes: Vec<StyledNode>,
    pub(crate) page_paint: Option<serde_json::Value>,
}

pub(crate) fn prepare_runtime_layout_chapter(
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
    font_fallbacks: Option<&FontFallbackPolicy<'_>>,
) -> Option<PreparedRuntimeLayoutChapter> {
    let input = layout_inputs(
        &prepared.stylesheet_rules,
        &prepared.chapters,
        &prepared.filtered_footnote_nodes,
        layout_config,
        font_fallbacks,
    )
    .into_iter()
    .next()?;
    Some(PreparedRuntimeLayoutChapter {
        idref: input.idref.to_owned(),
        styled_nodes: input.pagination_styled_nodes.unwrap_or(input.styled_nodes),
        page_paint: input.page_paint,
    })
}

pub(crate) fn build_loaded_document_with_layout_and_line_breaking(
    document: &LoadedEpubDocument,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
) -> EpubResult<BuiltEpubPublication> {
    let prepared = super::prepare_loaded_document(document);
    build_prepared_loaded_document_with_layout_and_line_breaking(
        document,
        &prepared,
        layout_config,
        line_breaking,
    )
}

pub(crate) fn build_prepared_loaded_document_with_layout_and_line_breaking(
    document: &LoadedEpubDocument,
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
) -> EpubResult<BuiltEpubPublication> {
    let viewport = Some(crate::css::CssViewport {
        width: layout_config.viewport_width,
        height: layout_config.viewport_height,
    });
    let style = crate::style::summarize_style_from_parsed_chapters(
        &prepared.stylesheet_rules,
        prepared
            .chapters
            .iter()
            .map(|chapter| ParsedStyleChapterInput {
                idref: &chapter.source.idref,
                href: &chapter.source.href,
                nodes: &chapter.parsed.nodes,
                body_attributes: chapter.parsed.body_attributes.as_ref(),
                stylesheet_hrefs: chapter.parsed.stylesheet_hrefs.as_deref(),
                embedded_stylesheets: chapter.parsed.embedded_stylesheets.as_deref(),
            }),
        viewport,
        chapter_style_options(layout_config),
    );
    let text_measurement_fonts =
        text_measurement_font_assembly_for_layout(document, layout_config, None, Vec::new()).fonts;
    let built_layout = build_layout(
        &prepared.stylesheet_rules,
        &prepared.chapters,
        &prepared.filtered_footnote_nodes,
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

    let publication = EpubPublication {
        package: document.package.clone(),
        resources: prepared.resources.clone(),
        chapters,
        xhtml: prepared.xhtml.clone(),
        css: prepared.css.clone(),
        style,
        layout: built_layout.summary.clone(),
        interaction: prepared.interaction.clone(),
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

fn build_layout(
    stylesheet_rules: &StylesheetRuleMap,
    chapters: &[ParsedLoadedChapterSource],
    filtered_footnote_nodes: &BTreeMap<String, Vec<crate::xhtml::DocumentNode>>,
    resources: &crate::resources::PublicationResources,
    layout_config: &LayoutConfig,
    line_breaking: LineBreaking,
    text_measurement_fonts: &TextMeasurementFonts<'_>,
) -> BuiltLayout {
    crate::layout::build_inline_segments(
        layout_inputs(
            stylesheet_rules,
            chapters,
            filtered_footnote_nodes,
            layout_config,
            None,
        ),
        resources,
        layout_config,
        line_breaking,
        text_measurement_fonts,
    )
}

fn layout_inputs<'a>(
    stylesheet_rules: &'a StylesheetRuleMap,
    chapters: &'a [ParsedLoadedChapterSource],
    filtered_footnote_nodes: &'a BTreeMap<String, Vec<crate::xhtml::DocumentNode>>,
    layout_config: &LayoutConfig,
    font_fallbacks: Option<&FontFallbackPolicy<'_>>,
) -> Vec<InlineSegmentChapterInput<'a>> {
    let viewport = Some(crate::css::CssViewport {
        width: layout_config.viewport_width,
        height: layout_config.viewport_height,
    });

    chapters
        .iter()
        .map(|chapter| {
            let rules = crate::style::build_chapter_rules(
                stylesheet_rules,
                chapter.parsed.stylesheet_hrefs.as_deref(),
                chapter.parsed.embedded_stylesheets.as_deref(),
                layout_config.root_font_size,
            );
            let mut resolved = crate::style::resolve_chapter_style_nodes(
                &chapter.parsed.nodes,
                &rules,
                chapter.parsed.body_attributes.as_ref(),
                viewport,
                chapter_style_options(layout_config),
            );
            if let Some(font_fallbacks) = font_fallbacks {
                rewrite_font_families(&mut resolved.styled_nodes, font_fallbacks);
            }
            let pagination_styled_nodes =
                filtered_footnote_nodes
                    .get(&chapter.source.idref)
                    .map(|nodes| {
                        let mut resolved = crate::style::resolve_chapter_style_nodes(
                            nodes,
                            &rules,
                            chapter.parsed.body_attributes.as_ref(),
                            viewport,
                            chapter_style_options(layout_config),
                        );
                        if let Some(font_fallbacks) = font_fallbacks {
                            rewrite_font_families(&mut resolved.styled_nodes, font_fallbacks);
                        }
                        resolved.styled_nodes
                    });
            InlineSegmentChapterInput {
                idref: &chapter.source.idref,
                href: &chapter.source.href,
                styled_nodes: resolved.styled_nodes,
                pagination_styled_nodes,
                page_paint: resolved.page_paint,
            }
        })
        .collect::<Vec<_>>()
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
