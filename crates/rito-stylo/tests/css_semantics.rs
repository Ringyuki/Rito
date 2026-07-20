use std::sync::Arc;

use rito_source::SourceArena;
use rito_stylo::{ColorScheme, StyleDocument, StyleOrigin, StylesheetInput, Viewport};

const DOCUMENT_URL: &str = "https://example.test/book/chapter.xhtml";

struct CssCase {
    name: &'static str,
    body: &'static str,
    css: &'static str,
    expected_font_size_px: f32,
    viewport: Viewport,
}

impl CssCase {
    fn new(
        name: &'static str,
        body: &'static str,
        css: &'static str,
        expected_font_size_px: f32,
    ) -> Self {
        Self {
            name,
            body,
            css,
            expected_font_size_px,
            viewport: Viewport::default(),
        }
    }

    fn viewport(mut self, viewport: Viewport) -> Self {
        self.viewport = viewport;
        self
    }
}

#[test]
fn direct_adapter_matches_selector_cascade_and_value_semantics() {
    let cases = vec![
        CssCase::new(
            "type selector",
            r#"<p id="target">x</p>"#,
            "p { font-size: 17px }",
            17.0,
        ),
        CssCase::new(
            "id specificity",
            r#"<p id="target" class="alpha">x</p>"#,
            ".alpha { font-size: 17px } #target { font-size: 18px }",
            18.0,
        ),
        CssCase::new(
            "xml id selector",
            r#"<p xml:id="target">x</p>"#,
            "#target { font-size: 18.5px }",
            18.5,
        ),
        CssCase::new(
            "class tokenization",
            r#"<p id="target" class="alpha beta gamma">x</p>"#,
            ".beta { font-size: 19px }",
            19.0,
        ),
        CssCase::new(
            "source order",
            r#"<p id="target" class="alpha">x</p>"#,
            ".alpha { font-size: 17px } .alpha { font-size: 20px }",
            20.0,
        ),
        CssCase::new(
            "descendant combinator",
            r#"<section><div><p id="target">x</p></div></section>"#,
            "section #target { font-size: 21px }",
            21.0,
        ),
        CssCase::new(
            "child combinator",
            r#"<section><p id="target">x</p></section>"#,
            "section > #target { font-size: 22px }",
            22.0,
        ),
        CssCase::new(
            "adjacent sibling combinator",
            r#"<section><h1>h</h1><p id="target">x</p></section>"#,
            "h1 + #target { font-size: 23px }",
            23.0,
        ),
        CssCase::new(
            "general sibling combinator",
            r#"<section><h1>h</h1><i>i</i><p id="target">x</p></section>"#,
            "h1 ~ #target { font-size: 24px }",
            24.0,
        ),
        CssCase::new(
            "first child",
            r#"<section><p id="target">x</p><p>y</p></section>"#,
            "#target:first-child { font-size: 25px }",
            25.0,
        ),
        CssCase::new(
            "last child",
            r#"<section><p>x</p><p id="target">y</p></section>"#,
            "#target:last-child { font-size: 26px }",
            26.0,
        ),
        CssCase::new(
            "nth child",
            r#"<section><i>x</i><p id="target">y</p><b>z</b></section>"#,
            "#target:nth-child(2) { font-size: 27px }",
            27.0,
        ),
        CssCase::new(
            "nth of type",
            r#"<section><p>x</p><i>i</i><p id="target">y</p></section>"#,
            "#target:nth-of-type(2) { font-size: 28px }",
            28.0,
        ),
        CssCase::new(
            "empty ignores comments",
            r#"<p id="target"><!-- comment --></p>"#,
            "#target:empty { font-size: 29px }",
            29.0,
        ),
        CssCase::new(
            "empty observes whitespace text",
            r#"<p id="target"> </p>"#,
            "#target:empty { font-size: 99px }",
            16.0,
        ),
        CssCase::new(
            "not pseudo",
            r#"<p id="target" class="alpha">x</p>"#,
            "#target:not(.other) { font-size: 30px }",
            30.0,
        ),
        CssCase::new(
            "is pseudo",
            r#"<p id="target" class="alpha">x</p>"#,
            "#target:is(.alpha, .other) { font-size: 31px }",
            31.0,
        ),
        CssCase::new(
            "where pseudo",
            r#"<p id="target" class="alpha">x</p>"#,
            "#target:where(.alpha) { font-size: 32px }",
            32.0,
        ),
        CssCase::new(
            "attribute exact match",
            r#"<p id="target" data-role="note">x</p>"#,
            r#"[data-role="note"] { font-size: 33px }"#,
            33.0,
        ),
        CssCase::new(
            "attribute token match",
            r#"<p id="target" data-tags="alpha beta gamma">x</p>"#,
            r#"[data-tags~="beta"] { font-size: 34px }"#,
            34.0,
        ),
        CssCase::new(
            "attribute ASCII insensitive match",
            r#"<p id="target" data-role="NOTE">x</p>"#,
            r#"[data-role="note" i] { font-size: 35px }"#,
            35.0,
        ),
        CssCase::new(
            "namespaced EPUB attribute",
            r#"<p id="target" epub:type="note">x</p>"#,
            r#"@namespace epub "http://www.idpf.org/2007/ops"; [epub|type="note"] { font-size: 36px }"#,
            36.0,
        ),
        CssCase::new(
            "namespaced SVG type",
            r#"<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="target"/></svg>"#,
            r#"@namespace svg "http://www.w3.org/2000/svg"; svg|linearGradient { font-size: 37px }"#,
            37.0,
        ),
        CssCase::new(
            "inherited xml language",
            r#"<section xml:lang="ja-JP"><p id="target">x</p></section>"#,
            "#target:lang(ja) { font-size: 38px }",
            38.0,
        ),
        CssCase::new(
            "media viewport",
            r#"<p id="target">x</p>"#,
            "@media screen and (min-width: 700px) { #target { font-size: 39px } }",
            39.0,
        ),
        CssCase::new(
            "dark color scheme media",
            r#"<p id="target">x</p>"#,
            "@media (prefers-color-scheme: dark) { #target { font-size: 40px } }",
            40.0,
        )
        .viewport(Viewport {
            color_scheme: ColorScheme::Dark,
            ..Viewport::default()
        }),
        CssCase::new(
            "custom property",
            r#"<p id="target">x</p>"#,
            ":root { --marker-size: 41px } #target { font-size: var(--marker-size) }",
            41.0,
        ),
        CssCase::new(
            "calc value",
            r#"<p id="target">x</p>"#,
            "#target { font-size: calc(20px + 22px) }",
            42.0,
        ),
        CssCase::new(
            "root relative unit",
            r#"<p id="target">x</p>"#,
            "html { font-size: 10px } #target { font-size: 4.3rem }",
            43.0,
        ),
        CssCase::new(
            "property inheritance",
            r#"<section><p id="target">x</p></section>"#,
            "section { font-size: 44px }",
            44.0,
        ),
        CssCase::new(
            "author important beats inline normal",
            r#"<p id="target" style="font-size: 12px">x</p>"#,
            "#target { font-size: 45px !important }",
            45.0,
        ),
        CssCase::new(
            "cascade layer ordering",
            r#"<p id="target">x</p>"#,
            "@layer base { #target { font-size: 12px } } #target { font-size: 47px }",
            47.0,
        ),
    ];

    let failures = cases.iter().filter_map(run_case).collect::<Vec<_>>();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn records_upstream_servo_has_selector_gap() {
    let case = CssCase::new(
        "relational has pseudo",
        r#"<section><span>marker</span><p id="target">x</p></section>"#,
        "section:has(> span) > #target { font-size: 46px }",
        16.0,
    );
    assert_eq!(run_case(&case), None);
    // Stylo 0.19's Servo SelectorParser hard-codes parse_has() to false.
    // Keep this test executable so an upstream capability change forces us to
    // move :has() into the conformance matrix instead of silently overlooking it.
}

#[test]
fn records_upstream_servo_nth_child_of_selector_gap() {
    let case = CssCase::new(
        "nth child of selector",
        r#"<section><p class="item">a</p><i>x</i><p id="target" class="item">b</p></section>"#,
        "#target:nth-child(2 of .item) { font-size: 48px }",
        16.0,
    );
    assert_eq!(run_case(&case), None);
    // Stylo 0.19's Servo SelectorParser also hard-codes
    // parse_nth_child_of() to false.
}

#[test]
fn respects_normal_and_important_cascade_origin_order() {
    let xhtml =
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">x</p></body></html>"#;
    let sheets = [
        StylesheetInput::new(
            "#target { font-size: 20px }",
            DOCUMENT_URL,
            StyleOrigin::UserAgent,
        ),
        StylesheetInput::new(
            "#target { font-size: 21px }",
            DOCUMENT_URL,
            StyleOrigin::User,
        ),
        StylesheetInput::author("#target { font-size: 22px }", DOCUMENT_URL),
    ];
    let mut normal =
        StyleDocument::from_source(source(xhtml), DOCUMENT_URL, Viewport::default(), &sheets)
            .unwrap();
    assert_eq!(
        normal
            .resolve()
            .unwrap()
            .element_by_id("target")
            .unwrap()
            .font_size_px,
        22.0
    );

    let important_sheets = [
        StylesheetInput::new(
            "#target { font-size: 25px !important }",
            DOCUMENT_URL,
            StyleOrigin::UserAgent,
        ),
        StylesheetInput::new(
            "#target { font-size: 24px !important }",
            DOCUMENT_URL,
            StyleOrigin::User,
        ),
        StylesheetInput::author("#target { font-size: 23px !important }", DOCUMENT_URL),
    ];
    let mut important = StyleDocument::from_source(
        source(xhtml),
        DOCUMENT_URL,
        Viewport::default(),
        &important_sheets,
    )
    .unwrap();
    assert_eq!(
        important
            .resolve()
            .unwrap()
            .element_by_id("target")
            .unwrap()
            .font_size_px,
        25.0
    );
}

fn run_case(case: &CssCase) -> Option<String> {
    let xhtml = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>{}</body></html>"#,
        case.body
    );
    let mut document = StyleDocument::from_source(
        source(&xhtml),
        DOCUMENT_URL,
        case.viewport,
        &[StylesheetInput::author(case.css, DOCUMENT_URL)],
    )
    .unwrap_or_else(|error| panic!("{}: {error}", case.name));
    let resolved = document
        .resolve()
        .unwrap_or_else(|error| panic!("{}: {error}", case.name));
    let actual = resolved
        .element_by_id("target")
        .unwrap_or_else(|| panic!("{}: target was not projected", case.name))
        .font_size_px;
    (actual != case.expected_font_size_px).then(|| {
        format!(
            "{}: expected {}px, got {}px",
            case.name, case.expected_font_size_px, actual
        )
    })
}

fn source(xhtml: &str) -> Arc<SourceArena> {
    Arc::new(SourceArena::from_xhtml(xhtml).unwrap())
}
