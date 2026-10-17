//! A chapter's styles hold at another viewport exactly when no computed
//! value read the viewport size and every media query answers as before.
//! Each case resolves at one viewport, asks about others, and checks the
//! answer against resolving there.

use std::sync::Arc;

use rito_source::SourceArena;
use rito_stylo::{StyleDocument, StylesheetInput, Viewport};

const DOCUMENT_URL: &str = "https://example.test/book/chapter.xhtml";
const BODY: &str = r#"<p id="target">x</p>"#;

#[test]
fn styles_that_read_nothing_of_the_viewport_hold_at_any_viewport() {
    let resolved = resolve("p { font-size: 17px; margin: 1em 5% }", 600.0, 16.0);
    for width in [200.0, 600.0, 1_600.0] {
        assert!(resolved.holds_at(viewport(width)), "{width}");
    }
    assert!(resolved.holds_at(Viewport {
        height: 300.0,
        ..viewport(600.0)
    }));
}

#[test]
fn a_viewport_length_holds_at_its_own_viewport_only() {
    for css in [
        "p { font-size: 3vw }",
        "p { margin-top: 2vh }",
        "p { width: 10vmin }",
    ] {
        let resolved = resolve(css, 600.0, 16.0);
        assert!(resolved.holds_at(viewport(600.0)), "{css}");
        assert!(!resolved.holds_at(viewport(599.0)), "{css}");
        assert!(
            !resolved.holds_at(Viewport {
                height: 700.0,
                ..viewport(600.0)
            }),
            "{css}"
        );
    }
}

#[test]
fn a_media_query_holds_while_it_answers_the_same() {
    // Each resolves at 500px with a 20px initial font size, then is asked
    // about a width on the same side of its threshold and one across it.
    for (css, holds, flips) in [
        (
            "@media (min-width: 340px) { p { font-size: 22px } }",
            400.0,
            300.0,
        ),
        (
            "@media (max-width: 339px) { p { font-size: 22px } }",
            400.0,
            300.0,
        ),
        // The device is the viewport: device-width follows it.
        (
            "@media (min-device-width: 340px) { p { font-size: 22px } }",
            400.0,
            300.0,
        ),
        // Nested inside another rule.
        (
            "@supports (display: block) { @media (min-width: 340px) { p { font-size: 22px } } }",
            400.0,
            300.0,
        ),
        // An em in a query is the initial font size: 30em at 20px is 600px.
        (
            "@media (min-width: 30em) { p { font-size: 22px } }",
            580.0,
            620.0,
        ),
    ] {
        let resolved = resolve(css, 500.0, 20.0);
        assert!(resolved.holds_at(viewport(holds)), "{css} at {holds}");
        assert!(!resolved.holds_at(viewport(flips)), "{css} at {flips}");
        // The answers agree with resolving there.
        let at_500 = font_size(css, 500.0, 20.0);
        assert_eq!(at_500, font_size(css, holds, 20.0), "{css}");
        assert_ne!(at_500, font_size(css, flips, 20.0), "{css}");
    }
}

fn resolve(css: &str, width: f32, root_font_size: f32) -> rito_stylo::ViewportDependence {
    let mut document = document(css, width, root_font_size);
    document.resolve_production_slice().expect("resolves");
    document.viewport_dependence()
}

fn font_size(css: &str, width: f32, root_font_size: f32) -> f32 {
    let source = source();
    let target = source.find_element_by_id("target").expect("target");
    let mut document = document(css, width, root_font_size);
    let (inline, _) = document
        .resolve_production_slice()
        .expect("resolves")
        .into_parts();
    inline
        .table()
        .style_for_node(target.index())
        .expect("styled")
        .font
        .size
        .get()
}

fn document(css: &str, width: f32, root_font_size: f32) -> StyleDocument {
    StyleDocument::from_source_with_root_font_size(
        source(),
        DOCUMENT_URL,
        viewport(width),
        root_font_size,
        &[StylesheetInput::author(css, DOCUMENT_URL)],
    )
    .expect("document builds")
}

fn source() -> Arc<SourceArena> {
    Arc::new(
        SourceArena::from_xhtml(&format!(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body>{BODY}</body></html>"#
        ))
        .expect("parses"),
    )
}

fn viewport(width: f32) -> Viewport {
    Viewport {
        width,
        height: 800.0,
        ..Viewport::default()
    }
}
