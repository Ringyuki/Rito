//! Chapter-tree tests. This file holds the fixture: a small chapter
//! resolved through the real stylesheet pipeline (`resolved_chapter*`), the
//! pinned test font bytes, and an empty image table. The topic files under
//! `tests/` build trees from it and assert on their shape, paint and layout.

mod boxes;
mod flow;
mod inline;
mod pagination;
mod sizing;
mod tree;

use super::*;
use crate::render::test_support::css_color;
use crate::{
    epub::{
        parsed_loaded_chapter_source, prepare_loaded_document_base, LoadedChapter,
        LoadedEpubDocument, LoadedTextResource, PackageDocument, PackageMetadata,
    },
    style::{
        resolve_prepared_chapter_style, ChapterStyleOptions, CssViewport, PreparedStyleChapterInput,
    },
};
use rito_block::BlockFormattingContext;
use rito_fragment::{CancelFlag, ConstraintSpace, FormattingContext, Fragment};
use rito_inline::ParleyInlineContext;
use rito_style_contract::LengthPercentage;

const CHAPTER_XHTML: &str = r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p>First   paragraph with
     collapsed   spaces and <span class="bold">styled inline</span> text.</p>
  <div><p>Nested paragraph inside a wrapper block.</p></div>
  <p class="hidden">invisible content</p>
  <p></p>
</body></html>"#;

const CHAPTER_CSS: &str = "\
html { font-family: Tinos; font-size: 16px; }\n\
p { margin: 8px 0; }\n\
.bold { font-weight: 700; }\n\
.hidden { display: none; }\n";

struct ResolvedChapter {
    nodes: Vec<DocumentNode>,
    body_index: usize,
    layout: LayoutStyleTable,
    inline: InlineStyleTable,
}

fn no_images() -> BTreeMap<String, (u32, u32)> {
    BTreeMap::new()
}

fn resolved_chapter() -> ResolvedChapter {
    resolved_chapter_from(CHAPTER_XHTML)
}

fn resolved_chapter_from(xhtml: &str) -> ResolvedChapter {
    resolved_chapter_with(xhtml, CHAPTER_CSS)
}

fn resolved_chapter_with(xhtml: &str, css: &str) -> ResolvedChapter {
    let document = LoadedEpubDocument {
        package: PackageDocument {
            metadata: PackageMetadata {
                title: "Bridge".to_owned(),
                language: "en".to_owned(),
                identifier: "bridge-test".to_owned(),
                creator: None,
            },
            manifest: Vec::new(),
            spine: Vec::new(),
            toc: Vec::new(),
        },
        stylesheets: vec![LoadedTextResource {
            href: "styles/main.css".to_owned(),
            text: css.to_owned(),
        }],
        fonts: Vec::new(),
        images: Vec::new(),
        chapters: Vec::new(),
        archive_source: None,
    };
    let base = prepare_loaded_document_base(&document);
    let chapter = LoadedChapter {
        idref: "chapter-1".to_owned(),
        href: "chapter-1.xhtml".to_owned(),
        linear: true,
        xhtml_source: xhtml.to_owned(),
        source_loaded: true,
        image_refs: None,
    };
    let parsed = parsed_loaded_chapter_source(&chapter);
    let resolved = resolve_prepared_chapter_style(
        PreparedStyleChapterInput {
            stylesheet_ledger: &base.stylesheet_ledger,
            chapter_href: &parsed.source.href,
            source_arena: parsed.source_arena.as_ref(),
            body_source_node_id: parsed.parsed.body_source_node_id,
            author_stylesheets: &parsed.parsed.author_stylesheets,
        },
        Some(CssViewport::new(420.0, 640.0)),
        ChapterStyleOptions {
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: false,
            font_family_override: None,
            font_family_force: false,
        },
    )
    .expect("chapter style resolves");
    ResolvedChapter {
        nodes: parsed.parsed.nodes.clone(),
        body_index: parsed
            .parsed
            .body_source_node_id
            .expect("body has a source id")
            .index(),
        layout: resolved.layout_style_table,
        inline: resolved.inline_style_table,
    }
}

fn source_han_test_bytes() -> Vec<u8> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    );
    std::fs::read(path).expect("pinned SourceHan test font reads")
}

fn tinos_bytes() -> Vec<u8> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
    );
    std::fs::read(path).expect("pinned Tinos test font reads")
}
