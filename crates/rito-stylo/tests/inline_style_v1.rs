use std::sync::Arc;

use rito_source::{NodeId, SourceArena, SourceNodeKind};
use rito_style_contract::{
    BackgroundImageRepeatV1, BackgroundImageSizeV1, FontFamily, FontFamilyNameSyntax,
    GenericFontFamily, LengthPercentage, RubyAlign, TransformOperationV1,
    RESOLVED_URL_BYTE_LIMIT_V1,
};
use rito_stylo::{
    InlineStyleDispositionV1, InlineStyleFieldV1, InlineStyleProjectionReasonV1, StyleDocument,
    StylesheetInput, Viewport,
};

#[path = "support/inline_style_v1_assertions.rs"]
mod assertions;

const URL: &str = "https://example.test/book/chapter.xhtml";

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

fn target_source() -> Arc<SourceArena> {
    source(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
    )
}

#[test]
fn direct_projection_preserves_represented_computed_distinctions() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        r#"
        #target {
          font-family: "Book Face", sans-serif;
          font-size: 20px;
          font-weight: 650;
          font-style: oblique 12deg;
          line-height: 1.4;
          direction: rtl;
          unicode-bidi: isolate-override;
          writing-mode: vertical-rl;
          text-align: justify;
          text-justify: inter-character;
          text-transform: uppercase full-width full-size-kana;
          white-space-collapse: break-spaces;
          text-wrap-mode: nowrap;
          word-break: keep-all;
          line-break: strict;
          overflow-wrap: anywhere;
          letter-spacing: 1.5px;
          word-spacing: 10%;
          text-indent: 12%;
          margin: 1px 2% 3px auto;
          padding: 4px 5% 6px 7%;
          border: 2px dashed color(display-p3 0.8 0.2 0.1);
          border-right-width: 3px;
          border-right-style: dotted;
          border-right-color: currentcolor;
          border-bottom: 7px none red;
          border-left: 9px hidden blue;
          border-radius: 1px 2px 3px 4px / 5% 6% 7% 8%;
          alignment-baseline: middle;
          baseline-source: last;
          baseline-shift: center;
          color: color(display-p3 0.7 0.3 0.2);
          opacity: 0.25;
          background-color: currentcolor;
          text-decoration: underline wavy currentcolor;
          text-shadow: 1px 2px 3px currentcolor,
            4px 5px 6px color(display-p3 0.1 0.2 0.3);
          box-shadow: inset 2px 3px 4px 5px currentcolor,
            6px 7px 8px 9px color(display-p3 0.2 0.3 0.4);
        }
        "#,
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    let style = projection.table().style_for_node(target.index()).unwrap();
    assert!(projection.is_contract_slice_complete());
    assertions::assert_direct_style(style);
}

#[test]
fn font_family_projection_retains_quoted_and_identifier_syntax() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        r#"#target { font-family: ztitle, "Book Face", "serif", serif; }"#,
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    let families = projection
        .table()
        .style_for_node(target.index())
        .unwrap()
        .font
        .families
        .as_slice();
    assert!(matches!(
        &families[0],
        FontFamily::Named(name)
            if name.as_str() == "ztitle" && name.syntax() == FontFamilyNameSyntax::Identifiers
    ));
    assert!(matches!(
        &families[1],
        FontFamily::Named(name)
            if name.as_str() == "Book Face" && name.syntax() == FontFamilyNameSyntax::Quoted
    ));
    assert!(matches!(
        &families[2],
        FontFamily::Named(name)
            if name.as_str() == "serif" && name.syntax() == FontFamilyNameSyntax::Quoted
    ));
    assert_eq!(families[3], FontFamily::Generic(GenericFontFamily::Serif));
}

