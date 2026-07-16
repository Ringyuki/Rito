use std::sync::Arc;

use serde_json::{json, Value};

use super::{
    resolve_text_caret, resolve_text_range, LayoutExactTextRangeResolution,
    LayoutTextCaretResolution, TextCaretAddress, TextCaretAffinity,
    TextInteractionUnavailableReason,
};
use crate::layout::{
    fixture_logical_text_flow, FontVerticalMetricSample, LayoutRuntimePage, LineBox, LineRun,
    LogicalTextFlow, RunShape, RunShapeCluster, RunShapeDirection, RunShapeProvenance,
    RunShapeUnavailableReason, RunTextMapping, RuntimeBlock, RuntimeChild, TextFlowSlice,
    TextRunBox, TextRunInteractionGeometry,
};

#[test]
fn caret_and_range_use_font_geometry_while_hit_testing_keeps_line_height() {
    let flow = exact_flow("a");
    let mut text_run = run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1));
    let LineRun::Text(run) = &mut text_run else {
        unreachable!("fixture creates a text run");
    };
    run.interaction_geometry = TextRunInteractionGeometry::from_font_metrics(
        &FontVerticalMetricSample {
            font_family: "serif".to_owned(),
            font_style: "normal".to_owned(),
            font_weight: 400,
            font_size_px: 16.0,
            top_baseline_ascent_px: 4.0,
            top_baseline_descent_px: 12.0,
        },
        run.height,
    );
    let page = page(0, vec![vec![text_run]], None);

    let LayoutTextCaretResolution::Resolved(caret) = resolve_text_caret(0, &page, 15.0, 39.0)
    else {
        panic!("full line-height hit target resolves below the font box");
    };
    assert_eq!((caret.geometry.y, caret.geometry.height), (22.0, 16.0));

    let LayoutExactTextRangeResolution::Resolved(range) = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        address(0, 0, 0, 0, 1, TextCaretAffinity::Upstream),
    ) else {
        panic!("font-box range resolves");
    };
    assert_eq!((range.rects[0].y, range.rects[0].height), (22.0, 16.0));
}

#[test]
fn point_hit_uses_variable_width_cluster_carets() {
    let flow = exact_flow("Wi");
    let page = page(
        0,
        vec![vec![run(
            "Wi",
            slice(&flow, 0, 0, 2),
            0.0,
            40.0,
            exact_shape(
                &[(0, 1, 10.0), (1, 2, 30.0)],
                RunShapeDirection::LeftToRight,
            ),
        )]],
        None,
    );

    let LayoutTextCaretResolution::Resolved(caret) = resolve_text_caret(0, &page, 24.0, 25.0)
    else {
        panic!("point resolves to an exact caret");
    };

    assert_eq!(caret.address.char_index, 1);
    assert_eq!(caret.geometry.x, 20.0);
    assert_ne!(caret.geometry.x, 30.0);
    assert_eq!(caret.source_point.text_offset, 1);
}

#[test]
fn point_hit_snaps_vertical_line_gaps_to_the_nearest_text_run() {
    let flow = exact_flow("ab");
    let page = page(
        0,
        vec![
            vec![run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1))],
            vec![run("b", slice(&flow, 0, 1, 2), 0.0, 10.0, uniform_shape(1))],
        ],
        None,
    );

    let LayoutTextCaretResolution::Resolved(upper) = resolve_text_caret(0, &page, 15.0, 44.0)
    else {
        panic!("upper half of the line gap resolves");
    };
    let LayoutTextCaretResolution::Resolved(lower) = resolve_text_caret(0, &page, 15.0, 46.0)
    else {
        panic!("lower half of the line gap resolves");
    };

    assert_eq!(upper.address.line_index, 0);
    assert_eq!(lower.address.line_index, 1);
}

