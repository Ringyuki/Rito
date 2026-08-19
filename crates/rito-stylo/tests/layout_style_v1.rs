use std::sync::Arc;

use rito_source::SourceArena;
use rito_style_contract::{
    AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
    LayoutDisplayOutsideV1, LengthPercentage, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1,
    MinimumHeightV1, NonNegativeCssPx, NonNegativeLengthPercentage, OverflowV1, PageBreakV1,
    Percentage, PreferredSizeV1,
};
use rito_stylo::{
    LayoutStyleDispositionV1, LayoutStyleFieldV1, LayoutStyleProjectionReasonV1, StyleDocument,
    StylesheetInput, Viewport,
};

const URL: &str = "https://example.test/book/chapter.xhtml";

fn target_source() -> Arc<SourceArena> {
    Arc::new(
        SourceArena::from_xhtml(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="target">text</div></body></html>"#,
        )
        .expect("fixture XHTML parses"),
    )
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

fn assert_layout_rejected(
    css: &str,
    field: LayoutStyleFieldV1,
    reason: LayoutStyleProjectionReasonV1,
) {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(Arc::clone(&source), css);

    let projection = document.resolve_production_slice_v1().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDispositionV1::ContractRejected {
            node_id: target,
            field,
            reason,
        }
    ));
}

#[test]
fn production_slice_keeps_percentage_auto_display_and_legacy_list_type_exact() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#target { display: inline-block; width: 50%; height: auto; max-width: 80%; clear: both; list-style-type: lower-roman }",
    );

    let projection = document.resolve_production_slice_v1().unwrap();
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .unwrap();

    assert_eq!(style.display.outside, LayoutDisplayOutsideV1::Inline);
    assert_eq!(style.display.inside, LayoutDisplayInsideV1::FlowRoot);
    assert!(!style.display.is_list_item);
    assert_eq!(
        style.width,
        PreferredSizeV1::Value(NonNegativeLengthPercentage::new(
            LengthPercentage::Percentage(Percentage::from_percent(50.0).unwrap())
        ))
    );
    assert_eq!(style.height, PreferredSizeV1::Auto);
    assert_eq!(
        style.max_width,
        MaximumSizeV1::Value(NonNegativeLengthPercentage::new(
            LengthPercentage::Percentage(Percentage::from_percent(80.0).unwrap())
        ))
    );
    assert_eq!(style.clear, ClearV1::Both);
    assert_eq!(style.list_style_type, ListMarkerStyleV1::LowerRoman);
    assert!(projection
        .inline()
        .table()
        .style_for_node(target.index())
        .is_ok());
}

#[test]
fn height_constraints_float_and_overflow_project_exactly() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#target { min-height: 12px; max-height: 120px; float: left; overflow: hidden }",
    );

    let projection = document.resolve_production_slice_v1().unwrap();
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .unwrap();
    assert_eq!(
        style.min_height,
        MinimumHeightV1::Length(NonNegativeCssPx::new(12.0).unwrap())
    );
    assert_eq!(
        style.max_height,
        MaximumHeightV1::Length(NonNegativeCssPx::new(120.0).unwrap())
    );
    assert_eq!(style.float, FloatV1::Left);
    assert_eq!(style.overflow, OverflowV1::Hidden);
}

#[test]
fn centered_single_line_row_flex_alignment_projects_exactly() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#target { display: flex; flex-direction: row; flex-wrap: nowrap; \
         justify-content: center; align-items: center; height: 200px }",
    );

    let projection = document.resolve_production_slice_v1().unwrap();
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .unwrap();
    assert_eq!(style.display.outside, LayoutDisplayOutsideV1::Block);
    assert_eq!(style.display.inside, LayoutDisplayInsideV1::Flex);
    assert_eq!(style.justify_content, JustifyContentV1::Center);
    assert_eq!(style.align_items, AlignItemsV1::Center);
}

#[test]
fn page_break_aliases_use_one_stylo_cascade_and_distinct_table_keys() {
    let source = Arc::new(
        SourceArena::from_xhtml(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body>
                <div id="specific" class="specific">specific</div>
                <div id="source-order">source order</div>
                <div id="important">important</div>
                <div id="inline" style="break-before: column">inline</div>
                <div id="variable" style="--forced-break: column; break-after: var(--forced-break)">variable</div>
            </body></html>"#,
        )
        .expect("fixture XHTML parses"),
    );
    let mut document = document(
        Arc::clone(&source),
        "div.specific { break-before: auto; } \
         .specific { break-before: column; } \
         #source-order { page-break-before: auto; break-before: column; } \
         #important { page-break-before: auto; break-before: column !important; \
                      page-break-before: auto; } \
         #inline { break-before: auto; }",
    );

    let projection = document.resolve_production_slice_v1().unwrap();
    let table = projection.layout().table();
    let style = |id| {
        let node = source.find_element_by_id(id).expect("fixture id exists");
        table.style_for_node(node.index()).unwrap()
    };

    assert_eq!(style("specific").break_before, PageBreakV1::Auto);
    assert_eq!(style("source-order").break_before, PageBreakV1::Always);
    assert_eq!(style("important").break_before, PageBreakV1::Always);
    assert_eq!(style("inline").break_before, PageBreakV1::Always);
    assert_eq!(style("variable").break_after, PageBreakV1::Always);

    let source_order_id = table
        .node_style_id(source.find_element_by_id("source-order").unwrap().index())
        .unwrap();
    let variable_id = table
        .node_style_id(source.find_element_by_id("variable").unwrap().index())
        .unwrap();
    assert_ne!(source_order_id, variable_id);
}