#[test]
fn opaque_calc_fails_closed_and_leaves_the_node_slot_empty() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#target { margin-left: calc(1px + 2%) }",
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    assert!(!projection.is_contract_slice_complete());
    assert_eq!(projection.table().node_style_ids()[target.index()], None);
    assert!(projection
        .dispositions()
        .contains(&InlineStyleDispositionV1::ContractRejected {
            node_id: target,
            field: InlineStyleFieldV1::Margin,
            reason: InlineStyleProjectionReasonV1::OpaqueCalc,
        }));
}

#[test]
fn background_url_uses_stylesheet_base_and_projects_coupled_paint() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = StyleDocument::from_source(
        Arc::clone(&source),
        URL,
        Viewport::default(),
        &[StylesheetInput::author(
            r#"
            #target {
              background-image: url(../Images/background.jpg?edition=1#cover);
              background-repeat: no-repeat;
              background-size: cover;
              background-position: top center;
            }
            "#,
            "https://example.test/book/Styles/book.css",
        )],
    )
    .unwrap();

    let projection = document.resolve_inline_styles_v1().unwrap();
    let image = projection
        .table()
        .style_for_node(target.index())
        .unwrap()
        .paint
        .background_image
        .as_ref()
        .unwrap();
    assert_eq!(
        image.url.as_str(),
        "https://example.test/book/Images/background.jpg?edition=1#cover"
    );
    assert_eq!(image.repeat, BackgroundImageRepeatV1::NoRepeat);
    assert_eq!(image.size, BackgroundImageSizeV1::Cover);
    assert_percentage(image.position.x, 50.0);
    assert_percentage(image.position.y, 0.0);
}

#[test]
fn background_url_preserves_the_initial_repeat_value() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#target { background-image: url(background.jpg) }",
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    let image = projection
        .table()
        .style_for_node(target.index())
        .unwrap()
        .paint
        .background_image
        .as_ref()
        .unwrap();

    assert_eq!(image.repeat, BackgroundImageRepeatV1::Repeat);
}

#[test]
fn background_url_supports_auto_contain_and_px_percentage_positions() {
    let source = source(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="auto"/><p id="contain"/></body></html>"#,
    );
    let auto = source.find_element_by_id("auto").unwrap();
    let contain = source.find_element_by_id("contain").unwrap();
    let mut document = document(
        Arc::clone(&source),
        r#"
        #auto {
          background-image: url(auto.jpg);
          background-repeat: no-repeat;
          background-position: 12px 25%;
        }
        #contain {
          background-image: url(contain.jpg);
          background-repeat: no-repeat;
          background-size: contain;
        }
        "#,
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    let auto_image = projection
        .table()
        .style_for_node(auto.index())
        .unwrap()
        .paint
        .background_image
        .as_ref()
        .unwrap();
    assert_eq!(auto_image.size, BackgroundImageSizeV1::Auto);
    assert_length(auto_image.position.x, 12.0);
    assert_percentage(auto_image.position.y, 25.0);
    let contain_image = projection
        .table()
        .style_for_node(contain.index())
        .unwrap()
        .paint
        .background_image
        .as_ref()
        .unwrap();
    assert_eq!(contain_image.size, BackgroundImageSizeV1::Contain);
}

#[test]
fn background_none_bypasses_irrelevant_layer_lists() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        r#"
        #target {
          background-image: none;
          background-repeat: repeat-x;
          background-size: 10px 20px;
          background-position: calc(1px + 2%) 30%;
          background-attachment: fixed;
          background-origin: content-box;
          background-clip: padding-box;
          background-blend-mode: multiply;
        }
        "#,
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    assert_eq!(
        projection
            .table()
            .style_for_node(target.index())
            .unwrap()
            .paint
            .background_image,
        None
    );
}

