use super::super::{LayoutTextPoint, LayoutTextSelectionGranularity};
use super::helpers::*;

#[test]
fn word_granularity_matches_chromium_oracles_across_scripts() {
    for (text, hit_offset, expected) in [
        ("alpha,beta", 2, "alpha"),
        ("alpha,beta", 5, ","),
        ("alpha  beta", 5, "  "),
        ("triple", 3, "triple"),
        ("don't", 2, "don't"),
        ("foo_bar", 3, "foo_bar"),
        ("中文测试", 0, "中文"),
        ("中文测试", 2, "测试"),
        ("こんにちは世界", 1, "こんにちは"),
        ("こんにちは世界", 5, "世界"),
        ("ภาษาไทยภาษาไทย", 0, "ภาษา"),
        ("ภาษาไทยภาษาไทย", 4, "ไทย"),
    ] {
        assert_eq!(
            selected_word(text, hit_offset),
            expected,
            "oracle for {text:?}"
        );
    }
}

#[test]
fn raw_hit_cluster_chooses_the_word_instead_of_the_nearest_caret() {
    let flow = exact_flow("a b");
    let page = one_flow_page(
        0,
        &flow,
        "a b",
        exact_shape(&[(0, 1, 10.0), (1, 2, 10.0), (2, 3, 100.0)]),
    );
    let point = LayoutTextPoint {
        page_index: 0,
        x: 32.0,
        y: 30.0,
    };
    let resolved = resolved(&[page], point, point, LayoutTextSelectionGranularity::Word);

    assert_eq!(resolved.range.selected_text, "b");
    assert_eq!(resolved.anchor_caret.source_point.text_offset, 2);
    assert_eq!(resolved.focus_caret.source_point.text_offset, 3);
}

#[test]
fn package_language_tailors_words_and_invalid_metadata_falls_back() {
    let flow = exact_flow("EU:ssa");
    let page = one_flow_page(0, &flow, "EU:ssa", uniform_shape(6));
    let colon = point(0, 35.0, 30.0);
    let invariant = resolved_with_language(
        std::slice::from_ref(&page),
        colon,
        colon,
        LayoutTextSelectionGranularity::Word,
        None,
    );
    assert_eq!(invariant.range.selected_text, ":");

    let finnish = resolved_with_language(
        std::slice::from_ref(&page),
        colon,
        colon,
        LayoutTextSelectionGranularity::Word,
        Some("fi"),
    );
    assert_eq!(finnish.range.selected_text, "EU:ssa");

    let invalid = resolved_with_language(
        &[page],
        colon,
        colon,
        LayoutTextSelectionGranularity::Word,
        Some("not a language tag !!!"),
    );
    assert_eq!(invalid.range.selected_text, ":");
}

#[test]
fn same_word_seed_and_cross_word_drag_expand_to_complete_units() {
    let flow = exact_flow("alpha beta");
    let page = one_flow_page(0, &flow, "alpha beta", uniform_shape(10));
    let same = resolved(
        std::slice::from_ref(&page),
        point(0, 25.0, 30.0),
        point(0, 45.0, 30.0),
        LayoutTextSelectionGranularity::Word,
    );
    assert_eq!(same.range.selected_text, "alpha");
    assert_eq!(same.anchor_caret.address.char_index, 0);
    assert_eq!(same.focus_caret.address.char_index, 5);
    assert_eq!(same.anchor_caret.geometry.x, 10.0);
    assert_eq!(same.focus_caret.geometry.x, 60.0);

    let forward = resolved(
        std::slice::from_ref(&page),
        point(0, 25.0, 30.0),
        point(0, 85.0, 30.0),
        LayoutTextSelectionGranularity::Word,
    );
    assert_eq!(forward.range.selected_text, "alpha beta");
    assert_eq!(forward.anchor_caret.address.char_index, 0);
    assert_eq!(forward.focus_caret.address.char_index, 10);
    assert_eq!(forward.range.anchor, forward.anchor_caret.address);
    assert_eq!(forward.range.focus, forward.focus_caret.address);

    let reverse = resolved(
        &[page],
        point(0, 85.0, 30.0),
        point(0, 25.0, 30.0),
        LayoutTextSelectionGranularity::Word,
    );
    assert_eq!(reverse.range.selected_text, "alpha beta");
    assert_eq!(reverse.anchor_caret.address.char_index, 10);
    assert_eq!(reverse.focus_caret.address.char_index, 0);
    assert_eq!(reverse.range.anchor, reverse.anchor_caret.address);
    assert_eq!(reverse.range.focus, reverse.focus_caret.address);
}