#[test]
fn point_hit_does_not_snap_distant_page_whitespace_to_text() {
    let flow = exact_flow("a");
    let page = page(
        0,
        vec![vec![run(
            "a",
            slice(&flow, 0, 0, 1),
            0.0,
            10.0,
            uniform_shape(1),
        )]],
        None,
    );

    assert_eq!(
        resolve_text_caret(0, &page, 15.0, -100.0),
        LayoutTextCaretResolution::Miss
    );
    assert_eq!(
        resolve_text_caret(0, &page, 15.0, 500.0),
        LayoutTextCaretResolution::Miss
    );
}

#[test]
fn complex_clusters_do_not_expose_interior_carets() {
    let flow = exact_flow("e\u{301}");
    let page = page(
        0,
        vec![vec![run(
            "e\u{301}",
            slice(&flow, 0, 0, 2),
            0.0,
            18.0,
            exact_shape(&[(0, 2, 18.0)], RunShapeDirection::LeftToRight),
        )]],
        None,
    );

    let LayoutTextCaretResolution::Resolved(caret) = resolve_text_caret(0, &page, 19.0, 25.0)
    else {
        panic!("cluster edge resolves");
    };
    assert_eq!(caret.address.char_index, 2);
    let invalid = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, 0, 0, 1, TextCaretAffinity::Upstream),
        address(0, 0, 0, 0, 2, TextCaretAffinity::Upstream),
    );
    assert_eq!(
        invalid,
        LayoutExactTextRangeResolution::Unavailable(TextInteractionUnavailableReason::InvalidCaret)
    );
}

#[test]
fn non_bmp_cluster_uses_utf16_edges_and_source_offsets() {
    let flow = exact_flow("𠮷");
    let page = page(
        0,
        vec![vec![run(
            "𠮷",
            slice(&flow, 0, 0, 2),
            0.0,
            18.0,
            exact_shape(&[(0, 2, 18.0)], RunShapeDirection::LeftToRight),
        )]],
        None,
    );

    let LayoutTextCaretResolution::Resolved(caret) = resolve_text_caret(0, &page, 29.0, 25.0)
    else {
        panic!("non-BMP end caret resolves");
    };
    assert_eq!(caret.address.char_index, 2);
    assert_eq!(caret.source_point.text_offset, 2);
    assert_eq!(
        resolve_text_range(
            std::slice::from_ref(&page),
            address(0, 0, 0, 0, 1, TextCaretAffinity::Upstream),
            address(0, 0, 0, 0, 2, TextCaretAffinity::Upstream),
        ),
        LayoutExactTextRangeResolution::Unavailable(TextInteractionUnavailableReason::InvalidCaret)
    );
}

#[test]
fn rtl_hit_and_reverse_range_use_logical_cluster_edges() {
    let flow = exact_flow("ab");
    let page = page(
        0,
        vec![vec![run(
            "ab",
            slice(&flow, 0, 0, 2),
            0.0,
            30.0,
            exact_shape(
                &[(1, 2, 10.0), (0, 1, 20.0)],
                RunShapeDirection::RightToLeft,
            ),
        )]],
        None,
    );

    let LayoutTextCaretResolution::Resolved(caret) = resolve_text_caret(0, &page, 38.0, 25.0)
    else {
        panic!("RTL point resolves");
    };
    assert_eq!(caret.address.char_index, 0);
    assert_eq!(caret.geometry.x, 40.0);
    let resolution = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, 0, 0, 1, TextCaretAffinity::Downstream),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
    );
    let LayoutExactTextRangeResolution::Resolved(range) = resolution else {
        panic!("reverse RTL range resolves");
    };
    assert_eq!(range.selected_text, "a");
    assert_eq!(range.start.char_index, 0);
    assert_eq!(range.end.char_index, 1);
    assert_eq!((range.rects[0].x, range.rects[0].width), (20.0, 20.0));
}

