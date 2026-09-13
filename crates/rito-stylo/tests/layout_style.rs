use std::sync::Arc;

use rito_source::SourceArena;
use rito_style_contract::{
    AlignItems, Clear, Float, JustifyContent, LayoutDisplayInside, LayoutDisplayOutside,
    LengthPercentage, ListMarkerStyle, MaximumHeight, MaximumSize, MinimumHeight, NonNegativeCssPx,
    NonNegativeLengthPercentage, Overflow, PageBreak, Percentage, PreferredSize,
};
use rito_stylo::{
    LayoutStyleDisposition, LayoutStyleField, LayoutStyleProjectionReason, StyleDocument,
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
    StyleDocument::from_source_with_root_font_size(
        source,
        URL,
        Viewport::default(),
        16.0,
        &[StylesheetInput::author(css, URL)],
    )
    .expect("fixture style document builds")
}

fn assert_layout_rejected(css: &str, field: LayoutStyleField, reason: LayoutStyleProjectionReason) {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(Arc::clone(&source), css);

    let projection = document.resolve_production_slice().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDisposition::ContractRejected {
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

    let projection = document.resolve_production_slice().unwrap();
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .unwrap();

    assert_eq!(style.display.outside, LayoutDisplayOutside::Inline);
    assert_eq!(style.display.inside, LayoutDisplayInside::FlowRoot);
    assert!(!style.display.is_list_item);
    assert_eq!(
        style.width,
        PreferredSize::Value(NonNegativeLengthPercentage::new(
            LengthPercentage::Percentage(Percentage::from_percent(50.0).unwrap())
        ))
    );
    assert_eq!(style.height, PreferredSize::Auto);
    assert_eq!(
        style.max_width,
        MaximumSize::Value(NonNegativeLengthPercentage::new(
            LengthPercentage::Percentage(Percentage::from_percent(80.0).unwrap())
        ))
    );
    assert_eq!(style.clear, Clear::Both);
    assert_eq!(style.list_style_type, ListMarkerStyle::LowerRoman);
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

    let projection = document.resolve_production_slice().unwrap();
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .unwrap();
    assert_eq!(
        style.min_height,
        MinimumHeight::Length(NonNegativeCssPx::new(12.0).unwrap())
    );
    assert_eq!(
        style.max_height,
        MaximumHeight::Length(NonNegativeCssPx::new(120.0).unwrap())
    );
    assert_eq!(style.float, Float::Left);
    assert_eq!(style.overflow, Overflow::Hidden);
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

    let projection = document.resolve_production_slice().unwrap();
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .unwrap();
    assert_eq!(style.display.outside, LayoutDisplayOutside::Block);
    assert_eq!(style.display.inside, LayoutDisplayInside::Flex);
    assert_eq!(style.justify_content, JustifyContent::Center);
    assert_eq!(style.align_items, AlignItems::Center);
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

    let projection = document.resolve_production_slice().unwrap();
    let table = projection.layout().table();
    let style = |id| {
        let node = source.find_element_by_id(id).expect("fixture id exists");
        table.style_for_node(node.index()).unwrap()
    };

    assert_eq!(style("specific").break_before, PageBreak::Auto);
    assert_eq!(style("source-order").break_before, PageBreak::Always);
    assert_eq!(style("important").break_before, PageBreak::Always);
    assert_eq!(style("inline").break_before, PageBreak::Always);
    assert_eq!(style("variable").break_after, PageBreak::Always);

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
    let projection = document.resolve_production_slice().unwrap();
    let table = projection.layout().table();
    let style = |id: &str| {
        let node = source.find_element_by_id(id).expect("fixture id exists");
        table.style_for_node(node.index()).unwrap()
    };
    // Measured in Chromium's continuous multicol (the reader's
    // fragmentation context): generic and page forced breaks never
    // break a column; only the `column` keyword does.
    assert_eq!(style("page").break_before, PageBreak::Auto);
    assert_eq!(style("modern").break_after, PageBreak::Auto);
    assert_eq!(style("paged").break_before, PageBreak::Auto);
}

#[test]
fn unsupported_page_break_values_fail_closed_in_the_typed_projection() {
    assert_layout_rejected(
        "#target { break-before: avoid }",
        LayoutStyleField::BreakBefore,
        LayoutStyleProjectionReason::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { page-break-after: left }",
        LayoutStyleField::BreakAfter,
        LayoutStyleProjectionReason::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { break-before: right }",
        LayoutStyleField::BreakBefore,
        LayoutStyleProjectionReason::UnsupportedValue,
    );
}

#[test]
fn unsupported_flex_flow_and_alignment_fail_closed() {
    assert_layout_rejected(
        "#target { display: flex; flex-direction: column }",
        LayoutStyleField::FlexDirection,
        LayoutStyleProjectionReason::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { display: flex; flex-wrap: wrap }",
        LayoutStyleField::FlexWrap,
        LayoutStyleProjectionReason::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { display: flex; justify-content: flex-start }",
        LayoutStyleField::JustifyContent,
        LayoutStyleProjectionReason::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { display: flex; align-items: stretch }",
        LayoutStyleField::AlignItems,
        LayoutStyleProjectionReason::UnsupportedValue,
    );
}

#[test]
fn logical_float_fails_closed_without_a_layout_table_assignment() {
    assert_layout_rejected(
        "#target { float: inline-start }",
        LayoutStyleField::Float,
        LayoutStyleProjectionReason::UnsupportedValue,
    );
}

#[test]
fn asymmetric_or_scrollable_overflow_fails_closed() {
    assert_layout_rejected(
        "#target { overflow-x: hidden; overflow-y: visible }",
        LayoutStyleField::Overflow,
        LayoutStyleProjectionReason::AxisValuesDiffer,
    );
    assert_layout_rejected(
        "#target { overflow: auto }",
        LayoutStyleField::Overflow,
        LayoutStyleProjectionReason::UnsupportedValue,
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

    let projection = document.resolve_production_slice().unwrap();
    let style = projection
        .layout()
        .table()
        .style_for_node(target.index())
        .unwrap();
    assert_eq!(
        style.min_height,
        MinimumHeight::Percentage(Percentage::from_percent(25.0).unwrap())
    );
    assert_eq!(
        style.max_height,
        MaximumHeight::Percentage(Percentage::from_percent(100.0).unwrap())
    );
}

#[test]
fn intrinsic_and_opaque_max_height_fail_closed() {
    assert_layout_rejected(
        "#target { max-height: max-content }",
        LayoutStyleField::MaxHeight,
        LayoutStyleProjectionReason::UnsupportedValue,
    );
    assert_layout_rejected(
        "#target { max-height: calc(2px + 50%) }",
        LayoutStyleField::MaxHeight,
        LayoutStyleProjectionReason::OpaqueCalc,
    );
}

#[test]
fn logical_clear_fails_closed_without_a_layout_table_assignment() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(Arc::clone(&source), "#target { clear: inline-start }");

    let projection = document.resolve_production_slice().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDisposition::ContractRejected {
            node_id: target,
            field: LayoutStyleField::Clear,
            reason: LayoutStyleProjectionReason::UnsupportedValue,
        }
    ));
}

