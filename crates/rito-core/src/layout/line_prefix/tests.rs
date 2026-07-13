use std::{collections::BTreeMap, path::Path, sync::Arc};

use serde_json::{json, Map, Value};

use super::{
    find_fitting_prefix, prefix_probe_stats, reset_prefix_probe_stats, try_find_fitting_prefix,
    FittingPrefix, PrefixProbeStats,
};
use crate::layout::{
    inline_segment::{InlineSegment, TextSegment},
    line::LineRun,
    line_break::{utf16_len, Utf16Text},
    line_layout::{layout_greedy_lines, layout_greedy_lines_with_fonts},
    text_mapping::TextSegmentMapping,
    text_measure::{TextMeasurementCache, TextMeasurementFontFace, TextMeasurementFonts},
    text_work_trace::{capture_text_work_trace, AtomicTextOperationKind, TextWorkEvent},
};

fn text_segment(text: String, style: Map<String, Value>) -> InlineSegment {
    InlineSegment::Text(TextSegment {
        text,
        mapping: TextSegmentMapping::synthetic(),
        style,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    })
}

#[test]
fn non_finite_width_keeps_the_legacy_comparison_semantics() {
    let source = "x".repeat(300);
    let text = Utf16Text::new(&source);

    let fitting = find_fitting_prefix(&text, 0, text.len, f64::NAN, true, &mut |end| end as f64);

    assert_eq!(fitting.position, 0);
    assert_eq!(fitting.forward_end, text.len);
}

#[test]
fn fallible_prefix_search_preserves_the_infallible_endpoint_order() {
    let source = "x".repeat(300);
    let text = Utf16Text::new(&source);
    let mut infallible_endpoints = Vec::new();
    let infallible = find_fitting_prefix(&text, 0, text.len, 73.0, true, &mut |end| {
        infallible_endpoints.push(end);
        end as f64
    });
    let mut fallible_endpoints = Vec::new();
    let fallible = try_find_fitting_prefix(&text, 0, text.len, 73.0, true, &mut |end| {
        fallible_endpoints.push(end);
        Ok::<f64, ()>(end as f64)
    })
    .expect("successful fallible search");

    assert_eq!(fallible, infallible);
    assert_eq!(
        fallible,
        FittingPrefix {
            position: 73,
            forward_end: 128,
        }
    );
    assert_eq!(
        fallible_endpoints,
        [1, 2, 4, 8, 16, 32, 64, 128, 96, 80, 72, 76, 74, 73]
    );
    assert_eq!(fallible_endpoints, infallible_endpoints);
}

#[test]
fn failed_prefix_search_stops_at_the_endpoint_and_replays_from_cached_widths() {
    const FAILED_ENDPOINT: usize = 96;
    let source = "x".repeat(300);
    let text = Utf16Text::new(&source);
    let mut cached_widths = BTreeMap::new();
    let mut first_endpoints = Vec::new();
    let first = try_find_fitting_prefix(&text, 0, text.len, 73.0, true, &mut |end| {
        first_endpoints.push(end);
        if end == FAILED_ENDPOINT {
            return Err(end);
        }
        let width = end as f64;
        cached_widths.insert(end, width);
        Ok(width)
    });

    assert_eq!(first, Err(FAILED_ENDPOINT));
    assert_eq!(
        first_endpoints,
        [1, 2, 4, 8, 16, 32, 64, 128, FAILED_ENDPOINT]
    );

    let mut replay_endpoints = Vec::new();
    let mut replay_misses = Vec::new();
    let replayed = try_find_fitting_prefix(&text, 0, text.len, 73.0, true, &mut |end| {
        replay_endpoints.push(end);
        if let Some(width) = cached_widths.get(&end) {
            return Ok::<f64, usize>(*width);
        }
        replay_misses.push(end);
        let width = end as f64;
        cached_widths.insert(end, width);
        Ok(width)
    })
    .expect("cached replay succeeds");

    assert_eq!(
        replayed,
        FittingPrefix {
            position: 73,
            forward_end: 128,
        }
    );
    assert_eq!(
        replay_endpoints,
        [1, 2, 4, 8, 16, 32, 64, 128, 96, 80, 72, 76, 74, 73]
    );
    assert_eq!(replay_misses, [96, 80, 72, 76, 74, 73]);
}

#[test]
fn short_paragraph_keeps_the_whole_suffix_probe() {
    let text = "short paragraph ".repeat(10);
    let style = Map::from_iter([
        ("fontSize".to_owned(), json!(10)),
        ("lineHeight".to_owned(), json!(1.2)),
    ]);
    reset_prefix_probe_stats();

    let lines = layout_greedy_lines(&[text_segment(text.clone(), style)], 2_000.0);

    let stats = prefix_probe_stats();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].text(), text.trim_end());
    assert_eq!(stats.calls, 1);
    assert_eq!(stats.max_probe_units, utf16_len(&text));
}

