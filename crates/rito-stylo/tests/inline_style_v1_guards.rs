use std::sync::Arc;

use rito_source::SourceArena;
use rito_stylo::{
    InlineStyleDispositionV1, InlineStyleFieldV1, InlineStyleProjectionReasonV1, StyleDocument,
    StylesheetInput, Viewport,
};

const URL: &str = "https://example.test/book/chapter.xhtml";

#[test]
fn shared_symbolic_payloads_remain_shared_across_unique_foregrounds() {
    let span_count = 128;
    let (source, projection) = shared_shadow_projection(span_count, 16);
    let first = source.find_element_by_id("item-0").unwrap();
    let last = source
        .find_element_by_id(&format!("item-{}", span_count - 1))
        .unwrap();
    let first_style = projection.table().style_for_node(first.index()).unwrap();
    let last_style = projection.table().style_for_node(last.index()).unwrap();

    assert!(Arc::ptr_eq(
        &first_style.paint.text_shadows,
        &last_style.paint.text_shadows
    ));
    assert!(Arc::ptr_eq(
        &first_style.paint.box_shadows,
        &last_style.paint.box_shadows
    ));
    let first_language = first_style.text_flow.language.as_ref().unwrap();
    let last_language = last_style.text_flow.language.as_ref().unwrap();
    assert_eq!(first_language.as_str(), "zh-hant-tw");
    assert_eq!(
        first_language.as_str().as_ptr(),
        last_language.as_str().as_ptr()
    );
}

#[test]
fn complex_current_color_shadow_fails_closed() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#target { text-shadow: 0 0 color-mix(in srgb, currentcolor, red) }",
    );
    let projection = document.resolve_inline_styles_v1().unwrap();

    assert!(projection
        .dispositions()
        .contains(&InlineStyleDispositionV1::ContractRejected {
            node_id: target,
            field: InlineStyleFieldV1::TextShadow,
            reason: InlineStyleProjectionReasonV1::UnsupportedValue,
        }));
}

#[test]
fn hostile_shadow_list_hits_the_budget_before_projection() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let shadows = shadow_list(rito_style_contract::INLINE_STYLE_LIST_ITEM_LIMIT_V1 + 1);
    let mut document = document(
        Arc::clone(&source),
        &format!("#target {{ text-shadow: {shadows} }}"),
    );
    let projection = document.resolve_inline_styles_v1().unwrap();

    assert!(projection
        .dispositions()
        .contains(&InlineStyleDispositionV1::ContractRejected {
            node_id: target,
            field: InlineStyleFieldV1::TextShadow,
            reason: InlineStyleProjectionReasonV1::ProjectionBudgetExceeded,
        }));
}

#[test]
fn projection_debug_is_bounded_to_summary_counts() {
    let (_, projection) = shared_shadow_projection(128, 16);
    let debug = format!("{projection:?}");

    assert!(debug.len() < 700, "unexpected debug payload: {debug}");
    assert!(!debug.contains("ContractProjected"));
    assert!(!debug.contains("node_id"));
    assert!(debug.contains("disposition_count"));
    assert!(debug.contains("text_shadow_item_projection_count: 16"));
    assert!(debug.contains("box_shadow_item_projection_count: 16"));
    assert!(debug.contains("language_tag_normalization_count: 1"));
}

fn shared_shadow_projection(
    span_count: usize,
    shadow_count: usize,
) -> (Arc<SourceArena>, rito_stylo::InlineStyleProjectionV1) {
    let mut children = String::new();
    for index in 0..span_count {
        children.push_str(&format!(
            r#"<span id="item-{index}" style="color:#{:06x}"/>"#,
            index + 1
        ));
    }
    let source = source(&format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="root" lang="ZH-Hant-TW">{children}</div></body></html>"#
    ));
    let shadows = shadow_list(shadow_count);
    let css =
        format!("#root {{ text-shadow: {shadows} }} #root > span {{ box-shadow: {shadows} }}");
    let mut document = document(Arc::clone(&source), &css);
    let projection = document.resolve_inline_styles_v1().unwrap();
    (source, projection)
}

fn shadow_list(item_count: usize) -> String {
    (0..item_count)
        .map(|_| "0 0 currentcolor")
        .collect::<Vec<_>>()
        .join(",")
}

fn target_source() -> Arc<SourceArena> {
    source(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
    )
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