#[test]
fn intrinsic_max_width_fails_closed_without_a_layout_table_assignment() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(Arc::clone(&source), "#target { max-width: max-content }");

    let projection = document.resolve_production_slice().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDisposition::ContractRejected {
            node_id: target,
            field: LayoutStyleField::MaxWidth,
            reason: LayoutStyleProjectionReason::UnsupportedValue,
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

    let projection = document.resolve_production_slice().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDisposition::ContractRejected {
            node_id: target,
            field: LayoutStyleField::MaxWidth,
            reason: LayoutStyleProjectionReason::OpaqueCalc,
        }
    ));
}

#[test]
fn opaque_width_calc_fails_closed_without_a_layout_table_assignment() {
    let source = target_source();
    let target = source.find_element_by_id("target").unwrap();
    let mut document = document(Arc::clone(&source), "#target { width: calc(2px + 50%) }");

    let projection = document.resolve_production_slice().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDisposition::ContractRejected {
            node_id: target,
            field: LayoutStyleField::Width,
            reason: LayoutStyleProjectionReason::OpaqueCalc,
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

    let projection = document.resolve_production_slice().unwrap();
    assert_eq!(
        projection.layout().table().node_style_ids()[target.index()],
        None
    );
    assert!(projection.layout().dispositions().contains(
        &LayoutStyleDisposition::ContractRejected {
            node_id: target,
            field: LayoutStyleField::ListStyleType,
            reason: LayoutStyleProjectionReason::UnsupportedValue,
        }
    ));
}