#[test]
fn unsupported_background_layer_values_fail_closed_by_field() {
    let cases = [
        (
            "background-image: linear-gradient(red, blue); background-repeat: no-repeat",
            InlineStyleFieldV1::BackgroundImage,
            InlineStyleProjectionReasonV1::UnsupportedValue,
        ),
        (
            "background-image: url(a.jpg), url(b.jpg); background-repeat: no-repeat",
            InlineStyleFieldV1::BackgroundImage,
            InlineStyleProjectionReasonV1::UnsupportedValue,
        ),
        (
            "background-image: url(a.jpg); background-repeat: repeat-x",
            InlineStyleFieldV1::BackgroundRepeat,
            InlineStyleProjectionReasonV1::UnsupportedValue,
        ),
        (
            "background-image: url(a.jpg); background-repeat: no-repeat; background-position: calc(1px + 2%) 0",
            InlineStyleFieldV1::BackgroundPosition,
            InlineStyleProjectionReasonV1::OpaqueCalc,
        ),
        (
            "background-image: url(a.jpg); background-repeat: no-repeat; background-attachment: fixed",
            InlineStyleFieldV1::BackgroundAttachment,
            InlineStyleProjectionReasonV1::UnsupportedValue,
        ),
        (
            "background-image: url(a.jpg); background-repeat: no-repeat; background-origin: content-box",
            InlineStyleFieldV1::BackgroundOrigin,
            InlineStyleProjectionReasonV1::UnsupportedValue,
        ),
        (
            "background-image: url(a.jpg); background-repeat: no-repeat; background-clip: padding-box",
            InlineStyleFieldV1::BackgroundClip,
            InlineStyleProjectionReasonV1::UnsupportedValue,
        ),
        (
            "background-image: url(a.jpg); background-repeat: no-repeat; background-blend-mode: multiply",
            InlineStyleFieldV1::BackgroundBlendMode,
            InlineStyleProjectionReasonV1::UnsupportedValue,
        ),
    ];

    for (declarations, field, reason) in cases {
        assert_background_rejected(declarations, field, reason);
    }
}

#[test]
fn oversized_resolved_background_url_hits_the_payload_budget() {
    let path = "x".repeat(RESOLVED_URL_BYTE_LIMIT_V1);
    assert_background_rejected(
        &format!(
            "background-image: url(https://example.test/{path}); background-repeat: no-repeat"
        ),
        InlineStyleFieldV1::BackgroundImage,
        InlineStyleProjectionReasonV1::ProjectionBudgetExceeded,
    );
}

#[test]
fn rotate_and_rotate_z_project_as_equivalent_ordered_2d_operations() {
    let source = source(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="rotate"/><p id="rotate-z"/><p id="ordered"/></body></html>"#,
    );
    let rotate = source.find_element_by_id("rotate").unwrap();
    let rotate_z = source.find_element_by_id("rotate-z").unwrap();
    let ordered = source.find_element_by_id("ordered").unwrap();
    let mut document = document(
        Arc::clone(&source),
        r#"
        #rotate {
          transform: rotate(90deg);
          transform-origin: center center;
          rotate: none;
          scale: none;
          translate: none;
        }
        #rotate-z { transform: rotateZ(-0.25turn) }
        #ordered { transform: rotate(10deg) rotateZ(0.5rad) }
        "#,
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    assert_close(
        transform_radians(&projection, rotate)[0],
        std::f32::consts::FRAC_PI_2,
    );
    assert_close(
        transform_radians(&projection, rotate_z)[0],
        -std::f32::consts::FRAC_PI_2,
    );
    let ordered_radians = transform_radians(&projection, ordered);
    assert_eq!(ordered_radians.len(), 2);
    assert_close(ordered_radians[0], 10.0_f32.to_radians());
    assert_close(ordered_radians[1], 0.5);
}

#[test]
fn unsupported_standard_transform_operations_fail_closed() {
    for declaration in [
        "transform: matrix(1, 0, 0, 1, 0, 0)",
        "transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
        "transform: skew(10deg)",
        "transform: rotateX(10deg)",
        "transform: rotate3d(0, 0, 1, 10deg)",
        "transform: translate(10px)",
        "transform: translate3d(1px, 2px, 3px)",
        "transform: scale(2)",
        "transform: scale3d(1, 1, 1)",
        "transform: perspective(10px)",
    ] {
        assert_declarations_rejected(
            declaration,
            InlineStyleFieldV1::Transform,
            InlineStyleProjectionReasonV1::UnsupportedValue,
        );
    }
}

