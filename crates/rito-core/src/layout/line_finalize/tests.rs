use std::num::NonZeroUsize;

use serde_json::{json, Map, Value};

use super::{finalize_line_eager, LineWidthMetric, PendingLineFinalizer};
use crate::layout::{
    line::{LineRun, TextRunBox},
    line_align::apply_line_align,
    paint::RunPaint,
    text_mapping::RunTextMapping,
    text_shape::fixture_run_shape,
    text_work::{TextWorkBudget, TextWorkMeter, TextWorkYield},
};

#[test]
fn one_unit_quanta_match_eager_geometry_shift_and_align_without_partial_output() {
    let runs = vec![
        text_run("base", 1.0, 0.0, json!({}), None, None),
        text_run("raised", 21.0, -4.0, json!({}), Some("注"), None),
        text_run("tail", 51.0, 1.0, json!({}), None, None),
    ];
    let style = Map::from_iter([("textAlign".to_owned(), Value::String("center".to_owned()))]);
    let expected = finalize_line_eager(
        runs.clone(),
        LineWidthMetric::AdvanceRight,
        7.0,
        12.0,
        100.0,
        &style,
        false,
    );
    let mut pending =
        PendingLineFinalizer::new(runs, LineWidthMetric::AdvanceRight, 7.0, 12.0, 100.0, false);
    let mut yields = 0;

    let actual = loop {
        let mut work = meter(1, 1);
        match pending.advance(&mut work, &style) {
            Ok(line) => break line,
            Err(TextWorkYield) => yields += 1,
        }
    };

    assert!(yields >= 5);
    assert_eq!(actual, expected);
}

#[test]
fn ruby_extraction_quanta_match_eager_finalization() {
    let runs = vec![
        text_run("first", 0.0, 0.0, json!({}), Some("same"), None),
        text_run("second", 30.0, 0.0, json!({}), Some("same"), None),
        text_run("third", 60.0, 0.0, json!({}), Some("other"), None),
        text_run("plain", 90.0, 0.0, json!({}), None, None),
    ];
    let style = Map::new();
    let expected = finalize_line_eager(
        runs.clone(),
        LineWidthMetric::AdvanceRight,
        5.0,
        12.0,
        140.0,
        &style,
        false,
    );

    for quantum in [1, 2, 3, usize::MAX] {
        let mut pending = PendingLineFinalizer::new(
            runs.clone(),
            LineWidthMetric::AdvanceRight,
            5.0,
            12.0,
            140.0,
            false,
        );
        let mut yields = 0;
        let actual = loop {
            let mut work = meter(quantum, quantum);
            match pending.advance(&mut work, &style) {
                Ok(line) => break line,
                Err(TextWorkYield) => yields += 1,
            }
        };

        assert_eq!(actual, expected, "quantum={quantum}");
        assert_eq!(yields, (runs.len() * 4 - 1) / quantum, "quantum={quantum}");
    }
}

#[test]
fn ruby_extraction_does_not_publish_before_every_run_is_processed() {
    let runs = vec![
        text_run("first", 0.0, 0.0, json!({}), Some("group"), None),
        text_run("second", 30.0, 0.0, json!({}), Some("group"), None),
        text_run("third", 60.0, 0.0, json!({}), Some("group"), None),
    ];
    let style = Map::new();
    let expected = finalize_line_eager(
        runs.clone(),
        LineWidthMetric::AdvanceRight,
        0.0,
        12.0,
        100.0,
        &style,
        false,
    );
    let mut pending =
        PendingLineFinalizer::new(runs, LineWidthMetric::AdvanceRight, 0.0, 12.0, 100.0, false);

    assert_eq!(
        pending.advance(&mut meter(6, 1), &style),
        Err(TextWorkYield)
    );
    assert!(pending.is_extracting_ruby());
    for _ in 0..5 {
        assert_eq!(
            pending.advance(&mut meter(1, 1), &style),
            Err(TextWorkYield)
        );
        assert!(pending.is_extracting_ruby());
    }

    let actual = pending
        .advance(&mut meter(1, 1), &style)
        .expect("the line publishes only after its final run is extracted");
    assert_eq!(actual, expected);
}

#[test]
fn width_metric_preserves_greedy_extensions_and_optimal_paint_bounds() {
    let run = text_run(
        "end",
        1.0,
        0.0,
        json!({
            "padding": { "right": 10 },
            "border": {
                "end": { "widthPx": 2, "paint": { "color": "#000", "style": "solid" } }
            }
        }),
        None,
        Some(5.0),
    );
    let style = Map::from_iter([("textAlign".to_owned(), Value::String("center".to_owned()))]);

    let greedy = finalize_line_eager(
        vec![run.clone()],
        LineWidthMetric::AdvanceRight,
        0.0,
        12.0,
        100.0,
        &style,
        false,
    );
    let optimal = finalize_line_eager(
        vec![run],
        LineWidthMetric::Right,
        0.0,
        12.0,
        100.0,
        &style,
        false,
    );

    assert_eq!(greedy.runs[0].geometry().0, 27.0);
    assert_eq!(optimal.runs[0].geometry().0, 35.5);
}