#[test]
fn text_range_keeps_unpainted_soft_wrap_text() {
    let flow = exact_flow("one two");
    let page = page(
        0,
        vec![
            vec![run(
                "one",
                slice(&flow, 0, 0, 3),
                0.0,
                30.0,
                uniform_shape(3),
            )],
            vec![run(
                "two",
                slice(&flow, 0, 4, 7),
                0.0,
                30.0,
                uniform_shape(3),
            )],
        ],
        None,
    );

    let resolution = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        address(0, 0, 1, 0, 3, TextCaretAffinity::Upstream),
    );
    let LayoutExactTextRangeResolution::Resolved(range) = resolution else {
        panic!("soft wrapped range resolves");
    };

    assert_eq!(range.selected_text, "one two");
    assert_eq!(range.rects.len(), 2);
    assert_eq!(range.source_start.text_offset, 0);
    assert_eq!(range.source_end.text_offset, 7);
}

#[test]
fn text_range_keeps_forced_source_newlines() {
    let flow = exact_flow("a\nb");
    let page = page(
        0,
        vec![
            vec![run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1))],
            vec![run("b", slice(&flow, 0, 2, 3), 0.0, 10.0, uniform_shape(1))],
        ],
        None,
    );

    let resolution = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        address(0, 0, 1, 0, 1, TextCaretAffinity::Upstream),
    );
    let LayoutExactTextRangeResolution::Resolved(range) = resolution else {
        panic!("forced-newline range resolves");
    };

    assert_eq!(range.selected_text, "a\nb");
    assert_eq!(range.rects.len(), 2);
}

#[test]
fn equal_logical_offsets_normalize_source_boundaries_by_layout_order() {
    let flow = fixture_logical_text_flow(
        "ab",
        vec![(0, 1, Some((vec![0], 0))), (1, 2, Some((vec![1], 0)))],
    );
    let page = page(
        0,
        vec![vec![
            run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1)),
            run("b", slice(&flow, 1, 1, 2), 10.0, 10.0, uniform_shape(1)),
        ]],
        None,
    );
    let earlier = address(0, 0, 0, 0, 1, TextCaretAffinity::Upstream);
    let later = address(0, 0, 0, 1, 0, TextCaretAffinity::Downstream);

    let resolution = resolve_text_range(std::slice::from_ref(&page), later, earlier);
    let LayoutExactTextRangeResolution::Resolved(range) = resolution else {
        panic!("collapsed source boundary resolves");
    };

    assert_eq!(range.start, earlier);
    assert_eq!(range.end, later);
    assert!(range.selected_text.is_empty());
    assert_eq!(range.source_start.node_path, [0]);
    assert_eq!(range.source_start.text_offset, 1);
    assert_eq!(range.source_end.node_path, [1]);
    assert_eq!(range.source_end.text_offset, 0);
}

#[test]
fn text_range_crosses_pages_without_losing_geometry() {
    let flow = exact_flow("ab");
    let pages = vec![
        page(
            0,
            vec![vec![run(
                "a",
                slice(&flow, 0, 0, 1),
                0.0,
                10.0,
                uniform_shape(1),
            )]],
            None,
        ),
        page(
            1,
            vec![vec![run(
                "b",
                slice(&flow, 0, 1, 2),
                0.0,
                10.0,
                uniform_shape(1),
            )]],
            None,
        ),
    ];

    let resolution = resolve_text_range(
        &pages,
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        address(1, 0, 0, 0, 1, TextCaretAffinity::Upstream),
    );
    let LayoutExactTextRangeResolution::Resolved(range) = resolution else {
        panic!("cross-page range resolves");
    };

    assert_eq!(range.selected_text, "ab");
    assert_eq!(
        range
            .rects
            .iter()
            .map(|rect| rect.page_index)
            .collect::<Vec<_>>(),
        [0, 1]
    );
}

