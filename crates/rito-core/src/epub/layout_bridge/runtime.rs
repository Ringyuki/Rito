use crate::{
    layout::{
        BuiltLayout, LayoutConfig, LineBreaking, TextMeasurementCache, TextMeasurementFontFace,
    },
    style::FontFallbackPolicy,
};

use super::{
    layout_inputs, text_measurement_font_assembly_for_layout, ChapterStyleTable,
    StyleResolutionMode,
};
use crate::epub::{
    EpubResult, LoadedEpubDocument, PreparedLoadedDocument, ShapeablePublicationFontFace,
};

pub(crate) struct PreparedRuntimeLayoutOptions<'a> {
    pub(crate) chapter_start: usize,
    pub(crate) chapter_count: usize,
    pub(crate) line_breaking: LineBreaking,
    pub(crate) text_measurement_cache: Option<TextMeasurementCache>,
    pub(crate) pinned_faces: Vec<TextMeasurementFontFace<'a>>,
    pub(crate) font_fallbacks: Option<FontFallbackPolicy<'a>>,
}

pub(crate) struct BuiltPreparedRuntimeLayout {
    pub(crate) layout: BuiltLayout,
    pub(crate) chapter_style_tables: Vec<ChapterStyleTable>,
    pub(crate) shapeable_publication_faces: Vec<ShapeablePublicationFontFace>,
}

pub(crate) fn build_prepared_loaded_document_runtime_layout<'a>(
    document: &'a LoadedEpubDocument,
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
    options: PreparedRuntimeLayoutOptions<'a>,
) -> EpubResult<BuiltPreparedRuntimeLayout> {
    let PreparedRuntimeLayoutOptions {
        chapter_start,
        chapter_count,
        line_breaking,
        text_measurement_cache,
        pinned_faces,
        mut font_fallbacks,
    } = options;
    let assembly = text_measurement_font_assembly_for_layout(
        document,
        layout_config,
        text_measurement_cache,
        pinned_faces,
    );
    if let Some(policy) = font_fallbacks.as_mut() {
        policy.set_available_publication_families(assembly.shapeable_publication_families.clone());
    }
    let end = chapter_start
        .saturating_add(chapter_count)
        .min(prepared.chapters.len());
    let inputs = layout_inputs(
        &prepared.stylesheet_ledger,
        &prepared.chapters[chapter_start.min(end)..end],
        &prepared.filtered_footnote_nodes,
        layout_config,
        font_fallbacks.as_ref(),
        StyleResolutionMode::Strict,
    )?;
    let chapter_style_tables = inputs.chapter_style_tables;
    let layout = crate::layout::build_inline_segments_runtime(
        inputs.chapters,
        &prepared.resources,
        layout_config,
        line_breaking,
        &assembly.fonts,
    );
    Ok(BuiltPreparedRuntimeLayout {
        layout,
        chapter_style_tables,
        shapeable_publication_faces: assembly.shapeable_publication_faces,
    })
}

/// Projected style tables plus the shapeable publication faces, without
/// running the retained layout engine — the fragment-only revision path.
pub(crate) struct ProjectedDocumentStyles {
    pub(crate) chapter_style_tables: Vec<ChapterStyleTable>,
    pub(crate) shapeable_publication_faces: Vec<ShapeablePublicationFontFace>,
}

/// Runs style projection for every prepared chapter and stops there: no
/// retained boxes, lines, or pages are built. The fragment engine builds
/// its own page table from these tables.
pub(crate) fn project_prepared_document_styles<'a>(
    document: &'a LoadedEpubDocument,
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
    options: PreparedRuntimeLayoutOptions<'a>,
) -> EpubResult<ProjectedDocumentStyles> {
    let PreparedRuntimeLayoutOptions {
        chapter_start,
        chapter_count,
        line_breaking: _,
        text_measurement_cache,
        pinned_faces,
        mut font_fallbacks,
    } = options;
    let assembly = text_measurement_font_assembly_for_layout(
        document,
        layout_config,
        text_measurement_cache,
        pinned_faces,
    );
    if let Some(policy) = font_fallbacks.as_mut() {
        policy.set_available_publication_families(assembly.shapeable_publication_families.clone());
    }
    let end = chapter_start
        .saturating_add(chapter_count)
        .min(prepared.chapters.len());
    let inputs = layout_inputs(
        &prepared.stylesheet_ledger,
        &prepared.chapters[chapter_start.min(end)..end],
        &prepared.filtered_footnote_nodes,
        layout_config,
        font_fallbacks.as_ref(),
        StyleResolutionMode::Strict,
    )?;
    Ok(ProjectedDocumentStyles {
        chapter_style_tables: inputs.chapter_style_tables,
        shapeable_publication_faces: assembly.shapeable_publication_faces,
    })
}
