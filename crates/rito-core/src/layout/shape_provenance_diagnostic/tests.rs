use serde_json::json;

use super::{summarize_shape_provenance, MAX_AFFECTED_CODEPOINTS};
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, RubyRunBox, TextRunBox},
    page::RuntimePage,
    text_shape::{
        RunShape, RunShapeCluster, RunShapeDirection, RunShapeFaceSpan, RunShapeProvenance,
        RunShapeUnavailableReason,
    },
};

#[test]
fn summarizes_exact_unavailable_fonts_reasons_and_affected_scalars() {
    let runs = vec![
        text_run("A", exact_single([1; 8])),
        text_run("B", exact_mixed()),
        text_run(
            "AA😀",
            RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 4.0),
        ),
        text_run(
            "-",
            RunShape::unavailable(RunShapeUnavailableReason::SyntheticLayoutText, 1.0),
        ),
    ];

    let stats = summarize_shape_provenance(&[page(runs)]);

    assert_eq!((stats.total_text_runs, stats.exact_text_runs), (4, 2));
    assert_eq!(stats.unavailable_text_runs, 2);
    assert_eq!(stats.total_text_utf16_code_unit_count, 7);
    assert_eq!(stats.exact_text_utf16_code_unit_count, 2);
    assert_eq!(stats.unavailable_text_utf16_code_unit_count, 5);
    assert_eq!(stats.excluded_ruby_text_run_count, 0);
    assert_eq!(stats.excluded_ruby_text_utf16_code_unit_count, 0);
    assert_eq!(
        (stats.single_font_text_runs, stats.mixed_font_text_runs),
        (1, 1)
    );
    assert_eq!(stats.unavailable_reason_counts["hostMetricsFallback"], 1);
    assert_eq!(stats.unavailable_reason_counts["syntheticLayoutText"], 1);
    assert_eq!(
        stats.unavailable_reason_utf16_code_unit_counts["hostMetricsFallback"],
        4
    );
    assert_eq!(
        stats.unavailable_reason_utf16_code_unit_counts["syntheticLayoutText"],
        1
    );
    assert_eq!(stats.single_font_fingerprints["0101010101010101"], 1);
    assert_eq!(stats.mixed_font_fingerprints.len(), 2);
    assert_eq!(
        stats
            .unavailable_affected_codepoints
            .iter()
            .map(|entry| (entry.codepoint, entry.count))
            .collect::<Vec<_>>(),
        [
            (u32::from('A'), 2),
            (u32::from('-'), 1),
            (u32::from('😀'), 1)
        ]
    );
    assert_eq!(
        stats.unavailable_affected_codepoints[0].reason_counts["hostMetricsFallback"],
        2
    );
    assert_eq!(
        stats.unavailable_affected_codepoints[1].reason_counts["syntheticLayoutText"],
        1
    );
    assert_eq!(stats.unavailable_affected_codepoint_occurrences, 4);
    assert_eq!(stats.unavailable_affected_codepoint_distinct, 3);
    assert_eq!(stats.unavailable_affected_codepoint_omitted, 0);
}

#[test]
fn reports_ruby_annotation_text_as_explicitly_excluded() {
    let stats = summarize_shape_provenance(&[page(vec![
        text_run("base😀", exact_single([1; 8])),
        ruby_run("注😀"),
    ])]);

    assert_eq!(stats.total_text_runs, 1);
    assert_eq!(stats.exact_text_runs, 1);
    assert_eq!(stats.total_text_utf16_code_unit_count, 6);
    assert_eq!(stats.exact_text_utf16_code_unit_count, 6);
    assert_eq!(stats.unavailable_text_utf16_code_unit_count, 0);
    assert_eq!(stats.excluded_ruby_text_run_count, 1);
    assert_eq!(stats.excluded_ruby_text_utf16_code_unit_count, 3);
}

#[test]
fn caps_affected_codepoints_with_stable_count_then_codepoint_order() {
    let text = (0..300)
        .map(|offset| char::from_u32(0x1000 + offset).expect("test scalar"))
        .collect::<String>();
    let stats = summarize_shape_provenance(&[page(vec![text_run(
        &text,
        RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 1.0),
    )])]);

    assert_eq!(
        stats.unavailable_affected_codepoints.len(),
        MAX_AFFECTED_CODEPOINTS
    );
    assert_eq!(stats.unavailable_affected_codepoint_distinct, 300);
    assert_eq!(stats.unavailable_affected_codepoint_omitted, 44);
    assert_eq!(stats.unavailable_affected_codepoint_occurrences, 300);
    assert_eq!(stats.unavailable_affected_codepoints[0].codepoint, 0x1000);
    assert_eq!(stats.unavailable_affected_codepoints[0].count, 1);
    assert_eq!(
        stats.unavailable_affected_codepoints[MAX_AFFECTED_CODEPOINTS - 1].codepoint,
        0x10ff
    );
}

fn exact_single(fingerprint: [u8; 8]) -> RunShape {
    RunShape::exact(
        RunShapeProvenance::single(fingerprint),
        RunShapeDirection::LeftToRight,
        1.0,
        vec![RunShapeCluster {
            logical_start: 0,
            logical_end: 1,
            advance: 1.0,
        }],
    )
}

fn exact_mixed() -> RunShape {
    RunShape::exact(
        RunShapeProvenance::mixed(
            vec![[2; 8], [3; 8]],
            vec![
                RunShapeFaceSpan {
                    logical_start: 0,
                    logical_end: 1,
                    font_index: 0,
                },
                RunShapeFaceSpan {
                    logical_start: 1,
                    logical_end: 2,
                    font_index: 1,
                },
            ],
        ),
        RunShapeDirection::LeftToRight,
        1.0,
        vec![RunShapeCluster {
            logical_start: 0,
            logical_end: 1,
            advance: 1.0,
        }],
    )
}

fn page(runs: Vec<LineRun>) -> crate::layout::LayoutRuntimePage {
    let line = RuntimeChild::Line(LineBox {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        runs,
    });
    let nested = RuntimeBlock {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        semantic_tag: None,
        anchor_id: None,
        paint: None,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: vec![line],
    };
    RuntimePage::new(
        0,
        100.0,
        100.0,
        None,
        vec![RuntimeBlock {
            children: vec![RuntimeChild::Block(Box::new(nested))],
            ..empty_block()
        }],
    )
}

fn empty_block() -> RuntimeBlock<LineBox> {
    RuntimeBlock {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        semantic_tag: None,
        anchor_id: None,
        paint: None,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: Vec::new(),
    }
}

fn text_run(text: &str, shape: RunShape) -> LineRun {
    LineRun::Text(TextRunBox {
        text: text.to_owned(),
        text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
        x: 0.0,
        y: 0.0,
        width: 1.0,
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

fn ruby_run(text: &str) -> LineRun {
    LineRun::Ruby(RubyRunBox {
        text: text.to_owned(),
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 8.0,
        paint: json!({}),
    })
}
