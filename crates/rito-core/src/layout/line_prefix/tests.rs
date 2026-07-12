use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::{find_fitting_prefix, prefix_probe_stats, reset_prefix_probe_stats, PrefixProbeStats};
use crate::layout::{
    inline_segment::{InlineSegment, TextSegment},
    line::LineRun,
    line_break::{utf16_len, Utf16Text},
    line_layout::{layout_greedy_lines, layout_greedy_lines_with_fonts},
    text_mapping::TextSegmentMapping,
    text_measure::{TextMeasurementCache, TextMeasurementFonts},
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
        source_text: Some("source".to_owned()),
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
fn astral_unicode_runs_keep_utf16_source_offsets() {
    const SOURCE_OFFSET: usize = 23;
    let text = "甲𠮷乙丙丁戊己庚辛壬癸".repeat(30);
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
        source_text: Some(text.clone()),
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
        assert_eq!(run.source_text_offset, Some(SOURCE_OFFSET + consumed_units));
        consumed_units += utf16_len(&run.text);
    }
    assert_eq!(consumed_units, utf16_len(&text));
    assert_eq!(stats.max_probe_units, utf16_len(&text));
}
