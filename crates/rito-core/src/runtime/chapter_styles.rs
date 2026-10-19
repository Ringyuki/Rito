//! Each chapter's style tables as last resolved, kept across revisions.
//!
//! A chapter's styles are a function of its parsed source, the
//! publication's stylesheets, the reader's type settings and the CSS
//! viewport. The stylesheets are fixed once the document opens, and the
//! viewport only matters through what the cascade read of it: a length in
//! viewport units, or a media query's answer. So a layout at another size
//! takes the tables a chapter already has whenever its type settings are
//! the same and its styles hold at the new viewport, the two questions a
//! browser asks of a resize before it restyles anything. The fonts do not
//! enter: the cascade measures with fixed metrics, not the faces.

use std::{collections::HashMap, rc::Rc};

use crate::epub::{
    chapter_style_options, chapter_style_table, chapter_style_viewport, EpubResult,
    ParsedLoadedChapterSource, StylesheetSourceLedger,
};
use crate::layout::LayoutConfig;
use crate::style::ChapterStyleViewportUse;

use super::frame::RuntimeChapterStyleTables;

/// The latest resolution of each chapter, by idref.
#[derive(Debug, Default)]
pub(super) struct ChapterStyleCache {
    entries: HashMap<String, ChapterStyleEntry>,
}

#[derive(Debug)]
struct ChapterStyleEntry {
    /// The parsed chapter the tables were resolved from: a document parses
    /// each chapter once and shares it, so a different `Rc` is a different
    /// parse.
    source: Rc<ParsedLoadedChapterSource>,
    settings: TypeSettings,
    viewport_use: Option<ChapterStyleViewportUse>,
    tables: Rc<RuntimeChapterStyleTables>,
}

/// The reader's type settings, every field the cascade reads besides the
/// viewport.
#[derive(Debug, PartialEq)]
struct TypeSettings {
    root_font_size: u64,
    line_height_override: Option<u64>,
    line_height_force: bool,
    font_family_override: Option<String>,
    font_family_force: bool,
}

impl TypeSettings {
    fn of(layout_config: &LayoutConfig) -> Self {
        let crate::style::ChapterStyleOptions {
            root_font_size,
            line_height_override,
            line_height_force,
            font_family_override,
            font_family_force,
        } = chapter_style_options(layout_config);
        Self {
            root_font_size: root_font_size.to_bits(),
            line_height_override: line_height_override.map(f64::to_bits),
            line_height_force,
            font_family_override: font_family_override.map(str::to_owned),
            font_family_force,
        }
    }
}

impl ChapterStyleCache {
    /// The style tables of every chapter in `chapters`, by idref, resolving
    /// only the ones whose last tables do not hold under `layout_config`.
    pub(super) fn tables(
        &mut self,
        stylesheet_ledger: &StylesheetSourceLedger,
        chapters: &[Rc<ParsedLoadedChapterSource>],
        layout_config: &LayoutConfig,
    ) -> EpubResult<Vec<(String, Rc<RuntimeChapterStyleTables>)>> {
        let settings = TypeSettings::of(layout_config);
        let viewport = chapter_style_viewport(layout_config);
        chapters
            .iter()
            .map(|chapter| {
                let idref = &chapter.source.idref;
                if let Some(entry) = self.entries.get(idref).filter(|entry| {
                    Rc::ptr_eq(&entry.source, chapter)
                        && entry.settings == settings
                        && entry
                            .viewport_use
                            .as_ref()
                            .is_none_or(|used| used.holds_at(viewport))
                }) {
                    return Ok((idref.clone(), Rc::clone(&entry.tables)));
                }
                let resolved = chapter_style_table(stylesheet_ledger, chapter, layout_config)?;
                let tables = Rc::new(RuntimeChapterStyleTables {
                    layout: resolved.layout,
                    inline: resolved.inline,
                    generated: resolved.generated,
                });
                self.entries.insert(
                    idref.clone(),
                    ChapterStyleEntry {
                        source: Rc::clone(chapter),
                        settings: TypeSettings::of(layout_config),
                        viewport_use: resolved.viewport_use,
                        tables: Rc::clone(&tables),
                    },
                );
                Ok((idref.clone(), tables))
            })
            .collect()
    }
}