#[test]
fn paragraph_flows_resolve_in_document_order_with_native_separators() {
    let first_flow = fixture_logical_text_flow("a", vec![(0, 1, Some((vec![1], 0)))]);
    let second_flow = fixture_logical_text_flow("b", vec![(0, 1, Some((vec![2], 0)))]);
    let pages = vec![
        page(
            0,
            vec![vec![run(
                "a",
                slice(&first_flow, 0, 0, 1),
                0.0,
                10.0,
                uniform_shape(1),
            )]],
            None,
        ),
        page(1, Vec::new(), None),
        page(
            2,
            vec![vec![run(
                "b",
                slice(&second_flow, 0, 0, 1),
                0.0,
                10.0,
                uniform_shape(1),
            )]],
            None,
        ),
    ];

    let resolution = resolve_text_range(
        &pages,
        address(2, 0, 0, 0, 1, TextCaretAffinity::Upstream),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
    );
    let LayoutExactTextRangeResolution::Resolved(range) = resolution else {
        panic!("cross-paragraph range resolves");
    };

    assert_eq!(range.selected_text, "a\n\nb");
    assert_eq!(range.source_start.node_path, [1]);
    assert_eq!(range.source_end.node_path, [2]);
    assert_eq!(
        range
            .rects
            .iter()
            .map(|rect| rect.page_index)
            .collect::<Vec<_>>(),
        [0, 2]
    );
}

#[test]
fn many_paragraph_flows_resolve_with_complete_geometry() {
    let flow_count = 64;
    let flows = (0..flow_count)
        .map(|index| fixture_logical_text_flow("x", vec![(0, 1, Some((vec![index], 0)))]))
        .collect::<Vec<_>>();
    let lines = flows
        .iter()
        .map(|flow| vec![run("x", slice(flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1))])
        .collect();
    let page = page(0, lines, None);

    let LayoutExactTextRangeResolution::Resolved(range) = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, flow_count - 1, 0, 1, TextCaretAffinity::Upstream),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
    ) else {
        panic!("many-flow selection resolves");
    };

    assert_eq!(range.selected_text, vec!["x"; flow_count].join("\n\n"));
    assert_eq!(range.rects.len(), flow_count);
}

#[test]
fn non_paragraph_flow_boundaries_use_one_conservative_newline() {
    let first_flow = fixture_logical_text_flow("a", vec![(0, 1, Some((vec![1], 0)))]);
    let second_flow = fixture_logical_text_flow("b", vec![(0, 1, Some((vec![2], 0)))]);
    let mut first = page(
        0,
        vec![vec![run(
            "a",
            slice(&first_flow, 0, 0, 1),
            0.0,
            10.0,
            uniform_shape(1),
        )]],
        None,
    );
    first.content[0].semantic_tag = Some("h1".to_owned());
    let pages = vec![
        first,
        page(
            1,
            vec![vec![run(
                "b",
                slice(&second_flow, 0, 0, 1),
                0.0,
                10.0,
                uniform_shape(1),
            )]],
            None,
        ),
    ];

    let LayoutExactTextRangeResolution::Resolved(range) = resolve_text_range(
        &pages,
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        address(1, 0, 0, 0, 1, TextCaretAffinity::Upstream),
    ) else {
        panic!("cross-block range resolves");
    };
    assert_eq!(range.selected_text, "a\nb");
}

#[test]
fn unavailable_source_span_blocks_an_otherwise_exact_range() {
    let flow = fixture_logical_text_flow(
        "a?b",
        vec![
            (0, 1, Some((vec![0], 0))),
            (1, 2, None),
            (2, 3, Some((vec![1], 0))),
        ],
    );
    let page = page(
        0,
        vec![vec![
            run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1)),
            run("b", slice(&flow, 2, 2, 3), 10.0, 10.0, uniform_shape(1)),
        ]],
        None,
    );

    let resolution = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        address(0, 0, 0, 1, 1, TextCaretAffinity::Upstream),
    );
    assert_eq!(
        resolution,
        LayoutExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable
        )
    );
}

