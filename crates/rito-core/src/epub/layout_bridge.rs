use crate::{
    layout::LayoutConfig,
    style::{
        resolve_prepared_chapter_style, select_prepared_chapter_sources, ChapterStyleOptions,
        ChapterStyleViewportUse, CssViewport, PreparedStyleChapterInput, StyleBackendError,
    },
};

#[cfg(test)]
mod tests;

use super::{EpubError, EpubResult, ParsedLoadedChapterSource};

/// The CSS viewport (vh/vw, media queries) a chapter is styled under: ONE
/// PAGE's content box, not the reader's spread canvas. The paginated
/// reader baseline (epub.js columns, and the pixel oracle's multicol
/// truth) sizes the html element to the column, so `height: 80vh` on a
/// cover means 80% of the page content height — measured: 80vh resolved
/// against the 950px canvas drew the cover 760px tall where the browser
/// draws 680.
pub(crate) fn chapter_style_viewport(layout_config: &LayoutConfig) -> CssViewport {
    CssViewport::new(
        (layout_config.page_width - layout_config.margin_left - layout_config.margin_right)
            .max(1.0),
        (layout_config.page_height - layout_config.margin_top - layout_config.margin_bottom)
            .max(1.0),
    )
}

/// Cascades one chapter under `layout_config`.
pub(crate) fn chapter_style_table(
    stylesheet_ledger: &super::StylesheetSourceLedger,
    chapter: &ParsedLoadedChapterSource,
    layout_config: &LayoutConfig,
) -> EpubResult<ChapterStyleTable> {
    if is_recovered_empty_chapter(chapter) {
        return Ok(ChapterStyleTable {
            layout: rito_style_contract::LayoutStyleTable::new(0),
            inline: rito_style_contract::InlineStyleTable::new(0),
            generated: rito_style_contract::GeneratedBoxTable::new(),
            viewport_use: None,
        });
    }
    let resolved = resolve_prepared_chapter_style(
        style_input(stylesheet_ledger, chapter),
        Some(chapter_style_viewport(layout_config)),
        chapter_style_options(layout_config),
    )
    .map_err(|error| style_failure(chapter, error))?;
    Ok(ChapterStyleTable {
        layout: resolved.layout_style_table,
        inline: resolved.inline_style_table,
        generated: resolved.generated_boxes,
        viewport_use: Some(resolved.viewport_use),
    })
}

/// Fails as styling `chapter` would on its sources alone, before the
/// cascade (see [`select_prepared_chapter_sources`]).
pub(crate) fn check_chapter_style_sources(
    stylesheet_ledger: &super::StylesheetSourceLedger,
    chapter: &ParsedLoadedChapterSource,
) -> EpubResult<()> {
    if is_recovered_empty_chapter(chapter) {
        return Ok(());
    }
    select_prepared_chapter_sources(&style_input(stylesheet_ledger, chapter))
        .map(|_| ())
        .map_err(|error| style_failure(chapter, error))
}

fn style_input<'a>(
    stylesheet_ledger: &'a super::StylesheetSourceLedger,
    chapter: &'a ParsedLoadedChapterSource,
) -> PreparedStyleChapterInput<'a> {
    PreparedStyleChapterInput {
        stylesheet_ledger,
        chapter_href: &chapter.source.href,
        source_arena: chapter.source_arena.as_ref(),
        body_source_node_id: chapter.parsed.body_source_node_id,
        author_stylesheets: &chapter.parsed.author_stylesheets,
    }
}

fn style_failure(chapter: &ParsedLoadedChapterSource, error: StyleBackendError) -> EpubError {
    EpubError::new(format!(
        "style resolution failed for chapter {:?}: {error}",
        chapter.source.href
    ))
}

/// One chapter's typed style tables: interned styles the fragment
/// pipeline reads directly.
pub(crate) struct ChapterStyleTable {
    pub(crate) layout: rito_style_contract::LayoutStyleTable,
    pub(crate) inline: rito_style_contract::InlineStyleTable,
    pub(crate) generated: rito_style_contract::GeneratedBoxTable,
    /// What the cascade read of the viewport; `None` for a chapter that
    /// was never cascaded (an unparseable one, styled empty).
    pub(crate) viewport_use: Option<ChapterStyleViewportUse>,
}

/// Formal XHTML parse failures are retained as warning-only empty chapters.
/// They have no source topology to cascade, so the strict path can represent
/// them directly without invoking the style backend. A non-empty semantic
/// projection without its arena is not recoverable and continues into the
/// backend's typed topology error.
fn is_recovered_empty_chapter(chapter: &ParsedLoadedChapterSource) -> bool {
    chapter.source_arena.is_none() && chapter.parsed.nodes.is_empty()
}

pub(crate) fn chapter_style_options(layout_config: &LayoutConfig) -> ChapterStyleOptions<'_> {
    ChapterStyleOptions {
        root_font_size: layout_config.root_font_size,
        line_height_override: layout_config.line_height_override,
        line_height_force: layout_config.line_height_force.unwrap_or(false),
        font_family_override: layout_config.font_family_override.as_deref(),
        font_family_force: layout_config.font_family_force.unwrap_or(false),
    }
}