#[test]
fn page_and_always_forced_breaks_are_ignored_like_the_column_context_ignores_them() {
    let source = Arc::new(
        SourceArena::from_xhtml(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body>
                <div id="page" style="page-break-before: always">page</div>
                <div id="modern" style="break-after: always">modern</div>
                <div id="paged" style="break-before: page">paged</div>
            </body></html>"#,
        )
        .expect("fixture XHTML parses"),
    );
    let mut document = document(Arc::clone(&source), "");
    let projection = document.resolve_production_slice_v1().unwrap();
    let table = projection.layout().table();
    let style = |id: &str| {
        let node = source.find_element_by_id(id).expect("fixture id exists");
        table.style_for_node(node.index()).unwrap()
    };
    // Measured in Chromium's continuous multicol (the reader's
    // fragmentation context): generic and page forced breaks never
    // break a column; only the `column` keyword does.
    assert_eq!(style("page").break_before, PageBreakV1::Auto);
    assert_eq!(style("modern").break_after, PageBreakV1::Auto);
    assert_eq!(style("paged").break_before, PageBreakV1::Auto);
}

#[test]
fn unsupported_page_break_values_fail_closed_in_the_typed_projection() {
    assert_layout_rejected(
        "#target { break-before: avoid }",
        LayoutStyleFieldV1::BreakBefore,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { page-break-after: left }",
        LayoutStyleFieldV1::BreakAfter,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { break-before: right }",
        LayoutStyleFieldV1::BreakBefore,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
}

#[test]
fn unsupported_flex_flow_and_alignment_fail_closed() {
    assert_layout_rejected(
        "#target { display: flex; flex-direction: column }",
        LayoutStyleFieldV1::FlexDirection,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { display: flex; flex-wrap: wrap }",
        LayoutStyleFieldV1::FlexWrap,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { display: flex; justify-content: flex-start }",
        LayoutStyleFieldV1::JustifyContent,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { display: flex; align-items: stretch }",
        LayoutStyleFieldV1::AlignItems,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
}

#[test]
fn logical_float_fails_closed_without_a_layout_table_assignment() {
    assert_layout_rejected(
        "#target { float: inline-start }",
        LayoutStyleFieldV1::Float,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
}

#[test]
fn asymmetric_or_scrollable_overflow_fails_closed() {
    assert_layout_rejected(
        "#target { overflow-x: hidden; overflow-y: visible }",
        LayoutStyleFieldV1::Overflow,
        LayoutStyleProjectionReasonV1::AxisValuesDiffer,
    );
    assert_layout_rejected(
        "#target { overflow: auto }",
        LayoutStyleFieldV1::Overflow,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
}

#[test]
fn percentage_height_constraints_are_preserved_in_the_contract() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#target { min-height: 25%; max-height: 100% }",
    );

    let projection = document.resolve_production_slice_v1().unwrap();
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .unwrap();
    assert_eq!(
        style.min_height,
        MinimumHeightV1::Percentage(Percentage::from_percent(25.0).unwrap())
    );
    assert_eq!(
        style.max_height,
        MaximumHeightV1::Percentage(Percentage::from_percent(100.0).unwrap())
    );
}

#[test]
fn intrinsic_and_opaque_max_height_fail_closed() {
    assert_layout_rejected(
        "#target { max-height: max-content }",
        LayoutStyleFieldV1::MaxHeight,
        LayoutStyleProjectionReasonV1::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { max-height: calc(2px + 50%) }",
        LayoutStyleFieldV1::MaxHeight,
        LayoutStyleProjectionReasonV1::OpaqueCalc,
    );
}

#[test]
fn logical_clear_fails_closed_without_a_layout_table_assignment() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(Arc::clone(&source), "#target { clear: inline-start }");

    let projection = document.resolve_production_slice_v1().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDispositionV1::ContractRejected {
            node_id: target,
            field: LayoutStyleFieldV1::Clear,
            reason: LayoutStyleProjectionReasonV1::UnsupportedValue,
        }
    ));
}

#[test]
fn intrinsic_max_width_fails_closed_without_a_layout_table_assignment() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(Arc::clone(&source), "#target { max-width: max-content }");

    let projection = document.resolve_production_slice_v1().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDispositionV1::ContractRejected {
            node_id: target,
            field: LayoutStyleFieldV1::MaxWidth,
            reason: LayoutStyleProjectionReasonV1::UnsupportedValue,
        }
    ));
}

#[test]
fn opaque_max_width_calc_fails_closed_without_a_layout_table_assignment() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#target { max-width: calc(2px + 50%) }",
    );

    let projection = document.resolve_production_slice_v1().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDispositionV1::ContractRejected {
            node_id: target,
            field: LayoutStyleFieldV1::MaxWidth,
            reason: LayoutStyleProjectionReasonV1::OpaqueCalc,
        }
    ));
}

#[test]
fn opaque_width_calc_fails_closed_without_a_layout_table_assignment() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(Arc::clone(&source), "#target { width: calc(2px + 50%) }");

    let projection = document.resolve_production_slice_v1().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDispositionV1::ContractRejected {
            node_id: target,
            field: LayoutStyleFieldV1::Width,
            reason: LayoutStyleProjectionReasonV1::OpaqueCalc,
        }
    ));
}

#[test]
fn counter_styles_outside_the_legacy_consumer_enum_fail_closed() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(
        Arc::clone(&source),
        "#target { list-style-type: japanese-formal }",
    );

    let projection = document.resolve_production_slice_v1().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDispositionV1::ContractRejected {
            node_id: target,
            field: LayoutStyleFieldV1::ListStyleType,
            reason: LayoutStyleProjectionReasonV1::UnsupportedValue,
        }
    ));
}
