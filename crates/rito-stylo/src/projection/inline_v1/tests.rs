use std::sync::Arc;

use rito_source::SourceArena;

use crate::{StyleDocument, StylesheetInput, Viewport};

const URL: &str = "https://example.test/book/chapter.xhtml";

#[test]
fn shared_payload_operation_counts_are_linear_in_unique_lists() {
    let span_count = 64;
    let shadow_count = 8;
    let mut children = String::new();
    for index in 0..span_count {
        children.push_str(&format!(r#"<span style="color:#{:06x}"/>"#, index + 1));
    }
    let source = source(&format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="root" lang="JA">{children}</div></body></html>"#
    ));
    let shadows = shadow_list(shadow_count);
    let css =
        format!("#root {{ text-shadow: {shadows} }} #root > span {{ box-shadow: {shadows} }}");
    let mut document = document(source, &css);

    let projection = document.resolve_inline_styles_v1().unwrap();
    assert!(projection.metrics.base_style_projection_count >= span_count);
    assert_eq!(projection.metrics.language_tag_normalization_count, 1);
    assert_eq!(projection.metrics.text_shadow_payload_projection_count, 2);
    assert_eq!(
        projection.metrics.text_shadow_item_projection_count,
        shadow_count
    );
    assert_eq!(projection.metrics.box_shadow_payload_projection_count, 2);
    assert_eq!(
        projection.metrics.box_shadow_item_projection_count,
        shadow_count
    );
    assert_eq!(projection.metrics.font_family_payload_projection_count, 1);
    assert!(projection.metrics.font_family_item_projection_count > 0);
}

#[test]
fn deep_language_inheritance_normalizes_only_the_declaration() {
    let depth = 32;
    let mut nested = r#"<div lang="ZH-Hant-TW">"#.to_owned();
    for _ in 1..depth {
        nested.push_str("<div>");
    }
    nested.push_str(r#"<span id="deepest"/>"#);
    for _ in 0..depth {
        nested.push_str("</div>");
    }
    let source = source(&format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body>{nested}</body></html>"#
    ));
    let deepest = source.find_element_by_id("deepest").unwrap();
    let mut document = document(Arc::clone(&source), "");

    let projection = document.resolve_inline_styles_v1().unwrap();
    let language = projection
        .table
        .style_for_node(deepest.index())
        .unwrap()
        .text_flow
        .language
        .as_ref()
        .unwrap();
    assert_eq!(language.as_str(), "zh-hant-tw");
    assert_eq!(projection.metrics.language_tag_normalization_count, 1);
}

#[test]
fn repeated_resolved_background_url_projects_once_across_unique_styles() {
    let span_count = 64;
    let mut children = String::new();
    for index in 0..span_count {
        children.push_str(&format!(r#"<span style="color:#{:06x}"/>"#, index + 1));
    }
    let source = source(&format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="root">{children}</div></body></html>"#
    ));
    let mut document = document(
        source,
        "#root > span { background-image: url(Images/shared.jpg); background-repeat: no-repeat }",
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    assert_eq!(projection.metrics.background_image_url_projection_count, 1);
}

#[test]
fn shared_transform_storage_projects_once_across_unique_foregrounds() {
    let span_count = 64;
    let mut children = String::new();
    for index in 0..span_count {
        children.push_str(&format!(r#"<span style="color:#{:06x}"/>"#, index + 1));
    }
    let source = source(&format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="root">{children}</div></body></html>"#
    ));
    let mut document = document(
        source,
        "#root > span { transform: rotate(12deg) rotateZ(0.25rad) }",
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    assert_eq!(projection.metrics.transform_payload_projection_count, 2);
    assert_eq!(projection.metrics.transform_operation_projection_count, 2);
}

fn shadow_list(item_count: usize) -> String {
    (0..item_count)
        .map(|_| "0 0 currentcolor")
        .collect::<Vec<_>>()
        .join(",")
}

fn source(xhtml: &str) -> Arc<SourceArena> {
    Arc::new(SourceArena::from_xhtml(xhtml).expect("fixture XHTML parses"))
}

fn document(source: Arc<SourceArena>, css: &str) -> StyleDocument {
    StyleDocument::from_source(
        source,
        URL,
        Viewport::default(),
        &[StylesheetInput::author(css, URL)],
    )
    .expect("fixture style document builds")
}