#[test]
fn negative_spacing_retains_the_legacy_whole_suffix_result() {
    let text = "abcdef".repeat(50);
    let style = Map::from_iter([
        ("fontSize".to_owned(), json!(10)),
        ("lineHeight".to_owned(), json!(1.2)),
        ("letterSpacing".to_owned(), json!(-10)),
    ]);
    reset_prefix_probe_stats();

    let lines = layout_greedy_lines(&[text_segment(text.clone(), style)], 1.0);

    let stats = prefix_probe_stats();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].text(), text);
    assert_eq!(stats.calls, 1);
    assert_eq!(stats.max_probe_units, utf16_len(&text));
}

#[test]
fn negative_glyph_pair_cannot_be_hidden_by_positive_letter_spacing() {
    let text = "ab".repeat(150);
    let style = Map::from_iter([
        ("fontSize".to_owned(), json!(1)),
        ("lineHeight".to_owned(), json!(1.2)),
        ("letterSpacing".to_owned(), json!(1e16)),
    ]);
    let fonts = TextMeasurementFonts::new_with_cache(
        Vec::new(),
        TextMeasurementCache::default(),
        BTreeMap::from([('a', 1.0), ('b', 1.0)]),
        BTreeMap::new(),
        BTreeMap::from([(('a', 'b'), -1e16)]),
        BTreeMap::new(),
    );
    reset_prefix_probe_stats();

    let lines =
        layout_greedy_lines_with_fonts(&[text_segment(text.clone(), style)], f64::MAX, &fonts);

    let stats = prefix_probe_stats();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].text(), text);
    assert_eq!(stats.calls, 1);
    assert_eq!(stats.max_probe_units, utf16_len(&text));
}

#[test]
fn font_aware_long_unicode_paragraph_uses_bounded_prefix_probes() {
    const TEXT_UNITS: usize = 100_000;
    const SOURCE_OFFSET: usize = 17;
    let text = "猫".repeat(TEXT_UNITS);
    let style = Map::from_iter([
        ("fontSize".to_owned(), json!(10)),
        ("lineHeight".to_owned(), json!(1.2)),
        ("language".to_owned(), Value::String("zh-CN".to_owned())),
    ]);
    let segment = InlineSegment::Text(TextSegment {
        text: text.clone(),
        mapping: TextSegmentMapping::synthetic(),
        style,
        href: None,
        source_path: Some(vec![4, 2]),
        source_text: Some("source".into()),
        source_text_offset: Some(SOURCE_OFFSET),
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    });
    let fonts = TextMeasurementFonts::font_aware_empty();
    reset_prefix_probe_stats();

    let lines = layout_greedy_lines_with_fonts(&[segment], 600.0, &fonts);

    let stats = prefix_probe_stats();
    assert_long_paragraph_output(&lines, &text);
    assert_eq!(
        stats,
        PrefixProbeStats {
            calls: 19_982,
            utf16_units: 690_416,
            max_probe_units: 220,
        }
    );
}

fn assert_long_paragraph_output(lines: &[crate::layout::line::LineBox], text: &str) {
    const TEXT_UNITS: usize = 100_000;
    const UNITS_PER_LINE: usize = 60;
    const SOURCE_OFFSET: usize = 17;
    assert_eq!(lines.len(), TEXT_UNITS.div_ceil(UNITS_PER_LINE));
    assert_eq!(
        lines.iter().map(|line| line.text()).collect::<String>(),
        text
    );
    for (index, line) in lines.iter().enumerate() {
        let [LineRun::Text(run)] = line.runs.as_slice() else {
            panic!("expected one text run per line");
        };
        let expected_units = UNITS_PER_LINE.min(TEXT_UNITS - index * UNITS_PER_LINE);
        assert_eq!(utf16_len(&run.text), expected_units);
        assert_eq!(run.source_path.as_deref(), Some([4, 2].as_slice()));
        assert_eq!(
            run.source_text_offset,
            Some(SOURCE_OFFSET + index * UNITS_PER_LINE)
        );
    }
}