#[test]
fn individual_transform_longhands_fail_closed() {
    for (declaration, field) in [
        ("rotate: 10deg", InlineStyleFieldV1::IndividualRotate),
        ("scale: 2", InlineStyleFieldV1::IndividualScale),
        ("translate: 10px", InlineStyleFieldV1::IndividualTranslate),
    ] {
        assert_declarations_rejected(
            declaration,
            field,
            InlineStyleProjectionReasonV1::UnsupportedValue,
        );
    }
}

#[test]
fn non_default_transform_origin_fails_closed() {
    assert_declarations_rejected(
        "transform: rotate(10deg); transform-origin: left top",
        InlineStyleFieldV1::TransformOrigin,
        InlineStyleProjectionReasonV1::UnsupportedValue,
    );
}

#[test]
fn hostile_transform_list_hits_the_operation_budget() {
    let operations = std::iter::repeat_n(
        "rotate(1deg)",
        rito_style_contract::INLINE_STYLE_LIST_ITEM_LIMIT_V1 + 1,
    )
    .collect::<Vec<_>>()
    .join(" ");
    assert_declarations_rejected(
        &format!("transform: {operations}"),
        InlineStyleFieldV1::Transform,
        InlineStyleProjectionReasonV1::ProjectionBudgetExceeded,
    );
}

#[test]
fn decoration_is_own_computed_value_not_a_source_ancestor_stack() {
    let source = source(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="parent"><span id="child">text</span></div></body></html>"#,
    );
    let parent = source.find_element_by_id("parent").unwrap();
    let child = source.find_element_by_id("child").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#parent { text-decoration: underline dashed red }",
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    let parent_style = projection.table().style_for_node(parent.index()).unwrap();
    let child_style = projection.table().style_for_node(child.index()).unwrap();
    assert!(parent_style.paint.text_decoration.lines.underline);
    assert!(child_style.paint.text_decoration.lines.is_empty());
}

#[test]
fn language_is_case_canonicalized_with_xml_precedence_and_empty_reset() {
    let source = source(
        r#"<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="JA"><body><div lang="EN-US"><span id="inherited"/><span lang=""><b id="reset"/></span><i id="precedence" xml:lang="FR" lang="de"/></div></body></html>"#,
    );
    let inherited = source.find_element_by_id("inherited").unwrap();
    let reset = source.find_element_by_id("reset").unwrap();
    let precedence = source.find_element_by_id("precedence").unwrap();
    let mut document = document(Arc::clone(&source), "");

    let projection = document.resolve_inline_styles_v1().unwrap();
    assert_eq!(language(&projection, inherited), Some("en-us"));
    assert_eq!(language(&projection, reset), None);
    assert_eq!(language(&projection, precedence), Some("fr"));
}

#[test]
fn ruby_align_cascades_through_the_registered_custom_property() {
    let source = source(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><ruby id="ruby">base<rt id="rt">note</rt></ruby><ruby id="plain">b<rt id="plain-rt">n</rt></ruby></body></html>"#,
    );
    let ruby = source.find_element_by_id("ruby").unwrap();
    let rt = source.find_element_by_id("rt").unwrap();
    let plain_rt = source.find_element_by_id("plain-rt").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#ruby { ruby-align: center } rt { ruby-align: inter-character }",
    );

    let projection = document.resolve_inline_styles_v1().unwrap();
    assert_eq!(ruby_align(&projection, ruby), RubyAlign::Center);
    // The invalid rt declaration drops at parse time like the browser
    // drops it; rt keeps the inherited value from its ruby container.
    assert_eq!(ruby_align(&projection, rt), RubyAlign::Center);
    assert_eq!(ruby_align(&projection, plain_rt), RubyAlign::SpaceAround);
}

