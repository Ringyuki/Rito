use std::sync::Arc;

use rito_source::SourceArena;
use rito_style_contract::{
    AbsoluteColor, AbsoluteColorSpace, ColorNoneFlags, ComputedColorV1, CssPx, LengthPercentage,
    NonNegativeLengthPercentage, Percentage, PreferredSizeV1,
};
use rito_stylo::{
    supports_body_bgcolor_presentational_hint, supports_svg_geometry_presentational_hint,
    StyleDocument, StyleError, StylesheetInput, Viewport,
};

const URL: &str = "https://example.test/book/chapter.xhtml";

#[test]
fn body_bgcolor_is_an_exact_pres_hints_background_declaration() {
    for (value, expected) in [
        ("#fff", srgb(1.0, 1.0, 1.0)),
        ("#ED7A81", srgb(237.0 / 255.0, 122.0 / 255.0, 129.0 / 255.0)),
        ("ReD", srgb(1.0, 0.0, 0.0)),
        ("chucknorris", srgb(192.0 / 255.0, 0.0, 0.0)),
    ] {
        assert!(supports_body_bgcolor_presentational_hint(value));
        assert_eq!(projected_body_background(value, ""), expected, "{value:?}");
    }
}

#[test]
fn author_background_overrides_the_zero_specificity_presentational_hint() {
    assert_eq!(
        projected_body_background("#ED7A81", "body { background-color: #010203 }"),
        srgb(1.0 / 255.0, 2.0 / 255.0, 3.0 / 255.0)
    );
}

#[test]
fn invalid_legacy_colour_values_fail_closed_before_traversal() {
    for value in ["", "   ", "transparent", " TRANSPARENT\t"] {
        assert!(!supports_body_bgcolor_presentational_hint(value));
        let source = source(&format!(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body id="body" bgcolor="{value}"/></html>"#
        ));
        assert!(matches!(
            StyleDocument::from_epub_source(source, URL, Viewport::default(), &[]),
            Err(StyleError::UnsupportedPresentationalHint {
                name: "body@bgcolor",
                ..
            })
        ));
    }
}

#[test]
fn bgcolor_on_non_body_elements_is_not_a_body_hint() {
    let source = source(
        r##"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target" bgcolor="#fff">text</p></body></html>"##,
    );
    let target = source.find_element_by_id("target").expect("target node");
    let mut document =
        StyleDocument::from_epub_source(Arc::clone(&source), URL, Viewport::default(), &[])
            .expect("style document");
    let projection = document.resolve_inline_styles_v1().expect("projection");

    assert_eq!(
        projection
            .table()
            .style_for_node(target.index())
            .expect("target style")
            .paint
            .background,
        transparent()
    );
}

#[test]
fn svg_geometry_attributes_are_pres_hints_width_and_height_declarations() {
    let (width, height) = projected_svg_size(r#"width="100%" height="480""#, "");
    assert_eq!(width, percent(100.0));
    assert_eq!(height, px(480.0));
}

#[test]
fn bare_svg_numbers_are_user_unit_px_lengths() {
    let (width, height) = projected_svg_size(r#"width="613" height="24.5""#, "");
    assert_eq!(width, px(613.0));
    assert_eq!(height, px(24.5));
}

#[test]
fn author_size_rules_override_the_zero_specificity_svg_geometry_hint() {
    let (width, height) = projected_svg_size(
        r#"width="100%" height="480""#,
        "svg { width: 50% }",
    );
    assert_eq!(width, percent(50.0));
    assert_eq!(height, px(480.0));
}

#[test]
fn invalid_svg_geometry_values_are_ignored_like_a_browser_ignores_them() {
    for attributes in [r#"width="-5""#, r#"width="abc""#, r#"width=" ""#] {
        let (width, height) = projected_svg_size(attributes, "");
        assert_eq!(width, PreferredSizeV1::Auto, "{attributes:?}");
        assert_eq!(height, PreferredSizeV1::Auto, "{attributes:?}");
    }
}

#[test]
fn svg_geometry_attributes_outside_the_svg_namespace_are_not_hints() {
    let source = source(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target" width="100%">text</p></body></html>"#,
    );
    let target = source.find_element_by_id("target").expect("target node");
    let mut document =
        StyleDocument::from_epub_source(Arc::clone(&source), URL, Viewport::default(), &[])
            .expect("style document");
    let projection = document
        .resolve_production_slice_v1()
        .expect("projection");
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .expect("target layout style");
    assert_eq!(style.width, PreferredSizeV1::Auto);
}

fn projected_svg_size(attributes: &str, css: &str) -> (PreferredSizeV1, PreferredSizeV1) {
    let source = source(&format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><figure><svg xmlns="http://www.w3.org/2000/svg" id="target" {attributes} viewBox="0 0 1000 1500"/></figure></body></html>"#
    ));
    let target = source.find_element_by_id("target").expect("svg node");
    let stylesheets = [StylesheetInput::author(css, URL)];
    let mut document = StyleDocument::from_epub_source(
        Arc::clone(&source),
        URL,
        Viewport::default(),
        &stylesheets,
    )
    .expect("style document");
    let projection = document
        .resolve_production_slice_v1()
        .expect("projection");
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .expect("svg layout style");
    (style.width, style.height)
}

fn percent(value: f32) -> PreferredSizeV1 {
    PreferredSizeV1::Value(NonNegativeLengthPercentage::new(
        LengthPercentage::Percentage(Percentage::from_percent(value).expect("valid percentage")),
    ))
}

fn px(value: f32) -> PreferredSizeV1 {
    PreferredSizeV1::Value(NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(value).expect("valid px length"),
    )))
}

fn projected_body_background(value: &str, css: &str) -> ComputedColorV1 {
    let source = source(&format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body id="body" bgcolor="{value}"/></html>"#
    ));
    let body = source.find_element_by_id("body").expect("body node");
    let stylesheets = [StylesheetInput::author(css, URL)];
    let mut document = StyleDocument::from_epub_source(
        Arc::clone(&source),
        URL,
        Viewport::default(),
        &stylesheets,
    )
    .expect("style document");
    let projection = document.resolve_inline_styles_v1().expect("projection");
    projection
        .table()
        .style_for_node(body.index())
        .expect("body style")
        .paint
        .background
}

fn source(xhtml: &str) -> Arc<SourceArena> {
    Arc::new(SourceArena::from_xhtml(xhtml).expect("valid XHTML"))
}

fn srgb(red: f32, green: f32, blue: f32) -> ComputedColorV1 {
    ComputedColorV1::Absolute(
        AbsoluteColor::new(
            AbsoluteColorSpace::Srgb,
            [red, green, blue],
            1.0,
            ColorNoneFlags::new(false, false, false, false),
        )
        .expect("valid sRGB colour"),
    )
}

fn transparent() -> ComputedColorV1 {
    ComputedColorV1::Absolute(
        AbsoluteColor::new(
            AbsoluteColorSpace::Srgb,
            [0.0, 0.0, 0.0],
            0.0,
            ColorNoneFlags::new(false, false, false, false),
        )
        .expect("valid transparent colour"),
    )
}