#[test]
fn center_and_right_one_unit_quanta_match_the_legacy_alignment_oracle() {
    for (align, expected_first_x) in [("center", 20.5), ("right", 40.0)] {
        let runs = vec![
            text_run("first", 1.0, 0.0, json!({}), None, None),
            text_run("second", 31.0, 0.0, json!({}), None, None),
        ];
        let style = Map::from_iter([("textAlign".to_owned(), Value::String(align.to_owned()))]);
        let expected = apply_line_align(runs.clone(), 61.0, 7.0, 12.0, 100.0, &style, false);
        let mut pending =
            PendingLineFinalizer::new(runs, LineWidthMetric::AdvanceRight, 7.0, 12.0, 100.0, false);
        let mut yields = 0;

        let actual = loop {
            let mut work = meter(1, 1);
            match pending.advance(&mut work, &style) {
                Ok(line) => break line,
                Err(TextWorkYield) => yields += 1,
            }
        };

        assert_eq!(yields, 5, "alignment {align}");
        assert_eq!(actual, expected, "alignment {align}");
        assert_eq!(actual.runs[0].geometry().0, expected_first_x);
    }
}

#[test]
fn word_and_inter_character_justification_match_the_legacy_oracle() {
    for (text_justify, runs) in [
        (
            "auto",
            vec![
                text_run("a b", 0.0, 0.0, json!({}), None, None),
                text_run(" c", 30.0, 0.0, json!({}), None, None),
            ],
        ),
        (
            "inter-character",
            vec![
                text_run("中A", 0.0, 0.0, json!({}), None, None),
                text_run("文", 30.0, 0.0, json!({}), None, None),
            ],
        ),
    ] {
        let style = Map::from_iter([
            ("textAlign".to_owned(), Value::String("justify".to_owned())),
            (
                "textJustify".to_owned(),
                Value::String(text_justify.to_owned()),
            ),
        ]);
        let expected = apply_line_align(runs.clone(), 60.0, 0.0, 12.0, 100.0, &style, false);

        let actual = finalize_line_eager(
            runs,
            LineWidthMetric::AdvanceRight,
            0.0,
            12.0,
            100.0,
            &style,
            false,
        );

        assert_eq!(actual, expected, "textJustify={text_justify}");
    }
}

#[test]
fn last_or_forced_line_skips_justify_analysis() {
    let runs = vec![text_run("中文", 0.0, 0.0, json!({}), None, None)];
    let style = Map::from_iter([
        ("textAlign".to_owned(), Value::String("justify".to_owned())),
        (
            "textJustify".to_owned(),
            Value::String("inter-character".to_owned()),
        ),
    ]);
    let expected = apply_line_align(runs.clone(), 30.0, 0.0, 12.0, 100.0, &style, true);
    let mut pending =
        PendingLineFinalizer::new(runs, LineWidthMetric::AdvanceRight, 0.0, 12.0, 100.0, true);
    let mut work = meter(2, 1);

    let actual = pending
        .advance(&mut work, &style)
        .expect("last lines skip justify analysis but still extract ruby runs");

    assert!(!pending.is_analyzing_justify());
    assert_eq!(actual, expected);
}

#[test]
fn zero_horizontal_offset_does_not_consume_run_work() {
    for align in ["center", "right"] {
        let style = Map::from_iter([("textAlign".to_owned(), Value::String(align.to_owned()))]);
        let mut pending = PendingLineFinalizer::new(
            vec![text_run("exact", 0.0, 0.0, json!({}), None, None)],
            LineWidthMetric::AdvanceRight,
            0.0,
            12.0,
            30.0,
            false,
        );
        let mut work = meter(2, 1);

        let line = pending
            .advance(&mut work, &style)
            .expect("zero offset skips shifting but still extracts ruby runs");

        assert_eq!(line.runs[0].geometry().0, 0.0);
    }
}

#[test]
fn empty_line_finalization_uses_no_character_work() {
    let style = Map::new();
    let mut pending = PendingLineFinalizer::new(
        Vec::new(),
        LineWidthMetric::AdvanceRight,
        3.0,
        14.0,
        80.0,
        true,
    );
    let mut work = meter(1, 1);
    assert_eq!(work.take_utf16_units(1), 1);

    let line = pending
        .advance(&mut work, &style)
        .expect("empty finalization does not scan runs");

    assert_eq!((line.y, line.width, line.height), (3.0, 80.0, 14.0));
    assert!(line.runs.is_empty());
}

fn text_run(
    text: &str,
    x: f64,
    y: f64,
    paint: Value,
    ruby_annotation: Option<&str>,
    inline_margin_right: Option<f64>,
) -> LineRun {
    LineRun::Text(TextRunBox {
        text: text.to_owned(),
        text_mapping: RunTextMapping::synthetic(),
        x,
        y,
        width: 30.0,
        height: 12.0,
        font_size: 10.0,
        interaction_geometry: None,
        paint: RunPaint::from_test_wire_value(paint),
        line_height_px: None,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        inline_margin_right,
        ruby_annotation: ruby_annotation.map(str::to_owned),
        shape: fixture_run_shape(30.0),
    })
}

fn meter(max_utf16_units: usize, max_atomic_operations: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(max_utf16_units).expect("text limit is non-zero"),
        NonZeroUsize::new(max_atomic_operations).expect("operation limit is non-zero"),
    ))
}