fn ruby_align(projection: &rito_stylo::InlineStyleProjectionV1, node_id: NodeId) -> RubyAlign {
    projection
        .table()
        .style_for_node(node_id.index())
        .unwrap()
        .text_flow
        .ruby_align
}

fn language(projection: &rito_stylo::InlineStyleProjectionV1, node_id: NodeId) -> Option<&str> {
    projection
        .table()
        .style_for_node(node_id.index())
        .unwrap()
        .text_flow
        .language
        .as_ref()
        .map(|tag| tag.as_str())
}

fn assert_background_rejected(
    declarations: &str,
    field: InlineStyleFieldV1,
    reason: InlineStyleProjectionReasonV1,
) {
    assert_declarations_rejected(declarations, field, reason);
}

fn assert_declarations_rejected(
    declarations: &str,
    field: InlineStyleFieldV1,
    reason: InlineStyleProjectionReasonV1,
) {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(source, &format!("#target {{ {declarations} }}"));
    let projection = document.resolve_inline_styles_v1().unwrap();
    assert!(projection
        .dispositions()
        .contains(&InlineStyleDispositionV1::ContractRejected {
            node_id: target,
            field,
            reason,
        }));
}

fn transform_radians(
    projection: &rito_stylo::InlineStyleProjectionV1,
    node_id: NodeId,
) -> Vec<f32> {
    projection
        .table()
        .style_for_node(node_id.index())
        .unwrap()
        .paint
        .transform
        .as_slice()
        .iter()
        .map(|operation| match operation {
            TransformOperationV1::Rotate { radians } => radians.get(),
        })
        .collect()
}

fn assert_close(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() <= 1.0e-6,
        "{actual} != {expected}"
    );
}

fn assert_length(value: LengthPercentage, expected: f32) {
    assert!(matches!(
        value,
        LengthPercentage::Length(length) if length.get() == expected
    ));
}

fn assert_percentage(value: LengthPercentage, expected: f32) {
    assert!(matches!(
        value,
        LengthPercentage::Percentage(percentage) if percentage.percent() == expected
    ));
}

#[test]
fn disposition_ledger_exactly_accounts_for_the_dense_source_arena() {
    let source = source(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body>before<p id="target">text</p>after</body></html>"#,
    );
    let mut document = document(
        Arc::clone(&source),
        "#target { margin-left: calc(1px + 2%) }",
    );
    let projection = document.resolve_inline_styles_v1().unwrap();
    let element_ids = source
        .iter()
        .filter_map(|(id, node)| matches!(node.kind, SourceNodeKind::Element(_)).then_some(id))
        .collect::<Vec<_>>();
    let disposition_ids = projection
        .dispositions()
        .iter()
        .map(disposition_node_id)
        .collect::<Vec<_>>();

    assert_eq!(projection.table().node_count(), source.len());
    assert_eq!(disposition_ids, element_ids);
    assert!(disposition_ids.windows(2).all(|ids| ids[0] < ids[1]));
    for (node_id, node) in source.iter() {
        let slot = projection.table().node_style_ids()[node_id.index()];
        if !matches!(node.kind, SourceNodeKind::Element(_)) {
            assert_eq!(slot, None);
            continue;
        }
        let disposition = projection
            .dispositions()
            .iter()
            .find(|item| disposition_node_id(item) == node_id)
            .unwrap();
        match disposition {
            InlineStyleDispositionV1::ContractProjected { style_id, .. } => {
                assert_eq!(slot, Some(*style_id));
            }
            InlineStyleDispositionV1::ContractRejected { .. } => assert_eq!(slot, None),
        }
    }
}

fn disposition_node_id(disposition: &InlineStyleDispositionV1) -> NodeId {
    match disposition {
        InlineStyleDispositionV1::ContractProjected { node_id, .. }
        | InlineStyleDispositionV1::ContractRejected { node_id, .. } => *node_id,
    }
}
