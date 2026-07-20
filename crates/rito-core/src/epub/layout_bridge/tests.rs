use serde_json::Value;

use super::{
    build_prepared_loaded_document_with_layout_and_line_breaking,
    default_publication_layout_config, PublicationDiagnosticsMode,
};
use crate::{
    epub::{
        prepare_loaded_document, LoadedChapter, LoadedEpubDocument, LoadedTextResource,
        PackageDocument, PackageMetadata,
    },
    layout::LineBreaking,
};

#[test]
fn production_publication_omits_compatibility_diagnostics() {
    let document = supported_document();
    let prepared = prepare_loaded_document(&document);
    let layout = default_publication_layout_config();

    let production = build_prepared_loaded_document_with_layout_and_line_breaking(
        &document,
        &prepared,
        &layout,
        LineBreaking::Greedy,
        PublicationDiagnosticsMode::None,
    )
    .expect("production publication");

    assert!(production.publication.css.is_none());
    assert!(production.publication.style.is_none());
    assert!(prepared
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
    let serialized = serde_json::to_value(&production.publication).expect("serialize publication");
    assert_eq!(serialized.get("css"), Some(&Value::Null));
    assert_eq!(serialized.get("style"), Some(&Value::Null));

    #[cfg(feature = "legacy-css-diagnostics")]
    {
        let diagnostic = build_prepared_loaded_document_with_layout_and_line_breaking(
            &document,
            &prepared,
            &layout,
            LineBreaking::Greedy,
            PublicationDiagnosticsMode::Compatibility,
        )
        .expect("diagnostic publication");

        assert!(diagnostic.publication.css.is_some());
        assert!(diagnostic.publication.style.is_some());
        assert!(prepared
            .stylesheet_ledger
            .legacy_artifacts_if_initialized()
            .is_some());
        assert_eq!(production.publication.layout, diagnostic.publication.layout);
        assert_eq!(
            production.publication.interaction,
            diagnostic.publication.interaction
        );
    }
}

#[test]
fn production_rejects_unsupported_css_without_initializing_legacy_artifacts() {
    let mut document = supported_document();
    document.stylesheets[0].text = "p { color: red; position: relative; }".to_owned();
    let prepared = prepare_loaded_document(&document);
    let layout = default_publication_layout_config();

    let error = match build_prepared_loaded_document_with_layout_and_line_breaking(
        &document,
        &prepared,
        &layout,
        LineBreaking::Greedy,
        PublicationDiagnosticsMode::None,
    ) {
        Ok(_) => panic!("production must reject unsupported CSS"),
        Err(error) => error,
    };

    assert!(error.message().contains("chapter.xhtml"));
    assert!(error.message().contains("UnsupportedProperty"));
    assert!(error.message().contains("position"));
    assert!(prepared
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());

    #[cfg(feature = "legacy-css-diagnostics")]
    {
        build_prepared_loaded_document_with_layout_and_line_breaking(
            &document,
            &prepared,
            &layout,
            LineBreaking::Greedy,
            PublicationDiagnosticsMode::Compatibility,
        )
        .expect("explicit compatibility diagnostics may use the legacy parser");
        assert!(prepared
            .stylesheet_ledger
            .legacy_artifacts_if_initialized()
            .is_some());
    }
}

#[test]
fn malformed_xhtml_empty_chapter_keeps_warning_without_legacy_css() {
    let mut document = supported_document();
    document.chapters[0].xhtml_source =
        "<html><body><p>&not-a-declared-entity;</p></body></html>".to_owned();
    let prepared = prepare_loaded_document(&document);
    let chapter = &prepared.chapters[0];
    assert!(chapter.source_arena.is_none());
    assert!(chapter.parsed.nodes.is_empty());
    assert_eq!(chapter.parsed.warnings.len(), 1);

    let production = build_prepared_loaded_document_with_layout_and_line_breaking(
        &document,
        &prepared,
        &default_publication_layout_config(),
        LineBreaking::Greedy,
        PublicationDiagnosticsMode::None,
    )
    .expect("warning-only malformed chapter remains a valid empty publication chapter");

    assert_eq!(production.publication.xhtml.chapters[0].warning_count, 1);
    assert_eq!(production.publication.xhtml.chapters[0].top_level_count, 0);
    assert!(prepared
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn non_empty_chapter_without_source_arena_keeps_typed_error() {
    let document = supported_document();
    let mut prepared = prepare_loaded_document(&document);
    assert!(!prepared.chapters[0].parsed.nodes.is_empty());
    prepared.chapters[0].source_arena = None;

    let error = match build_prepared_loaded_document_with_layout_and_line_breaking(
        &document,
        &prepared,
        &default_publication_layout_config(),
        LineBreaking::Greedy,
        PublicationDiagnosticsMode::None,
    ) {
        Ok(_) => panic!("non-empty topology without its source arena must fail"),
        Err(error) => error,
    };

    assert!(error.message().contains("chapter.xhtml"));
    assert!(error
        .message()
        .contains("canonical source arena is missing"));
    assert!(prepared
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
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
