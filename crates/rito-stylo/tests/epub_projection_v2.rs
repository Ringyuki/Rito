use std::sync::Arc;

use rito_source::SourceArena;
use rito_stylo::{
    BoxSizingV2, ComputedDisplayV1, ComputedLineHeightV1, DirectionV2, DisplayInsideV1,
    DisplayOutsideV1, FontStyleV2, LineBreakV2, OverflowWrapV2, StyleDocument, StylesheetInput,
    TextAlignV2, TextJustifyV2, TextTransformCaseV2, TextTransformV2, TextWrapModeV2,
    UnicodeBidiV2, Viewport, WhiteSpaceCollapseV2, WordBreakV2, WritingModeV2,
};

const URL: &str = "https://example.test/book/chapter.xhtml";

fn source(xhtml: &str) -> Arc<SourceArena> {
    Arc::new(SourceArena::from_xhtml(xhtml).expect("valid XHTML"))
}

fn display(
    outside: DisplayOutsideV1,
    inside: DisplayInsideV1,
    is_list_item: bool,
) -> ComputedDisplayV1 {
    ComputedDisplayV1 {
        outside,
        inside,
        is_list_item,
    }
}

#[test]
fn epub_ua_supplies_html_box_generation_semantics() {
    let mut document = StyleDocument::from_epub_source(
        source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml">
                <head id="head"><title>Hidden</title></head>
                <body>
                  <article id="article"><span id="span">Inline</span></article>
                  <ol><li id="item">Item</li></ol>
                  <table id="table"><tbody><tr><td id="cell">Cell</td></tr></tbody></table>
                  <dialog id="closed-dialog">Closed</dialog>
                  <dialog id="open-dialog" open="open">Open</dialog>
                  <details>
                    <summary id="summary">Summary</summary>
                    <summary id="second-summary">Second summary</summary>
                  </details>
                  <svg xmlns="http://www.w3.org/2000/svg"><g id="svg-hidden" hidden="hidden" /></svg>
                </body>
              </html>"#,
        ),
        URL,
        Viewport::default(),
        &[],
    )
    .expect("style document");

    let resolved = document.resolve_v2().expect("resolved styles");
    assert_eq!(
        resolved.element_by_id("article").expect("article").display,
        display(DisplayOutsideV1::Block, DisplayInsideV1::Flow, false)
    );
    assert_eq!(
        resolved.element_by_id("span").expect("span").display,
        display(DisplayOutsideV1::Inline, DisplayInsideV1::Flow, false)
    );
    assert_eq!(
        resolved.element_by_id("item").expect("list item").display,
        display(DisplayOutsideV1::Block, DisplayInsideV1::Flow, true)
    );
    assert_eq!(
        resolved.element_by_id("table").expect("table").display,
        display(DisplayOutsideV1::Block, DisplayInsideV1::Table, false)
    );
    assert_eq!(
        resolved.element_by_id("cell").expect("table cell").display,
        display(
            DisplayOutsideV1::InternalTable,
            DisplayInsideV1::TableCell,
            false,
        )
    );
    assert_eq!(
        resolved.element_by_id("head").expect("head").display,
        display(DisplayOutsideV1::None, DisplayInsideV1::None, false)
    );
    assert_eq!(
        resolved
            .element_by_id("closed-dialog")
            .expect("closed dialog")
            .display,
        display(DisplayOutsideV1::None, DisplayInsideV1::None, false)
    );
    assert_eq!(
        resolved
            .element_by_id("open-dialog")
            .expect("open dialog")
            .display,
        display(DisplayOutsideV1::Block, DisplayInsideV1::Flow, false)
    );
    assert_eq!(
        resolved.element_by_id("summary").expect("summary").display,
        display(DisplayOutsideV1::Block, DisplayInsideV1::Flow, true)
    );
    assert_eq!(
        resolved
            .element_by_id("second-summary")
            .expect("second summary")
            .display,
        display(DisplayOutsideV1::Block, DisplayInsideV1::Flow, false)
    );
    assert_eq!(
        resolved
            .element_by_id("svg-hidden")
            .expect("SVG hidden attribute")
            .display,
        display(DisplayOutsideV1::Inline, DisplayInsideV1::Flow, false)
    );
}

#[test]
fn author_display_overrides_epub_ua_origin() {
    let mut document = StyleDocument::from_epub_source(
        source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target" hidden="hidden">Text</p></body></html>"#,
        ),
        URL,
        Viewport::default(),
        &[StylesheetInput::author(
            "p[hidden] { display: inline }",
            URL,
        )],
    )
    .expect("style document");

    let target = document
        .resolve_v2()
        .expect("resolved styles")
        .element_by_id("target")
        .expect("target")
        .clone();
    assert_eq!(
        target.display,
        display(DisplayOutsideV1::Inline, DisplayInsideV1::Flow, false)
    );
}

