use std::rc::Rc;

use super::prepare_runtime_layout_chapter;
use crate::{
    epub::{
        prepare_loaded_document, LoadedChapter, LoadedEpubDocument, LoadedTextResource,
        PackageDocument, PackageMetadata,
    },
    layout::{create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode},
};

#[test]
fn unrepresentable_css_does_not_refuse_the_chapter() {
    let mut document = supported_document();
    // `border-image` is real CSS this engine's typed contract cannot carry.
    // CSS drops what an engine cannot represent and applies the rest, so the
    // chapter must still resolve with its supported declarations intact.
    document.stylesheets[0].text = "p { color: red; border-image: none; }".to_owned();
    let prepared = prepare_loaded_document(&document);

    let chapter = prepare_runtime_layout_chapter(&prepared, &layout())
        .expect("unrepresentable CSS must not refuse the chapter")
        .expect("the chapter resolves");

    assert_eq!(chapter.idref, "chapter-1");
}

#[test]
fn undeclared_entity_chapter_renders_literally() {
    let mut document = supported_document();
    document.chapters[0].xhtml_source =
        "<html><body><p>&not-a-declared-entity;</p></body></html>".to_owned();
    let prepared = prepare_loaded_document(&document);
    let chapter = &prepared.chapters[0];
    // The reference the source repairs to `&amp;…;` renders literally,
    // the way browsers render an undefined entity, instead of blanking
    // the chapter.
    assert!(chapter.source_arena.is_some());
    assert!(!chapter.parsed.nodes.is_empty());
    assert!(chapter.parsed.warnings.is_empty());

    let resolved = prepare_runtime_layout_chapter(&prepared, &layout())
        .expect("repaired chapter resolves")
        .expect("the chapter resolves");

    assert_eq!(resolved.idref, "chapter-1");
}

#[test]
fn non_empty_chapter_without_source_arena_keeps_typed_error() {
    let document = supported_document();
    let mut prepared = prepare_loaded_document(&document);
    assert!(!prepared.chapters[0].parsed.nodes.is_empty());
    Rc::make_mut(&mut prepared.chapters[0]).source_arena = None;

    let error = match prepare_runtime_layout_chapter(&prepared, &layout()) {
        Ok(_) => panic!("non-empty topology without its source arena must fail"),
        Err(error) => error,
    };

    assert!(error.message().contains("chapter.xhtml"));
    assert!(error
        .message()
        .contains("canonical source arena is missing"));
}

fn layout() -> LayoutConfig {
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
    })
}

fn supported_document() -> LoadedEpubDocument {
    LoadedEpubDocument {
        package: PackageDocument {
            metadata: PackageMetadata {
                title: "Diagnostics boundary".to_owned(),
                language: "en".to_owned(),
                identifier: "diagnostics-boundary".to_owned(),
                creator: None,
            },
            manifest: Vec::new(),
            spine: Vec::new(),
            toc: Vec::new(),
        },
        stylesheets: vec![LoadedTextResource {
            href: "styles/main.css".to_owned(),
            text: "p { color: red; }".to_owned(),
        }],
        fonts: Vec::new(),
        images: Vec::new(),
        chapters: vec![LoadedChapter {
            idref: "chapter-1".to_owned(),
            href: "chapter.xhtml".to_owned(),
            linear: true,
            xhtml_source: concat!(
                r#"<html><head><link rel="stylesheet" href="styles/main.css" />"#,
                r#"</head><body><p>Fast production loading</p></body></html>"#,
            )
            .to_owned(),
            source_loaded: true,
            image_refs: None,
        }],
        archive_source: None,
    }
}
