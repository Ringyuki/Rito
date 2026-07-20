use std::sync::Arc;

use rito_source::SourceArena;
use rito_style_contract::{AbsoluteColor, AbsoluteColorSpace, ColorNoneFlags, ComputedColorV1};
use rito_stylo::{
    supports_body_bgcolor_presentational_hint, StyleDocument, StyleError, StylesheetInput, Viewport,
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