#[test]
fn html_dir_is_an_inherited_zero_specificity_presentational_hint() {
    let mut document = StyleDocument::from_epub_source(
        source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body>
              <section dir="RTL"><p id="inherited">Inherited</p></section>
              <p id="overridden" dir="rtl">Overridden</p>
              <bdi id="bdi">BiDi isolate</bdi>
              <bdo id="bdo" dir="ltr">BiDi override</bdo>
              <span id="embed">Embed</span>
              <span id="bidi-override">Override</span>
              <svg xmlns="http://www.w3.org/2000/svg" dir="rtl"><text id="svg">SVG</text></svg>
            </body></html>"#,
        ),
        URL,
        Viewport::default(),
        &[StylesheetInput::author(
            "#overridden { direction: ltr; unicode-bidi: normal } #embed { unicode-bidi: embed } #bidi-override { unicode-bidi: bidi-override }",
            URL,
        )],
    )
    .expect("style document");

    let resolved = document.resolve_v2().expect("resolved styles");
    assert_eq!(
        resolved
            .element_by_id("inherited")
            .expect("inherited")
            .direction,
        DirectionV2::RightToLeft
    );
    assert_eq!(
        resolved
            .element_by_id("overridden")
            .expect("overridden")
            .direction,
        DirectionV2::LeftToRight
    );
    assert_eq!(
        resolved
            .element_by_id("inherited")
            .expect("inherited")
            .unicode_bidi,
        UnicodeBidiV2::Isolate
    );
    assert_eq!(
        resolved
            .element_by_id("overridden")
            .expect("overridden")
            .unicode_bidi,
        UnicodeBidiV2::Normal
    );
    assert_eq!(
        resolved.element_by_id("bdi").expect("bdi").unicode_bidi,
        UnicodeBidiV2::Isolate
    );
    assert_eq!(
        resolved.element_by_id("bdo").expect("bdo").unicode_bidi,
        UnicodeBidiV2::IsolateOverride
    );
    assert_eq!(
        resolved
            .element_by_id("embed")
            .expect("unicode-bidi embed")
            .unicode_bidi,
        UnicodeBidiV2::Embed
    );
    assert_eq!(
        resolved
            .element_by_id("bidi-override")
            .expect("unicode-bidi bidi-override")
            .unicode_bidi,
        UnicodeBidiV2::BidiOverride
    );
    assert_eq!(
        resolved
            .element_by_id("svg")
            .expect("SVG element")
            .direction,
        DirectionV2::LeftToRight
    );
}

#[test]
fn v2_preserves_writing_and_lossless_box_paint_fields() {
    let mut document = StyleDocument::from_epub_source(
        source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">Text</p></body></html>"#,
        ),
        URL,
        Viewport::default(),
        &[StylesheetInput::author(
            r#"#target {
              color: rgb(10 20 30 / 50%);
              opacity: 0.4;
              box-sizing: border-box;
              margin-left: auto;
              margin-right: 12px;
              font-style: oblique -12.5deg;
              direction: rtl;
              unicode-bidi: plaintext;
              writing-mode: vertical-rl;
              text-align: end;
              text-justify: inter-character;
              text-transform: uppercase full-width full-size-kana;
              white-space: pre-line;
              word-break: keep-all;
              line-break: strict;
              overflow-wrap: anywhere;
              line-height: normal;
            }"#,
            URL,
        )],
    )
    .expect("style document");

    let target = document
        .resolve_v2()
        .expect("resolved styles")
        .element_by_id("target")
        .expect("target")
        .clone();
    assert!((target.color.red - 10.0 / 255.0).abs() < 0.0001);
    assert!((target.color.green - 20.0 / 255.0).abs() < 0.0001);
    assert!((target.color.blue - 30.0 / 255.0).abs() < 0.0001);
    assert!((target.color.alpha - 0.5).abs() < 0.0001);
    assert!((target.opacity - 0.4).abs() < 0.0001);
    assert_eq!(target.box_sizing, BoxSizingV2::BorderBox);
    assert!(target.margin_left_auto);
    assert!(!target.margin_right_auto);
    assert_eq!(target.direction, DirectionV2::RightToLeft);
    assert_eq!(target.unicode_bidi, UnicodeBidiV2::Plaintext);
    assert_eq!(target.writing_mode, WritingModeV2::VerticalRightToLeft);
    assert_eq!(target.text_align, TextAlignV2::End);
    assert_eq!(target.text_justify, TextJustifyV2::InterCharacter);
    assert!(matches!(
        target.font_style,
        FontStyleV2::ObliqueDegrees(angle) if (angle + 12.5).abs() < 0.01
    ));
    assert_eq!(
        target.text_transform,
        TextTransformV2 {
            case: TextTransformCaseV2::Uppercase,
            full_width: true,
            full_size_kana: true,
        }
    );
    assert_eq!(
        target.white_space_collapse,
        WhiteSpaceCollapseV2::PreserveBreaks
    );
    assert_eq!(target.text_wrap_mode, TextWrapModeV2::Wrap);
    assert_eq!(target.word_break, WordBreakV2::KeepAll);
    assert_eq!(target.line_break, LineBreakV2::Strict);
    assert_eq!(target.overflow_wrap, OverflowWrapV2::Anywhere);
    assert_eq!(target.line_height, ComputedLineHeightV1::Normal);
}
