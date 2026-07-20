use std::sync::Arc;

use serde_json::json;

use crate::{
    css::CssViewport,
    epub::{
        LoadedChapter, LoadedEpubDocument, LoadedTextResource, PackageDocument, PackageMetadata,
    },
    style::{
        resolve_prepared_chapter_style, style_backend_metrics, ChapterStyleOptions,
        PreparedStyleChapterInput, StyleBackendError, StyledNode,
    },
    xhtml::DocumentNode,
};

use super::{parse_loaded_chapter_source, prepare_loaded_document_base};

#[test]
fn prepared_base_keeps_legacy_css_unparsed() {
    let document = document_with_stylesheet("styles/main.css", "p { color: red; }");
    let base = prepare_loaded_document_base(&document);

    assert_eq!(base.stylesheet_ledger.sources().len(), 1);
    assert_eq!(
        base.stylesheet_ledger.sources()[0].href(),
        "styles/main.css"
    );
    assert_eq!(
        base.stylesheet_ledger.sources()[0].text(),
        "p { color: red; }"
    );
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[cfg(feature = "legacy-css-diagnostics")]
#[test]
fn prepared_clones_share_one_legacy_artifact_initialization() {
    let document = document_with_stylesheet("book.css", "p { color: red; }");
    let base = prepare_loaded_document_base(&document);
    let cloned = base.clone();

    assert!(Arc::ptr_eq(
        &base.stylesheet_ledger.legacy,
        &cloned.stylesheet_ledger.legacy
    ));
    let first = base.stylesheet_ledger.legacy_artifacts();
    let second = cloned.stylesheet_ledger.legacy_artifacts();

    assert!(std::ptr::eq(first, second));
    assert_eq!(first.css().stylesheet_count, 1);
    assert_eq!(first.stylesheet_rules().len(), 1);
}

#[test]
fn prepared_chapter_retains_the_canonical_arena_across_clones() {
    let chapter = chapter("<html><body><p id='target'>shared</p></body></html>");
    let prepared = parse_loaded_chapter_source(&chapter);
    let arena = prepared.source_arena.as_ref().expect("canonical arena");
    let paragraph_id = arena
        .find_element_by_id("target")
        .expect("paragraph source id");
    let DocumentNode::Block(paragraph) = &prepared.parsed.nodes[0] else {
        panic!("expected paragraph");
    };
    assert_eq!(paragraph.source_ref.source_node_id, Some(paragraph_id));

    let cloned = prepared.clone();
    assert!(Arc::ptr_eq(
        arena,
        cloned.source_arena.as_ref().expect("cloned arena")
    ));
}

#[test]
fn invalid_chapter_keeps_the_existing_warning_fallback_without_an_arena() {
    let prepared = parse_loaded_chapter_source(&chapter(
        "<html><body><p>&not-a-declared-entity;</p></body></html>",
    ));

    assert!(prepared.source_arena.is_none());
    assert!(prepared.parsed.nodes.is_empty());
    assert_eq!(prepared.parsed.warnings.len(), 1);
}

#[test]
fn production_stylo_success_never_initializes_legacy_css_artifacts() {
    let before = style_backend_metrics();
    let document = document_with_stylesheet(
        "styles/main.css",
        "@page { margin: 0; } p { color: red; border: currentColor inset 1px; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>styled</p></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let paragraph = find_tag(&resolved, "p").expect("styled paragraph");
    assert_eq!(
        paragraph.style.get("color"),
        Some(&serde_json::json!("#ff0000"))
    );
    assert_eq!(
        paragraph.style.get("backgroundColor"),
        Some(&serde_json::json!(""))
    );
    assert_eq!(
        paragraph.style["borderTop"]["width"],
        serde_json::json!(1.0)
    );
    assert_eq!(
        paragraph.style["borderTop"]["style"],
        serde_json::json!("solid")
    );
    assert_eq!(
        paragraph.style["borderTop"]["color"],
        serde_json::json!("#ff0000")
    );
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
    assert!(style_backend_metrics().stylo_successes > before.stylo_successes);
}

#[test]
fn stylo_medium_border_keeps_the_browser_compatible_three_pixel_width() {
    let document = document_with_stylesheet(
        "styles/main.css",
        ".cutline { border-top: medium double black; border-bottom: medium double black; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><div class="cutline">content</div></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let cutline = find_tag(&resolved, "div").expect("styled cutline");
    assert_eq!(cutline.style["borderTop"]["width"], json!(3.0));
    assert_eq!(cutline.style["borderBottom"]["width"], json!(3.0));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn audited_legacy_noops_and_safe_list_shorthand_stay_on_stylo() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "p { color: navy; background: #cceead; background-attachment: fixed; \
             border-collapse: collapse; border-spacing: 0; duokan-bleed: leftright; \
             duokan-text-indent: -2em; -webkit-transform: rotate(5deg); \
             text-emphasis: circle #000; page-break-inside: avoid; } \
         ol { list-style: none; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>text</p><ol><li>item</li></ol></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let paragraph = find_tag(&resolved, "p").expect("styled paragraph");
    let list = find_tag(&resolved, "ol").expect("styled list");
    assert_eq!(paragraph.style["color"], serde_json::json!("#000080"));
    assert_eq!(paragraph.style["backgroundColor"], json!("#cceead"));
    assert_eq!(list.style["listStyleType"], serde_json::json!("none"));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn clear_and_max_width_use_the_typed_stylo_layout_bridge() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "p { clear: both; max-width: 80%; color: green; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>text</p></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let paragraph = find_tag(&resolved, "p").expect("styled paragraph");
    assert_eq!(paragraph.style["clear"], serde_json::json!("both"));
    assert_eq!(paragraph.style["maxWidthPct"], serde_json::json!(80.0));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn height_float_and_overflow_use_the_typed_stylo_layout_bridge() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "p { min-height: 12px; max-height: 100%; float: right; overflow: hidden; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>text</p></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let paragraph = find_tag(&resolved, "p").expect("styled paragraph");
    assert_eq!(paragraph.style["minHeight"], serde_json::json!(12.0));
    assert!(!paragraph.style.contains_key("maxHeight"));
    assert_eq!(paragraph.style["float"], serde_json::json!("right"));
    assert_eq!(paragraph.style["overflow"], serde_json::json!("hidden"));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn page_break_aliases_materialize_from_stylo_without_legacy_css() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "#standard { break-before: page; page-break-after: always; } \
         #legacy { page-break-before: always; break-after: page; } \
         #inline { break-before: auto; break-after: auto; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body>
            <p id="standard">standard</p><p id="legacy">legacy</p>
            <p id="inline" style="page-break-before: always; break-after: page">inline</p>
        </body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    for id in ["standard", "legacy", "inline"] {
        let paragraph = find_id(&resolved, id).expect("styled paragraph");
        assert_eq!(paragraph.style["pageBreakBefore"], json!("always"));
        assert_eq!(paragraph.style["pageBreakAfter"], json!("always"));
    }
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn unsupported_page_break_value_fails_closed_without_legacy_css() {
    let document = document_with_stylesheet("styles/main.css", "p { break-before: left; }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>text</p></body></html>"#,
    ));

    let error = try_resolve_prepared_with_page_paint(&base.stylesheet_ledger, &chapter)
        .expect_err("unsupported page-break semantics must fail closed");
    assert!(error.to_string().contains("materialization rejected"));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn percentage_height_uses_the_explicit_consumer_compatibility_policy() {
    let document = document_with_stylesheet("styles/main.css", "p { height: 93%; }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>text</p></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let paragraph = find_tag(&resolved, "p").expect("styled paragraph");
    // The retired parser ignored percentage heights, so the consumer field
    // keeps its zero default rather than being omitted.
    assert_eq!(paragraph.style.get("height"), Some(&serde_json::json!(0.0)));
    assert!(!paragraph.style.contains_key("heightPct"));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn bounded_single_image_flex_wrapper_retains_exact_centering_contract() {
    let document = document_with_stylesheet(
        "styles/main.css",
        ".duokan-image-single { display: flex; height: 93vh !important; \
         justify-content: center; align-items: center; } \
         .duokan-image-single .w { width: 100%; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><div class="illus duokan-image-single"><img class="w" src="image.jpg" /></div></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let wrapper = find_tag(&resolved, "div").expect("single-image wrapper");
    assert_eq!(wrapper.style["display"], json!("flex"));
    assert_eq!(wrapper.style["justifyContent"], json!("center"));
    assert_eq!(wrapper.style["alignItems"], json!("center"));
    assert_eq!(wrapper.style["flexDirection"], json!("row"));
    assert_eq!(wrapper.style["flexWrap"], json!("nowrap"));
    assert_eq!(wrapper.style["height"], json!(558.0));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn bounded_single_image_flex_rejects_multiple_items_without_legacy_fallback() {
    let document = document_with_stylesheet(
        "styles/main.css",
        ".duokan-image-single { display: flex; height: 93vh; \
         justify-content: center; align-items: center; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><div class="illus duokan-image-single"><img class="w" src="one.jpg" /><img class="w" src="two.jpg" /></div></body></html>"#,
    ));

    let error = try_resolve_prepared_with_page_paint(&base.stylesheet_ledger, &chapter)
        .expect_err("multi-child flex must fail closed");
    assert!(error.to_string().contains("materialization rejected"));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn bounded_single_image_flex_rejects_auto_item_margins_before_layout() {
    let document = document_with_stylesheet(
        "styles/main.css",
        ".single { display: flex; height: 240px; justify-content: center; \
         align-items: center; } .single img { margin-left: auto; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><div class="single"><img src="one.jpg" /></div></body></html>"#,
    ));

    let error = try_resolve_prepared_with_page_paint(&base.stylesheet_ledger, &chapter)
        .expect_err("auto-margin flex item must fail before a StyledNode is emitted");
    assert!(error.to_string().contains("materialization rejected"));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn background_url_cluster_uses_stylesheet_base_and_typed_stylo_paint() {
    let document = document_with_stylesheet(
        "Styles/main.css",
        ".card { background-image: url(../Images/paper.png); \
         background-repeat: no-repeat; background-position: top center; \
         background-size: cover; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "Text/chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="../Styles/main.css" /></head><body><div class="card">text</div></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let card = find_tag(&resolved, "div").expect("background card");
    assert_eq!(card.style["backgroundImage"], json!("Images/paper.png"));
    assert_eq!(card.style["backgroundRepeat"], json!("no-repeat"));
    assert_eq!(card.style["backgroundSize"], json!("cover"));
    assert_eq!(
        card.style["backgroundPosition"],
        json!({
            "x": { "unit": "percent", "value": 50.0 },
            "y": { "unit": "percent", "value": 0.0 },
        })
    );
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn rotate_transform_uses_the_typed_stylo_paint_bridge() {
    let document =
        document_with_stylesheet("styles/main.css", ".badge { transform: rotate(-8deg); }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><span class="badge">text</span></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let badge = find_tag(&resolved, "span").expect("transformed badge");
    let transform = badge.style["transform"]
        .as_array()
        .expect("transform array");
    assert_eq!(transform.len(), 1);
    assert_eq!(transform[0]["kind"], json!("rotate"));
    assert!(
        (transform[0]["rad"].as_f64().expect("finite radians") - (-8.0_f64).to_radians()).abs()
            < 1.0e-7
    );
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn border_radius_shorthand_uses_the_audited_first_component_contract() {
    let document = document_with_stylesheet(
        "styles/main.css",
        ".badge { border-radius: 0 20px 20px 0; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><span class="badge">text</span></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let badge = find_tag(&resolved, "span").expect("rounded badge");
    assert_eq!(badge.style["borderRadius"], json!(0.0));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn unsupported_transform_operation_returns_error_without_legacy_fallback() {
    let document = document_with_stylesheet("styles/main.css", ".badge { transform: scale(1.2); }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><span class="badge">fallback</span></body></html>"#,
    ));

    let error = try_resolve_prepared_with_page_paint(&base.stylesheet_ledger, &chapter)
        .expect_err("unsupported transform must fail closed");
    assert!(error.to_string().contains("materialization rejected"));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn unsupported_background_value_returns_error_without_legacy_fallback() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "p { background-image: linear-gradient(red, blue); }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>fallback</p></body></html>"#,
    ));

    let error = try_resolve_prepared_with_page_paint(&base.stylesheet_ledger, &chapter)
        .expect_err("unsupported background must fail closed");
    assert!(error.to_string().contains("materialization rejected"));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn body_background_url_uses_typed_page_paint_without_legacy_fallback() {
    let document = document_with_stylesheet(
        "Styles/main.css",
        "body { background-color: #123456; background-image: url(../Images/page.png); \
         background-repeat: no-repeat; background-position: top center; \
         background-size: cover; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "Text/chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="../Styles/main.css" /></head><body><p>page background</p></body></html>"#,
    ));

    let (_, page_paint) = resolve_prepared_with_page_paint(&base.stylesheet_ledger, &chapter);
    assert_eq!(
        page_paint,
        Some(json!({
            "backgroundColor": "#123456",
            "backgroundImage": "Images/page.png",
            "backgroundRepeat": "no-repeat",
            "backgroundSize": "cover",
            "backgroundPosition": {
                "x": { "unit": "percent", "value": 50.0 },
                "y": { "unit": "percent", "value": 0.0 },
            },
        }))
    );
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn body_bgcolor_uses_stylo_presentational_hint_without_legacy_fallback() {
    let document = document_with_stylesheet("styles/main.css", "p { color: navy; }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r##"<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="styles/main.css" /></head><body bgcolor="#fff"><p>page background</p></body></html>"##,
    ));

    let (_, page_paint) = resolve_prepared_with_page_paint(&base.stylesheet_ledger, &chapter);
    assert_eq!(page_paint, Some(json!({ "backgroundColor": "#ffffff" })));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn opacity_uses_the_typed_stylo_paint_bridge() {
    let document = document_with_stylesheet("styles/main.css", "p { opacity: 0.25; }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>quarter opacity</p></body></html>"#,
    ));

    let resolved = resolve_prepared(&base.stylesheet_ledger, &chapter);
    let paragraph = find_tag(&resolved, "p").expect("styled paragraph");
    assert_eq!(paragraph.style["opacity"], json!(0.25));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn configured_root_font_size_is_the_initial_em_and_computed_rem_basis() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "html { font-size: 2em; } #target { font-size: 1rem; margin-left: 1rem; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p id="target">text</p></body></html>"#,
    ));
    let options = ChapterStyleOptions {
        root_font_size: 22.0,
        line_height_override: None,
        line_height_force: false,
        font_family_override: None,
        font_family_force: false,
    };

    let (resolved, _) =
        try_resolve_prepared_with_options(&base.stylesheet_ledger, &chapter, options).unwrap();
    let target = find_id(&resolved, "target").expect("target paragraph");
    assert_eq!(target.style["fontSize"], json!(44.0));
    assert_eq!(target.style["marginLeft"], json!(44.0));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn non_force_typography_overrides_body_then_allows_descendant_declarations() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "body { font-family: AuthorBody !important; line-height: 3 !important; } \
         #specific { font-family: \"Book Face\"; line-height: 2; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p id="inherited">one</p><p id="specific">two</p></body></html>"#,
    ));
    let options = ChapterStyleOptions {
        root_font_size: 16.0,
        line_height_override: Some(1.6),
        line_height_force: false,
        font_family_override: Some("Georgia, serif"),
        font_family_force: false,
    };

    let (resolved, _) =
        try_resolve_prepared_with_options(&base.stylesheet_ledger, &chapter, options).unwrap();
    let inherited = find_id(&resolved, "inherited").expect("inherited paragraph");
    let specific = find_id(&resolved, "specific").expect("specific paragraph");
    assert_eq!(inherited.style["fontFamily"], json!("Georgia, serif"));
    assert_eq!(inherited.style["lineHeight"], json!(1.6));
    assert_eq!(specific.style["fontFamily"], json!("\"Book Face\""));
    assert_eq!(specific.style["lineHeight"], json!(2.0));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

#[test]
fn force_typography_still_overwrites_descendant_declarations() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "#target { font-family: \"Book Face\"; line-height: 2; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p id="target">text</p></body></html>"#,
    ));
    let options = ChapterStyleOptions {
        root_font_size: 16.0,
        line_height_override: Some(1.4),
        line_height_force: true,
        font_family_override: Some("Georgia, serif"),
        font_family_force: true,
    };

    let (resolved, _) =
        try_resolve_prepared_with_options(&base.stylesheet_ledger, &chapter, options).unwrap();
    let target = find_id(&resolved, "target").expect("target paragraph");
    assert_eq!(target.style["fontFamily"], json!("Georgia, serif"));
    assert_eq!(target.style["lineHeight"], json!(1.4));
}

#[test]
fn invalid_font_family_override_is_rejected_before_stylesheet_injection() {
    let document = document_with_stylesheet("styles/main.css", "p { color: red; }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter(
        r#"<html><body><p id="target">text</p></body></html>"#,
    ));
    let options = ChapterStyleOptions {
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: false,
        font_family_override: Some("Georgia; color: lime"),
        font_family_force: false,
    };

    let error = try_resolve_prepared_with_options(&base.stylesheet_ledger, &chapter, options)
        .expect_err("declaration injection must fail closed");
    assert!(error.to_string().contains("valid CSS font-family list"));
    assert!(base
        .stylesheet_ledger
        .legacy_artifacts_if_initialized()
        .is_none());
}

fn resolve_prepared(
    stylesheet_ledger: &super::StylesheetSourceLedger,
    chapter: &super::ParsedLoadedChapterSource,
) -> Vec<StyledNode> {
    resolve_prepared_with_page_paint(stylesheet_ledger, chapter).0
}

fn resolve_prepared_with_page_paint(
    stylesheet_ledger: &super::StylesheetSourceLedger,
    chapter: &super::ParsedLoadedChapterSource,
) -> (Vec<StyledNode>, Option<serde_json::Value>) {
    try_resolve_prepared_with_page_paint(stylesheet_ledger, chapter)
        .expect("supported Stylo chapter resolves")
}

fn try_resolve_prepared_with_page_paint(
    stylesheet_ledger: &super::StylesheetSourceLedger,
    chapter: &super::ParsedLoadedChapterSource,
) -> Result<(Vec<StyledNode>, Option<serde_json::Value>), StyleBackendError> {
    try_resolve_prepared_with_options(
        stylesheet_ledger,
        chapter,
        ChapterStyleOptions {
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: false,
            font_family_override: None,
            font_family_force: false,
        },
    )
}

fn try_resolve_prepared_with_options(
    stylesheet_ledger: &super::StylesheetSourceLedger,
    chapter: &super::ParsedLoadedChapterSource,
    options: ChapterStyleOptions<'_>,
) -> Result<(Vec<StyledNode>, Option<serde_json::Value>), StyleBackendError> {
    resolve_prepared_chapter_style(
        PreparedStyleChapterInput {
            stylesheet_ledger,
            chapter_href: &chapter.source.href,
            source_arena: chapter.source_arena.as_ref(),
            body_source_node_id: chapter.parsed.body_source_node_id,
            nodes: &chapter.parsed.nodes,
            pagination_nodes: None,
            #[cfg(feature = "legacy-css-diagnostics")]
            body_attributes: chapter.parsed.body_attributes.as_ref(),
            author_stylesheets: &chapter.parsed.author_stylesheets,
        },
        Some(CssViewport::new(800.0, 600.0)),
        options,
    )
    .map(|resolved| (resolved.styled_nodes, resolved.page_paint))
}

fn find_id<'a>(nodes: &'a [StyledNode], id: &str) -> Option<&'a StyledNode> {
    nodes.iter().find_map(|node| {
        (node.id.as_deref() == Some(id))
            .then_some(node)
            .or_else(|| find_id(&node.children, id))
    })
}

fn find_tag<'a>(nodes: &'a [StyledNode], tag: &str) -> Option<&'a StyledNode> {
    nodes.iter().find_map(|node| {
        (node.tag.as_deref() == Some(tag))
            .then_some(node)
            .or_else(|| find_tag(&node.children, tag))
    })
}

fn chapter(xhtml_source: &str) -> LoadedChapter {
    chapter_with_href("chapter-1.xhtml", xhtml_source)
}

fn chapter_with_href(href: &str, xhtml_source: &str) -> LoadedChapter {
    LoadedChapter {
        idref: "chapter-1".to_owned(),
        href: href.to_owned(),
        linear: true,
        xhtml_source: xhtml_source.to_owned(),
        source_loaded: true,
        image_refs: None,
    }
}

fn document_with_stylesheet(href: &str, text: &str) -> LoadedEpubDocument {
    LoadedEpubDocument {
        package: PackageDocument {
            metadata: PackageMetadata {
                title: "Prepared".to_owned(),
                language: "en".to_owned(),
                identifier: "prepared-test".to_owned(),
                creator: None,
            },
            manifest: Vec::new(),
            spine: Vec::new(),
            toc: Vec::new(),
        },
        stylesheets: vec![LoadedTextResource {
            href: href.to_owned(),
            text: text.to_owned(),
        }],
        fonts: Vec::new(),
        images: Vec::new(),
        chapters: Vec::new(),
        archive_source: None,
    }
}