#[test]
fn unavailable_shape_blocks_the_complete_range() {
    let flow = exact_flow("abc");
    let page = page(
        0,
        vec![vec![
            run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1)),
            run(
                "b",
                slice(&flow, 0, 1, 2),
                10.0,
                10.0,
                RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 10.0),
            ),
            run("c", slice(&flow, 0, 2, 3), 20.0, 10.0, uniform_shape(1)),
        ]],
        None,
    );

    let resolution = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        address(0, 0, 0, 2, 1, TextCaretAffinity::Upstream),
    );
    assert_eq!(
        resolution,
        LayoutExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::ShapeUnavailable
        )
    );
}

#[test]
fn discretionary_hyphen_mapping_gap_blocks_exact_range() {
    let flow = exact_flow("a hyphenation");
    let page = page(
        0,
        vec![vec![
            run("a ", slice(&flow, 0, 0, 2), 0.0, 20.0, uniform_shape(2)),
            run(
                "hyphen-",
                RunTextMapping::synthetic(),
                20.0,
                70.0,
                RunShape::unavailable(RunShapeUnavailableReason::SyntheticLayoutText, 70.0),
            ),
            run(
                "ation",
                slice(&flow, 0, 8, 13),
                90.0,
                50.0,
                uniform_shape(5),
            ),
        ]],
        None,
    );

    let resolution = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        address(0, 0, 0, 2, 5, TextCaretAffinity::Upstream),
    );
    assert_eq!(
        resolution,
        LayoutExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable
        )
    );
}

#[test]
fn unpainted_non_whitespace_gap_blocks_exact_range() {
    let flow = exact_flow("abc");
    let page = page(
        0,
        vec![vec![
            run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1)),
            run("c", slice(&flow, 0, 2, 3), 10.0, 10.0, uniform_shape(1)),
        ]],
        None,
    );

    let resolution = resolve_text_range(
        std::slice::from_ref(&page),
        address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        address(0, 0, 0, 1, 1, TextCaretAffinity::Upstream),
    );
    assert_eq!(
        resolution,
        LayoutExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable
        )
    );
}

#[test]
fn unpainted_non_collapsible_unicode_space_blocks_exact_range() {
    for whitespace in ['\u{00A0}', '\u{3000}'] {
        let text = format!("a{whitespace}b");
        let flow = exact_flow(&text);
        let page = page(
            0,
            vec![vec![
                run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1)),
                run("b", slice(&flow, 0, 2, 3), 10.0, 10.0, uniform_shape(1)),
            ]],
            None,
        );

        assert_eq!(
            resolve_text_range(
                std::slice::from_ref(&page),
                address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
                address(0, 0, 0, 1, 1, TextCaretAffinity::Upstream),
            ),
            LayoutExactTextRangeResolution::Unavailable(
                TextInteractionUnavailableReason::SourceUnavailable
            )
        );
    }
}

#[test]
fn rotated_text_is_typed_unavailable_instead_of_using_its_aabb() {
    let flow = exact_flow("a");
    let page = page(
        0,
        vec![vec![run(
            "a",
            slice(&flow, 0, 0, 1),
            0.0,
            10.0,
            uniform_shape(1),
        )]],
        Some(json!({ "transform": [{ "kind": "rotate", "rad": 0.5 }] })),
    );

    assert_eq!(
        resolve_text_caret(0, &page, 35.0, -39.0),
        LayoutTextCaretResolution::Unavailable(
            TextInteractionUnavailableReason::UnsupportedTransform
        )
    );
    assert_eq!(
        resolve_text_range(
            std::slice::from_ref(&page),
            address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
            address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        ),
        LayoutExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::UnsupportedTransform
        )
    );
}

