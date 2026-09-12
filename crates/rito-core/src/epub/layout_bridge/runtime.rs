use crate::layout::LayoutConfig;

use super::{chapter_style_tables, ChapterStyleTable};
use crate::epub::{EpubResult, PreparedLoadedDocument};

/// Runs style projection for every prepared chapter in the window and
/// stops there: the fragment engine builds its own page table from these
/// tables.
pub(crate) fn project_prepared_document_styles(
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
    chapter_start: usize,
    chapter_count: usize,
) -> EpubResult<Vec<ChapterStyleTable>> {
    let end = chapter_start
        .saturating_add(chapter_count)
        .min(prepared.chapters.len());
    chapter_style_tables(
        &prepared.stylesheet_ledger,
        &prepared.chapters[chapter_start.min(end)..end],
        layout_config,
    )
}