#[test]
fn wrapped_greedy_runs_keep_utf16_source_offsets_and_share_source_text() {
    const SOURCE_OFFSET: usize = 23;
    let text = "甲𠮷乙丙丁戊己庚辛壬癸".repeat(30);
    let source_text: Arc<str> = text.clone().into();
    let style = Map::from_iter([
        ("fontSize".to_owned(), json!(10)),
        ("lineHeight".to_owned(), json!(1.2)),
        ("language".to_owned(), Value::String("zh-CN".to_owned())),
    ]);
    let segment = InlineSegment::Text(TextSegment {
        text: text.clone(),
        mapping: TextSegmentMapping::synthetic(),
        style,
        href: None,
        source_path: Some(vec![3, 1]),
        source_text: Some(Arc::clone(&source_text)),
        source_text_offset: Some(SOURCE_OFFSET),
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    });

    reset_prefix_probe_stats();
    let lines = layout_greedy_lines(&[segment], 30.0);

    let stats = prefix_probe_stats();
    assert_eq!(
        lines.iter().map(|line| line.text()).collect::<String>(),
        text
    );
    let mut consumed_units = 0;
    for line in &lines {
        let [LineRun::Text(run)] = line.runs.as_slice() else {
            panic!("expected one text run per line");
        };
        assert_eq!(run.source_path.as_deref(), Some([3, 1].as_slice()));
        assert_eq!(run.source_text.as_deref(), Some(text.as_str()));
        assert!(Arc::ptr_eq(
            run.source_text.as_ref().expect("source text"),
            &source_text
        ));
        assert_eq!(run.source_text_offset, Some(SOURCE_OFFSET + consumed_units));
        consumed_units += utf16_len(&run.text);
    }
    assert_eq!(consumed_units, utf16_len(&text));
    assert_eq!(stats.max_probe_units, utf16_len(&text));
}

#[test]
fn passive_text_work_trace_preserves_exact_lines_and_classifies_atomic_work() {
    const TEXT_UNITS: usize = 320;
    let text = "猫".repeat(TEXT_UNITS);
    let style = Map::from_iter([
        ("fontSize".to_owned(), json!(10)),
        ("lineHeight".to_owned(), json!(1.2)),
        ("language".to_owned(), Value::String("zh-CN".to_owned())),
    ]);
    let without_trace = layout_greedy_lines(&[text_segment(text.clone(), style.clone())], 60.0);

    reset_prefix_probe_stats();
    let (with_trace, trace) =
        capture_text_work_trace(|| layout_greedy_lines(&[text_segment(text, style)], 60.0));
    let prefix_stats = prefix_probe_stats();

    assert_eq!(with_trace, without_trace);
    assert_eq!(trace.line_break_scans.len(), 1);
    assert_eq!(trace.line_break_scans[0].utf16_units, TEXT_UNITS);
    assert_eq!(trace.line_break_scans[0].boundary_count, TEXT_UNITS);
    assert!(trace.line_break_scans[0].break_opportunity_count > 0);
    assert_eq!(trace.prefix_probes.len(), prefix_stats.calls);
    assert_eq!(
        trace
            .prefix_probes
            .iter()
            .map(|probe| probe.utf16_units())
            .sum::<usize>(),
        prefix_stats.utf16_units
    );
    assert_eq!(
        trace
            .prefix_probes
            .iter()
            .map(|probe| probe.utf16_units())
            .max(),
        Some(prefix_stats.max_probe_units)
    );
    assert!(trace
        .prefix_probes
        .iter()
        .any(|probe| probe.start_utf16 > 0));
    assert_eq!(
        trace.max_request_utf16_units(AtomicTextOperationKind::MeasureRequest),
        250
    );
    assert_eq!(
        trace.max_request_utf16_units(AtomicTextOperationKind::ShapeRequest),
        10
    );
    let oversized = trace.oversized_atomic_operations(64);
    assert!(oversized.iter().any(|operation| {
        operation.kind == AtomicTextOperationKind::LineBreakScan
            && operation.utf16_units == TEXT_UNITS
    }));
    assert!(oversized.iter().any(|operation| {
        operation.kind == AtomicTextOperationKind::MeasureRequest && operation.utf16_units == 250
    }));
    assert!(oversized.iter().all(|operation| {
        matches!(
            operation.kind,
            AtomicTextOperationKind::LineBreakScan | AtomicTextOperationKind::MeasureRequest
        )
    }));
}

#[test]
fn passive_trace_preserves_real_font_lines_field_for_field() {
    let font_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/reader/src/assets/fonts/Tinos-Regular.ttf");
    let bytes = std::fs::read(font_path).expect("read the pinned test font");
    let make_fonts = || {
        TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
            "Tinos".to_owned(),
            None,
            None,
            &bytes,
        )])
    };
    let text = "office affinity AVATAR cafe\u{301} ffi ".repeat(12);
    let style = Map::from_iter([
        ("fontSize".to_owned(), json!(14)),
        ("lineHeight".to_owned(), json!(1.4)),
        ("fontFamily".to_owned(), Value::String("Tinos".to_owned())),
    ]);
    let segments = [text_segment(text, style)];
    let expected = layout_greedy_lines_with_fonts(&segments, 150.0, &make_fonts());

    let (actual, trace) =
        capture_text_work_trace(|| layout_greedy_lines_with_fonts(&segments, 150.0, &make_fonts()));

    assert_eq!(actual, expected);
    assert!(!trace.rustybuzz_shape_runs.is_empty());
    assert!(trace.events.windows(2).any(|events| matches!(
        events,
        [
            TextWorkEvent::TextRequest(_),
            TextWorkEvent::MeasurementCache(_),
        ]
    )));
}
