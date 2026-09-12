use crate::layout::{LayoutConfig, TextMeasurementFontFace};

use super::{chapter_style_tables, ChapterStyleTable};
use crate::epub::{
    fonts::text_measurement_font_assembly_for_layout, EpubResult, LoadedEpubDocument,
    PreparedLoadedDocument, ShapeablePublicationFontFace,
};

pub(crate) struct PreparedRuntimeLayoutOptions<'a> {
    pub(crate) chapter_start: usize,
    pub(crate) chapter_count: usize,
    pub(crate) pinned_faces: Vec<TextMeasurementFontFace<'a>>,
}

/// Projected style tables plus the shapeable publication faces.
pub(crate) struct ProjectedDocumentStyles {
    pub(crate) chapter_style_tables: Vec<ChapterStyleTable>,
    pub(crate) shapeable_publication_faces: Vec<ShapeablePublicationFontFace>,
}

/// Runs style projection for every prepared chapter in the window and
/// stops there: the fragment engine builds its own page table from these
/// tables.
pub(crate) fn project_prepared_document_styles<'a>(
    document: &'a LoadedEpubDocument,
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
    options: PreparedRuntimeLayoutOptions<'a>,
) -> EpubResult<ProjectedDocumentStyles> {
    let PreparedRuntimeLayoutOptions {
        chapter_start,
        chapter_count,
        pinned_faces,
    } = options;
    let assembly = text_measurement_font_assembly_for_layout(document, layout_config, pinned_faces);
    let end = chapter_start
        .saturating_add(chapter_count)
        .min(prepared.chapters.len());
    let chapter_style_tables = chapter_style_tables(
        &prepared.stylesheet_ledger,
        &prepared.chapters[chapter_start.min(end)..end],
        &prepared.filtered_footnote_nodes,
        layout_config,
    )?;
    Ok(ProjectedDocumentStyles {
        chapter_style_tables,
        shapeable_publication_faces: assembly.shapeable_publication_faces,
    })
}
