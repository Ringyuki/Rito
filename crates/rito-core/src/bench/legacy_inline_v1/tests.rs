use rito_source::SourceNodeKind;
use rito_style_contract::{NumericError, INLINE_STYLE_LIST_ITEM_LIMIT_V1};
use serde_json::{Map, Value};

use super::{
    LegacyInlineEvidenceV1 as Evidence, LegacyInlineFieldDispositionV1 as Disposition,
    LegacyInlineFieldReasonV1 as Reason, LegacyInlineFieldV1 as Field,
};
use crate::bench::PreparedLegacyStyle;

fn fixture(body: &str) -> PreparedLegacyStyle {
    PreparedLegacyStyle::compile(
        &format!(r#"<html xmlns="http://www.w3.org/1999/xhtml"><body>{body}</body></html>"#),
        &[],
        800.0,
        600.0,
    )
    .expect("fixture XHTML parses")
}

#[test]
fn ledger_accounts_for_each_source_element_without_fabricating_a_style() {
    let prepared = fixture(
        r##"<p id="target" style="font-size:20px;font-weight:650;text-justify:inter-word;word-break:keep-all;color:#123;opacity:.25;padding:2px;border:1px dashed #456;text-shadow:1px 2px 3px #789">text</p>"##,
    );
    let target = prepared
        .source_arena
        .find_element_by_id("target")
        .expect("target source id");
    let element_ids = prepared
        .source_arena
        .iter()
        .filter_map(|(id, node)| matches!(node.kind, SourceNodeKind::Element(_)).then_some(id))
        .collect::<Vec<_>>();
    let resolved = prepared.resolve();
    let projection = prepared.project_inline_styles_v1(&resolved);
    let disposition_ids = projection
        .dispositions()
        .iter()
        .map(|entry| entry.node_id)
        .collect::<Vec<_>>();

    assert_eq!(projection.table().node_count(), prepared.source_arena.len());
    assert_eq!(projection.table().style_count(), 0);
    assert_eq!(disposition_ids, element_ids);
    assert!(!projection.is_contract_slice_complete());
    assert!(projection
        .table()
        .node_style_ids()
        .iter()
        .all(Option::is_none));
    let debug = format!("{projection:?}");
    assert!(debug.contains("disposition_count"));
    assert!(!debug.contains("node_id"));

    let target_entry = projection
        .dispositions()
        .iter()
        .find(|entry| entry.node_id == target)
        .expect("target ledger entry");
    assert_eq!(target_entry.fields().len(), Field::ALL.len());
    assert_eq!(
        target_entry.field(Field::FontSize).disposition,
        Disposition::Exact
    );
    assert_eq!(
        target_entry.field(Field::FontWeight).disposition,
        Disposition::Exact
    );
    assert_eq!(
        target_entry.field(Field::TextJustify).disposition,
        Disposition::Exact
    );
    assert_eq!(
        target_entry.field(Field::WordBreak).disposition,
        Disposition::Exact
    );
    assert_eq!(
        target_entry.field(Field::Padding).disposition,
        Disposition::LegacyPolicy
    );
    assert_eq!(
        target_entry.field(Field::Direction).disposition,
        Disposition::Unavailable
    );
    assert_eq!(
        target_entry.field(Field::Foreground).disposition,
        Disposition::Unavailable
    );
    assert_eq!(
        target_entry.field(Field::Opacity).disposition,
        Disposition::Exact
    );
    assert_eq!(
        target_entry.field(Field::Border).disposition,
        Disposition::Unavailable
    );
    assert_eq!(
        target_entry.field(Field::TextShadows).disposition,
        Disposition::Unavailable
    );
}

#[test]
fn raw_color_evidence_borrows_the_resolved_map_string() {
    let prepared = fixture(r##"<p id="target" style="color:#123456">text</p>"##);
    let target = prepared.source_arena.find_element_by_id("target").unwrap();
    let resolved = prepared.resolve();
    let original = resolved
        .style_for_id("target")
        .and_then(|style| style.get("color"))
        .and_then(serde_json::Value::as_str)
        .expect("legacy raw color");
    let projection = prepared.project_inline_styles_v1(&resolved);
    let entry = projection
        .dispositions()
        .iter()
        .find(|entry| entry.node_id == target)
        .unwrap();
    let outcome = entry.field(Field::Foreground);
    let Some(Evidence::RawString(evidence)) = outcome.evidence else {
        panic!("raw color evidence is retained");
    };

    assert_eq!(outcome.disposition, Disposition::Unavailable);
    assert_eq!(outcome.reason, Reason::ColorNotComputed);
    assert!(std::ptr::eq(original.as_ptr(), evidence.as_ptr()));
}

#[test]
fn suppressed_elements_receive_per_field_missing_dispositions() {
    let prepared =
        fixture(r#"<p id="hidden" style="display:none"><span id="child">text</span></p>"#);
    let hidden = prepared.source_arena.find_element_by_id("hidden").unwrap();
    let child = prepared.source_arena.find_element_by_id("child").unwrap();
    let resolved = prepared.resolve();
    let projection = prepared.project_inline_styles_v1(&resolved);

    for node_id in [hidden, child] {
        let entry = projection
            .dispositions
            .iter()
            .find(|entry| entry.node_id == node_id)
            .unwrap();
        assert!(entry.fields().all(|field| {
            field.disposition == Disposition::Unavailable
                && field.reason == Reason::ResolvedStyleMissing
                && field.evidence.is_none()
        }));
    }
}

#[test]
fn invalid_legacy_numeric_is_never_promoted_to_exact() {
    let prepared = fixture(r#"<p id="target" style="line-height:-1">text</p>"#);
    let target = prepared.source_arena.find_element_by_id("target").unwrap();
    let resolved = prepared.resolve();
    let projection = prepared.project_inline_styles_v1(&resolved);
    let outcome = projection
        .dispositions
        .iter()
        .find(|entry| entry.node_id == target)
        .unwrap()
        .field(Field::LineHeight);

    assert_eq!(outcome.disposition, Disposition::Invalid);
    assert_eq!(
        outcome.reason,
        Reason::InvalidNumeric(NumericError::Negative)
    );
    assert!(outcome.evidence.is_none());
}

#[test]
fn all_three_legacy_lists_fail_before_over_budget_projection() {
    let family_list = (0..=INLINE_STYLE_LIST_ITEM_LIMIT_V1)
        .map(|index| format!("Family{index}"))
        .collect::<Vec<_>>()
        .join(",");
    let mut font_style = Map::new();
    font_style.insert("fontFamily".to_owned(), Value::String(family_list));
    let family = super::font_text::project(&font_style, Field::FontFamilies);
    assert_eq!(family.disposition, Disposition::Unavailable);
    assert_eq!(family.reason, Reason::ProjectionBudgetExceeded);

    for (field, key) in [
        (Field::TextShadows, "textShadow"),
        (Field::BoxShadows, "boxShadow"),
    ] {
        let mut paint_style = Map::new();
        paint_style.insert(
            key.to_owned(),
            Value::Array(vec![Value::Null; INLINE_STYLE_LIST_ITEM_LIMIT_V1 + 1]),
        );
        let outcome = super::paint::project(&paint_style, field);
        assert_eq!(outcome.disposition, Disposition::Unavailable);
        assert_eq!(outcome.reason, Reason::ProjectionBudgetExceeded);
        assert!(outcome.evidence.is_none());
    }
}