#[test]
fn clipping_cannot_replace_the_nearest_logical_caret() {
    let flow = exact_flow("a");
    let mut page = page(
        0,
        vec![vec![run(
            "a",
            slice(&flow, 0, 0, 1),
            -5.0,
            20.0,
            exact_shape(&[(0, 1, 20.0)], RunShapeDirection::LeftToRight),
        )]],
        Some(json!({ "clipToBounds": true })),
    );
    page.content[0].width = 5.0;

    assert_eq!(
        resolve_text_caret(0, &page, 12.0, 25.0),
        LayoutTextCaretResolution::Unavailable(
            TextInteractionUnavailableReason::VisualGeometryUnavailable
        )
    );
    assert_eq!(
        resolve_text_range(
            std::slice::from_ref(&page),
            address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
            address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream),
        ),
        LayoutExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::VisualGeometryUnavailable
        )
    );
}

fn exact_flow(text: &str) -> Arc<LogicalTextFlow> {
    fixture_logical_text_flow(
        text,
        vec![(0, text.encode_utf16().count() as u32, Some((vec![1, 2], 0)))],
    )
}

fn slice(
    flow: &Arc<LogicalTextFlow>,
    span_index: u32,
    logical_start: u32,
    logical_end: u32,
) -> RunTextMapping {
    RunTextMapping::Exact(TextFlowSlice {
        flow: Arc::clone(flow),
        span_index,
        logical_start,
        logical_end,
    })
}

fn run(text: &str, text_mapping: RunTextMapping, x: f64, width: f64, shape: RunShape) -> LineRun {
    LineRun::Text(TextRunBox {
        text: text.to_owned(),
        text_mapping,
        x,
        y: 0.0,
        width,
        height: 20.0,
        font_size: 16.0,
        interaction_geometry: None,
        paint: json!({}),
        line_height_px: None,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        inline_margin_right: None,
        ruby_annotation: None,
        shape,
    })
}

fn page(index: usize, lines: Vec<Vec<LineRun>>, paint: Option<Value>) -> LayoutRuntimePage {
    LayoutRuntimePage {
        index,
        width: 400.0,
        height: 600.0,
        paint: None,
        content: vec![RuntimeBlock {
            x: 10.0,
            y: 20.0,
            width: 300.0,
            height: lines.len() as f64 * 30.0,
            semantic_tag: Some("p".to_owned()),
            anchor_id: None,
            paint,
            border_box: None,
            page_break_before: false,
            page_break_after: false,
            orphans: None,
            widows: None,
            children: lines
                .into_iter()
                .enumerate()
                .map(|(index, runs)| {
                    RuntimeChild::Line(LineBox {
                        x: 0.0,
                        y: index as f64 * 30.0,
                        width: 200.0,
                        height: 20.0,
                        runs,
                    })
                })
                .collect(),
        }],
    }
}

fn uniform_shape(length: u32) -> RunShape {
    let clusters = (0..length)
        .map(|offset| (offset, offset + 1, 10.0))
        .collect::<Vec<_>>();
    exact_shape(&clusters, RunShapeDirection::LeftToRight)
}

fn exact_shape(clusters: &[(u32, u32, f32)], direction: RunShapeDirection) -> RunShape {
    RunShape::exact(
        RunShapeProvenance::single([1; 8]),
        direction,
        clusters
            .iter()
            .map(|(logical_start, logical_end, advance)| RunShapeCluster {
                logical_start: *logical_start,
                logical_end: *logical_end,
                advance: *advance,
            })
            .map(|cluster| f64::from(cluster.advance))
            .sum(),
        clusters
            .iter()
            .map(|(logical_start, logical_end, advance)| RunShapeCluster {
                logical_start: *logical_start,
                logical_end: *logical_end,
                advance: *advance,
            })
            .collect(),
    )
}

fn address(
    page_index: usize,
    block_index: usize,
    line_index: usize,
    run_index: usize,
    char_index: usize,
    affinity: TextCaretAffinity,
) -> TextCaretAddress {
    TextCaretAddress {
        page_index,
        block_index,
        line_index,
        run_index,
        char_index,
        affinity,
    }
}
