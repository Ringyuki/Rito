use crate::{
    layout::{
        BuiltLayout, LayoutConfig, LineBreaking, TextMeasurementCache, TextMeasurementFontFace,
    },
    style::FontFallbackPolicy,
};

use super::{layout_inputs, text_measurement_fonts_for_layout};
use crate::epub::{LoadedEpubDocument, PreparedLoadedDocument};

pub(crate) struct PreparedRuntimeLayoutOptions<'a> {
    pub(crate) chapter_start: usize,
    pub(crate) chapter_count: usize,
    pub(crate) line_breaking: LineBreaking,
    pub(crate) text_measurement_cache: Option<TextMeasurementCache>,
    pub(crate) pinned_faces: Vec<TextMeasurementFontFace<'a>>,
    pub(crate) font_fallbacks: Option<FontFallbackPolicy<'a>>,
}

pub(crate) fn build_prepared_loaded_document_runtime_layout<'a>(
    document: &'a LoadedEpubDocument,
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
    options: PreparedRuntimeLayoutOptions<'a>,
) -> BuiltLayout {
    let PreparedRuntimeLayoutOptions {
        chapter_start,
        chapter_count,
        line_breaking,
        text_measurement_cache,
        pinned_faces,
        font_fallbacks,
    } = options;
    let fonts = text_measurement_fonts_for_layout(
        document,
        layout_config,
        text_measurement_cache,
        pinned_faces,
    );
    let end = chapter_start
        .saturating_add(chapter_count)
        .min(prepared.chapters.len());
    crate::layout::build_inline_segments_runtime(
        layout_inputs(
            &prepared.stylesheet_rules,
            &prepared.chapters[chapter_start.min(end)..end],
            &prepared.filtered_footnote_nodes,
            layout_config,
            font_fallbacks.as_ref(),
        ),
        &prepared.resources,
        layout_config,
        line_breaking,
        &fonts,
    )
}
