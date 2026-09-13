use std::rc::Rc;

use crate::{
    layout::LayoutConfig,
    style::{resolve_prepared_chapter_style, ChapterStyleOptions, PreparedStyleChapterInput},
};

mod runtime;
#[cfg(test)]
mod tests;

pub(crate) use runtime::project_prepared_document_styles;

use super::{EpubError, EpubResult, ParsedLoadedChapterSource, PreparedLoadedDocument};

/// One chapter's typed style tables, as the fragment bridge consumes them.
pub(crate) struct PreparedRuntimeLayoutChapter {
    pub(crate) idref: String,
    pub(crate) layout_style_table: rito_style_contract::LayoutStyleTable,
    pub(crate) inline_style_table: rito_style_contract::InlineStyleTable,
}

pub(crate) fn prepare_runtime_layout_chapter(
    prepared: &PreparedLoadedDocument,
    layout_config: &LayoutConfig,
) -> EpubResult<Option<PreparedRuntimeLayoutChapter>> {
    let tables = chapter_style_tables(
        &prepared.stylesheet_ledger,
        &prepared.chapters,
        layout_config,
    )?;
    Ok(tables
        .into_iter()
        .next()
        .map(|chapter| PreparedRuntimeLayoutChapter {
            idref: chapter.idref,
            layout_style_table: chapter.layout,
            inline_style_table: chapter.inline,
        }))
}

/// Cascades every chapter in the window and keeps the typed style tables:
/// the fragment engine builds its formatting tree from these and the
/// chapter's source arena.
fn chapter_style_tables(
    stylesheet_ledger: &super::StylesheetSourceLedger,
    chapters: &[Rc<ParsedLoadedChapterSource>],
    layout_config: &LayoutConfig,
) -> EpubResult<Vec<ChapterStyleTable>> {
    // The CSS viewport (vh/vw, media queries) is ONE PAGE's content box,
    // not the reader's spread canvas: the paginated-reader baseline
    // (epub.js columns, and the pixel oracle's multicol truth) sizes the
    // html element to the column, so `height: 80vh` on a cover means 80%
    // of the page content height — measured: 80vh resolved against the
    // 950px canvas drew the cover 760px tall where the browser draws 680.
    let viewport = Some(crate::style::CssViewport::new(
        (layout_config.page_width - layout_config.margin_left - layout_config.margin_right)
            .max(1.0),
        (layout_config.page_height - layout_config.margin_top - layout_config.margin_bottom)
            .max(1.0),
    ));

    chapters
        .iter()
        .map(|chapter| -> EpubResult<ChapterStyleTable> {
            if is_recovered_empty_chapter(chapter) {
                return Ok(ChapterStyleTable {
                    idref: chapter.source.idref.clone(),
                    layout: rito_style_contract::LayoutStyleTable::new(0),
                    inline: rito_style_contract::InlineStyleTable::new(0),
                });
            }
            let input = PreparedStyleChapterInput {
                stylesheet_ledger,
                chapter_href: &chapter.source.href,
                source_arena: chapter.source_arena.as_ref(),
                body_source_node_id: chapter.parsed.body_source_node_id,
                author_stylesheets: &chapter.parsed.author_stylesheets,
            };
            let resolved = resolve_prepared_chapter_style(
                input,
                viewport,
                chapter_style_options(layout_config),
            )
            .map_err(|error| {
                EpubError::new(format!(
                    "style resolution failed for chapter {:?}: {error}",
                    chapter.source.href
                ))
            })?;
            Ok(ChapterStyleTable {
                idref: chapter.source.idref.clone(),
                layout: resolved.layout_style_table,
                inline: resolved.inline_style_table,
            })
        })
        .collect()
}

/// One chapter's typed style tables: interned styles the fragment
/// pipeline reads directly.
pub(crate) struct ChapterStyleTable {
    pub(crate) idref: String,
    pub(crate) layout: rito_style_contract::LayoutStyleTable,
    pub(crate) inline: rito_style_contract::InlineStyleTable,
}

/// Formal XHTML parse failures are retained as warning-only empty chapters.
/// They have no source topology to cascade, so the strict path can represent
/// them directly without invoking the style backend. A non-empty semantic
/// projection without its arena is not recoverable and continues into the
/// backend's typed topology error.
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
