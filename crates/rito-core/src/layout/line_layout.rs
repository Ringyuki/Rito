use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, OnceLock},
};

use serde_json::{Map, Value};

use super::{
    inline_segment::{AtomSegment, InlineSegment},
    line::{
        AtomRunBox, LineBox, LineRun, RunSourceProvenance, TextRunBox, TextRunInteractionGeometry,
    },
    line_break::{utf16_len, LineBreakOptions, Utf16Text},
    line_metrics::{line_height_px, measure_text_slice_with_fonts, vertical_align_offset},
    line_prefix::should_probe_bounded,
    style_values::{border_width, number_style, run_paint_from_style, string_style},
    text_mapping::RunTextMapping,
    text_measure::{shape_text_with_style, TextMeasurementFonts, TextMeasurementStyle},
    text_shape::RunShape,
};

mod context_builder;
mod resumable_break;
mod session;

pub(crate) use context_builder::PendingLineContextBuilder;
pub(crate) use session::GreedyLineLayoutSession;

#[derive(Debug, PartialEq)]
pub(crate) struct LineContext {
    text: Utf16Text<'static>,
    ranges: Vec<LineStyleRange>,
    atoms: BTreeMap<usize, LineAtom>,
    max_width: f64,
    line_height: f64,
    preserve_ws: bool,
    allow_wrap: bool,
    line_break_options: LineBreakOptions,
    break_offsets: OnceLock<BTreeSet<usize>>,
    base_style: Map<String, Value>,
    monotonic_prefix_widths: bool,
    initially_complete: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct LineStyleRange {
    start: usize,
    end: usize,
    style: Map<String, Value>,
    href: Option<String>,
    source_path: Option<Vec<usize>>,
    source_text: Option<Arc<str>>,
    source_text_offset: Option<usize>,
    ruby_annotation: Option<String>,
    inline_margin_left: Option<f64>,
    inline_margin_right: Option<f64>,
    border_start: bool,
    border_end: bool,
    text_mapping: RunTextMapping,
}

#[derive(Debug, Clone, PartialEq)]
struct LineAtom {
    width: f64,
    height: f64,
    style: Map<String, Value>,
    image_src: Option<String>,
    alt: Option<String>,
    href: Option<String>,
}

#[cfg(test)]
pub(crate) fn layout_greedy_lines(segments: &[InlineSegment], max_width: f64) -> Vec<LineBox> {
    layout_greedy_lines_with_fonts(segments, max_width, &TextMeasurementFonts::empty())
}

pub(crate) fn layout_greedy_lines_with_fonts<'a>(
    segments: &[InlineSegment],
    max_width: f64,
    fonts: &'a TextMeasurementFonts<'a>,
) -> Vec<LineBox> {
    let mut session = GreedyLineLayoutSession::new(segments, max_width, fonts);
    let mut lines = Vec::new();
    while !session.is_complete() {
        lines.extend(session.advance(usize::MAX, fonts));
    }
    lines
}

fn build_line_context(
    segments: &[InlineSegment],
    base_style: Map<String, Value>,
    max_width: f64,
    fonts: &TextMeasurementFonts<'_>,
) -> LineContext {
    let mut text_parts = Vec::new();
    let mut ranges = Vec::new();
    let mut atoms = BTreeMap::new();
    let mut offset = 0usize;

    for segment in segments {
        match segment {
            InlineSegment::Atom(atom) => {
                text_parts.push("\u{fffc}".to_owned());
                atoms.insert(offset, line_atom(atom));
                ranges.push(LineStyleRange {
                    start: offset,
                    end: offset + 1,
                    style: atom.style.clone(),
                    href: None,
                    source_path: None,
                    source_text: None,
                    source_text_offset: None,
                    ruby_annotation: None,
                    inline_margin_left: None,
                    inline_margin_right: None,
                    border_start: false,
                    border_end: false,
                    text_mapping: RunTextMapping::synthetic(),
                });
                offset += 1;
            }
            InlineSegment::Text(text) => {
                text_parts.push(text.text.clone());
                if text.text.is_empty() {
                    continue;
                }
                let end = offset + utf16_len(&text.text);
                ranges.push(LineStyleRange {
                    start: offset,
                    end,
                    style: text.style.clone(),
                    href: text.href.clone(),
                    source_path: text.source_path.clone(),
                    source_text: text.source_text.clone(),
                    source_text_offset: text.source_text_offset,
                    ruby_annotation: text.ruby_annotation.clone(),
                    inline_margin_left: text.inline_margin_left,
                    inline_margin_right: text.inline_margin_right,
                    border_start: text.border_start,
                    border_end: text.border_end,
                    text_mapping: text.run_text_mapping(0, utf16_len(&text.text)),
                });
                offset = end;
            }
        }
    }

    let full_text = text_parts.join("");
    let monotonic_prefix_widths =
        should_probe_bounded(offset) && has_monotonic_prefix_widths(segments, &base_style, fonts);
    let line_height = line_height_px(&base_style);
    let line_break_options = LineBreakOptions::from_style(
        string_style(&base_style, "lineBreak").as_deref(),
        string_style(&base_style, "wordBreak").as_deref(),
        string_style(&base_style, "language").as_deref(),
    );
    let initially_complete =
        full_text.trim().is_empty() && !full_text.contains('\n') && atoms.is_empty();
    LineContext {
        text: Utf16Text::new_owned(full_text),
        ranges,
        atoms,
        max_width,
        line_height,
        preserve_ws: matches!(
            string_style(&base_style, "whiteSpace").as_deref(),
            Some("pre" | "pre-wrap")
        ),
        allow_wrap: !matches!(
            string_style(&base_style, "whiteSpace").as_deref(),
            Some("pre" | "nowrap")
        ),
        line_break_options,
        break_offsets: OnceLock::new(),
        base_style,
        monotonic_prefix_widths,
        initially_complete,
    }
}

fn line_atom(segment: &AtomSegment) -> LineAtom {
    LineAtom {
        width: segment.width,
        height: segment.height,
        style: segment.style.clone(),
        image_src: segment.image_src.clone(),
        alt: segment.alt.clone(),
        href: segment.href.clone(),
    }
}

struct SingleLineLayout {
    runs: Vec<LineRun>,
    next_pos: usize,
    ends_with_forced_break: bool,
}

#[derive(Debug, Clone, Copy)]
struct LineBreakPosition {
    position: usize,
    hyphenated: bool,
}

fn has_monotonic_prefix_widths(
    segments: &[InlineSegment],
    base_style: &Map<String, Value>,
    fonts: &TextMeasurementFonts<'_>,
) -> bool {
    // Shaping can re-form earlier glyphs, and the legacy UTF-16 binary search
    // has observable midpoint behavior around surrogate pairs. Keep either
    // case on the exact legacy path unless equivalence can be proved.
    monotonic_measure_style(base_style)
        && segments.iter().all(|segment| match segment {
            InlineSegment::Atom(atom) => nonnegative(atom.width),
            InlineSegment::Text(text) => {
                text.text
                    .chars()
                    .all(|character| character.len_utf16() == 1)
                    && monotonic_measure_style(&text.style)
                    && fonts.has_monotonic_prefix_widths(
                        &text.text,
                        &TextMeasurementStyle::from_style(&text.style),
                    )
                    && text.inline_margin_left.is_none_or(nonnegative)
                    && text.inline_margin_right.is_none_or(nonnegative)
            }
        })
}

fn monotonic_measure_style(style: &Map<String, Value>) -> bool {
    nonnegative(number_style(style, "fontSize").unwrap_or(16.0))
        && nonnegative(number_style(style, "letterSpacing").unwrap_or(0.0))
        && nonnegative(number_style(style, "wordSpacing").unwrap_or(0.0))
        && nonnegative(number_style(style, "paddingLeft").unwrap_or(0.0))
        && nonnegative(number_style(style, "paddingRight").unwrap_or(0.0))
        && nonnegative(border_width(style, "borderLeft"))
        && nonnegative(border_width(style, "borderRight"))
}

fn nonnegative(value: f64) -> bool {
    value.is_finite() && value >= 0.0
}

fn find_text_slice_end(context: &LineContext, pos: usize, range_end: usize) -> usize {
    context
        .atoms
        .range(pos..range_end)
        .next()
        .map(|(offset, _)| *offset)
        .unwrap_or(range_end)
}

fn range_start_inset(
    range: Option<&LineStyleRange>,
    style: &Map<String, Value>,
    pos: usize,
) -> f64 {
    let Some(range) = range else {
        return 0.0;
    };
    if pos != range.start {
        return 0.0;
    }
    let mut width = if range.border_start {
        border_width(style, "borderLeft") + number_style(style, "paddingLeft").unwrap_or(0.0)
    } else {
        0.0
    };
    width += range.inline_margin_left.unwrap_or(0.0);
    width
}

fn range_end_inset(
    range: Option<&LineStyleRange>,
    style: &Map<String, Value>,
    slice_end: usize,
) -> f64 {
    let Some(range) = range else {
        return 0.0;
    };
    if slice_end < range.end {
        return 0.0;
    }
    let mut width = if range.border_end {
        number_style(style, "paddingRight").unwrap_or(0.0) + border_width(style, "borderRight")
    } else {
        0.0
    };
    width += range.inline_margin_right.unwrap_or(0.0);
    width
}

struct RangeEdges {
    is_start: bool,
    is_end: bool,
    line_range_end: usize,
}

struct RangeSpacing {
    inset_left: f64,
    inset_right: f64,
    margin_left: f64,
    margin_right: f64,
}

fn range_spacing(range: &LineStyleRange, edges: &RangeEdges, global_pos: usize) -> RangeSpacing {
    RangeSpacing {
        inset_left: if edges.is_start {
            border_width(&range.style, "borderLeft")
                + number_style(&range.style, "paddingLeft").unwrap_or(0.0)
        } else {
            0.0
        },
        inset_right: if edges.is_end {
            number_style(&range.style, "paddingRight").unwrap_or(0.0)
                + border_width(&range.style, "borderRight")
        } else {
            0.0
        },
        margin_left: if global_pos == range.start {
            range.inline_margin_left.unwrap_or(0.0)
        } else {
            0.0
        },
        margin_right: if edges.line_range_end >= range.end {
            range.inline_margin_right.unwrap_or(0.0)
        } else {
            0.0
        },
    }
}

struct BuildTextRunInput<'a> {
    text: String,
    text_mapping: RunTextMapping,
    x: f64,
    line_height: f64,
    width: f64,
    range: &'a LineStyleRange,
    is_start: bool,
    is_end: bool,
    source_provenance: RunSourceProvenance,
    context: &'a LineContext,
    fonts: &'a TextMeasurementFonts<'a>,
    shape: RunShape,
}

fn build_text_run(input: BuildTextRunInput<'_>) -> TextRunBox {
    let font_size = number_style(&input.range.style, "fontSize").unwrap_or(16.0);
    let y = vertical_align_offset(
        &input.range.style,
        input.line_height,
        base_font_size(input.context),
    );
    let height = line_height_px(&input.range.style);
    let interaction_geometry = input
        .fonts
        .vertical_metrics_for_style(&TextMeasurementStyle::from_style(&input.range.style))
        .and_then(|metrics| TextRunInteractionGeometry::from_font_metrics(metrics, height));
    TextRunBox {
        text: input.text,
        text_mapping: input.text_mapping,
        x: input.x,
        y,
        width: input.width,
        height,
        font_size,
        interaction_geometry,
        paint: run_paint_from_style(&input.range.style, input.is_start, input.is_end),
        line_height_px: number_style(&input.range.style, "lineHeightPx"),
        href: input.range.href.clone(),
        source_path: input.source_provenance.source_path,
        source_text: input.source_provenance.source_text,
        source_text_offset: input.source_provenance.source_text_offset,
        inline_margin_right: None,
        ruby_annotation: input.range.ruby_annotation.clone(),
        shape: input.shape,
    }
}

fn build_inline_atom(
    atom: &LineAtom,
    x: f64,
    line_height: f64,
    context: &LineContext,
) -> AtomRunBox {
    AtomRunBox {
        x,
        y: vertical_align_offset(&atom.style, line_height, base_font_size(context)),
        width: atom.width,
        height: atom.height,
        image_src: atom.image_src.clone(),
        alt: atom.alt.clone(),
        href: atom.href.clone(),
    }
}

fn find_range(ranges: &[LineStyleRange], pos: usize) -> Option<&LineStyleRange> {
    let index = ranges.partition_point(|range| range.start <= pos);
    if index == 0 {
        return None;
    }
    let range = &ranges[index - 1];
    (pos < range.end).then_some(range)
}

fn base_font_size(context: &LineContext) -> f64 {
    number_style(&context.base_style, "fontSize").unwrap_or(16.0)
}

fn consume_newline(text: &Utf16Text<'_>, pos: usize) -> usize {
    if pos < text.len && text.char_at(pos) == Some('\n') {
        pos + 1
    } else {
        pos
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, num::NonZeroUsize};

    use serde_json::{json, Map, Value};

    use super::{layout_greedy_lines, layout_greedy_lines_with_fonts, GreedyLineLayoutSession};
    use crate::layout::{
        inline_segment::{InlineSegment, TextSegment},
        line::{LineRun, TextRunBox},
        text_mapping::TextSegmentMapping,
        text_measure::{TextMeasurementCache, TextMeasurementFonts},
        text_work::{TextWorkBudget, TextWorkMeter},
        text_work_trace::capture_text_work_trace,
        FontVerticalMetricSample,
    };

    mod real_font_resumption;

    #[test]
    fn line_height_centers_the_exact_font_box_without_changing_its_height() {
        let fonts = vertical_metric_fonts(vec![vertical_metrics(
            "serif", "normal", 400, 20.0, 4.0, 20.0,
        )]);
        let build = |line_height_px: f64| {
            let style = Map::from_iter([
                ("fontSize".to_owned(), json!(20)),
                ("lineHeightPx".to_owned(), json!(line_height_px)),
            ]);
            first_text_run(&layout_greedy_lines_with_fonts(
                &[text_segment("text".to_owned(), style)],
                200.0,
                &fonts,
            ))
            .clone()
        };

        let compact = build(31.0);
        let spacious = build(60.0);

        assert_ne!(compact.height, spacious.height);
        assert_eq!(compact.interaction_vertical_bounds(), (3.0, 24.0));
        assert_eq!(spacious.interaction_vertical_bounds(), (18.0, 24.0));
    }

    #[test]
    fn exact_canvas_descriptor_selects_the_matching_size_sample() {
        let fonts = vertical_metric_fonts(vec![
            vertical_metrics("Book", "normal", 400, 20.0, 2.0, 16.0),
            vertical_metrics("Book", "italic", 700, 20.0, 5.0, 20.0),
            vertical_metrics("Book", "italic", 700, 21.0, 6.0, 21.0),
        ]);
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(20)),
            ("lineHeightPx".to_owned(), json!(40)),
            ("fontFamily".to_owned(), Value::String("book".to_owned())),
            ("fontStyle".to_owned(), Value::String("ITALIC".to_owned())),
            ("fontWeight".to_owned(), json!(700)),
        ]);
        let lines = layout_greedy_lines_with_fonts(
            &[text_segment("text".to_owned(), style)],
            200.0,
            &fonts,
        );

        assert_eq!(
            first_text_run(&lines).interaction_vertical_bounds(),
            (7.0, 25.0)
        );
    }

    #[test]
    fn missing_or_invalid_vertical_metrics_keep_line_height_fallback() {
        let fonts = vertical_metric_fonts(vec![vertical_metrics(
            "serif",
            "normal",
            400,
            20.0,
            f64::NAN,
            20.0,
        )]);
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(20)),
            ("lineHeight".to_owned(), json!(2.0)),
        ]);
        let lines = layout_greedy_lines_with_fonts(
            &[text_segment("text".to_owned(), style)],
            200.0,
            &fonts,
        );
        let run = first_text_run(&lines);

        assert!(run.interaction_geometry.is_none());
        assert_eq!(run.interaction_vertical_bounds(), (0.0, 40.0));
    }

    #[test]
    fn descriptor_defaults_are_normalized_before_exact_lookup() {
        let fonts = vertical_metric_fonts(vec![vertical_metrics("", "", 0, 20.0, 4.0, 20.0)]);
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(20)),
            ("lineHeightPx".to_owned(), json!(32)),
        ]);
        let lines = layout_greedy_lines_with_fonts(
            &[text_segment("text".to_owned(), style)],
            200.0,
            &fonts,
        );

        assert_eq!(
            first_text_run(&lines).interaction_vertical_bounds(),
            (4.0, 24.0)
        );
    }

    #[test]
    fn literal_object_replacement_character_remains_text_without_an_atom() {
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
        ]);
        let segments = [text_segment("a\u{fffc}b".to_owned(), style)];

        let lines = layout_greedy_lines(&segments, 200.0);

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text(), "a\u{fffc}b");
    }

    #[test]
    fn emits_the_discretionary_hyphen_selected_by_the_breaker() {
        let segment = InlineSegment::Text(TextSegment {
            text: "Nokyoushitsue".to_owned(),
            mapping: TextSegmentMapping::synthetic(),
            style: Map::from_iter([
                ("fontSize".to_owned(), json!(10)),
                ("lineHeight".to_owned(), json!(1.2)),
                ("language".to_owned(), Value::String("ja".to_owned())),
            ]),
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            ruby_annotation: None,
            inline_margin_left: None,
            inline_margin_right: None,
            border_start: false,
            border_end: false,
        });

        let lines = layout_greedy_lines(&[segment], 66.0);

        assert_eq!(lines[0].text(), "Nokyoushit-");
        assert_eq!(lines[1].text(), "sue");
    }

    #[test]
    fn one_unit_quanta_preserve_hyphenated_lines_and_ordered_work_trace() {
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("language".to_owned(), Value::String("ja".to_owned())),
        ]);
        let segments = vec![text_segment("Nokyoushitsue".to_owned(), style)];
        let fonts = TextMeasurementFonts::empty();
        let (expected, expected_trace) =
            capture_text_work_trace(|| layout_greedy_lines_with_fonts(&segments, 60.0, &fonts));
        let ((actual, quantum_count), actual_trace) =
            capture_text_work_trace(|| layout_with_text_quanta(&segments, 60.0, &fonts, 1, 1));

        assert_eq!(expected[0].text(), "Noky-");
        assert!(quantum_count > 20);
        assert_eq!(actual, expected);
        assert_eq!(actual_trace.events, expected_trace.events);
    }

    #[test]
    fn classifies_break_offsets_once_for_many_forced_lines() {
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(16)),
            ("lineHeight".to_owned(), json!(1.5)),
            ("language".to_owned(), Value::String("zh-CN".to_owned())),
        ]);
        let long_line =
            "这是一段需要自动折行的中文文本，用来验证断点分类不会反复扫描整段内容。".repeat(2);
        let text = (0..100)
            .map(|_| long_line.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let segment = InlineSegment::Text(TextSegment {
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
        });
        let fonts = TextMeasurementFonts::empty();
        let segments = [segment];
        let mut session = GreedyLineLayoutSession::new(&segments, 160.0, &fonts);
        let mut line_count = 0;
        while !session.is_complete() {
            line_count += session.advance(1, &fonts).len();
        }

        let context = session.context.as_ref().expect("prepared context");

        assert!(line_count > 100);
        assert!(context.break_offsets.get().is_some());
    }

    #[test]
    fn resumed_budgets_match_unbounded_layout_field_for_field() {
        let segments = resumable_segments();
        let fonts = TextMeasurementFonts::empty();
        let expected = layout_greedy_lines_with_fonts(&segments, 72.0, &fonts);
        assert!(expected.len() > 8);

        for budget in [1, 2, 3, 5] {
            let mut session = GreedyLineLayoutSession::new(&segments, 72.0, &fonts);
            assert!(session.advance(0, &fonts).is_empty());
            let mut actual = Vec::new();
            while !session.is_complete() {
                let chunk = session.advance(budget, &fonts);
                assert!(chunk.len() <= budget);
                assert!(!chunk.is_empty());
                actual.extend(chunk);
            }
            assert_eq!(actual, expected, "line budget {budget}");
        }

        let mut unbounded = GreedyLineLayoutSession::new(&segments, 72.0, &fonts);
        let actual = unbounded.advance(usize::MAX, &fonts);
        assert!(unbounded.is_complete());
        assert_eq!(actual, expected);
    }

    #[test]
    fn session_does_not_borrow_the_construction_fonts() {
        let segments = resumable_segments();
        let mut session = {
            let transient_fonts = TextMeasurementFonts::empty();
            GreedyLineLayoutSession::new(&segments, 72.0, &transient_fonts)
        };
        let advance_fonts = TextMeasurementFonts::empty();

        let first = session.advance(1, &advance_fonts);

        assert_eq!(first.len(), 1);
        assert!(!session.is_complete());
    }

    #[test]
    fn tiny_text_quanta_preserve_lines_and_the_ordered_work_trace() {
        let segments = resumable_segments();
        let fonts = TextMeasurementFonts::empty();
        let (expected, expected_trace) =
            capture_text_work_trace(|| layout_greedy_lines_with_fonts(&segments, 72.0, &fonts));
        let ((actual, quantum_count), actual_trace) =
            capture_text_work_trace(|| layout_with_text_quanta(&segments, 72.0, &fonts, 12, 2));

        assert!(quantum_count > expected.len());
        assert_eq!(actual, expected);
        assert_eq!(actual_trace.events, expected_trace.events);
        assert_eq!(actual_trace.line_break_scans.len(), 1);
    }

    #[test]
    fn finalization_yields_without_committing_or_publishing_a_partial_line() {
        let base_style = Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("whiteSpace".to_owned(), Value::String("nowrap".to_owned())),
            ("textAlign".to_owned(), Value::String("center".to_owned())),
        ]);
        let raised_style = Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
            (
                "verticalAlign".to_owned(),
                Value::String("super".to_owned()),
            ),
        ]);
        let segments = vec![
            text_segment("a".to_owned(), base_style),
            text_segment("b".to_owned(), raised_style),
        ];
        let fonts = TextMeasurementFonts::empty();
        let expected = layout_greedy_lines_with_fonts(&segments, 72.0, &fonts);
        let mut session = GreedyLineLayoutSession::new(&segments, 72.0, &fonts);

        let mut build_work = TextWorkMeter::new(TextWorkBudget::new(
            NonZeroUsize::new(6).expect("text limit is non-zero"),
            NonZeroUsize::new(4).expect("operation limit is non-zero"),
        ));
        assert!(session
            .advance_with_text_work(usize::MAX, &mut build_work, &fonts)
            .is_empty());
        assert!(!session.is_complete());

        let mut partial_finalize_work = TextWorkMeter::new(TextWorkBudget::new(
            NonZeroUsize::new(3).expect("text limit is non-zero"),
            NonZeroUsize::new(1).expect("operation limit is non-zero"),
        ));
        assert!(session
            .advance_with_text_work(usize::MAX, &mut partial_finalize_work, &fonts)
            .is_empty());
        assert!(!session.is_complete());

        let mut partial_align_work = TextWorkMeter::new(TextWorkBudget::new(
            NonZeroUsize::new(1).expect("text limit is non-zero"),
            NonZeroUsize::new(1).expect("operation limit is non-zero"),
        ));
        assert!(session
            .advance_with_text_work(usize::MAX, &mut partial_align_work, &fonts)
            .is_empty());
        assert!(!session.is_complete());

        let mut second_partial_align_work = TextWorkMeter::new(TextWorkBudget::new(
            NonZeroUsize::new(1).expect("text limit is non-zero"),
            NonZeroUsize::new(1).expect("operation limit is non-zero"),
        ));
        assert!(session
            .advance_with_text_work(usize::MAX, &mut second_partial_align_work, &fonts)
            .is_empty());
        assert!(!session.is_complete());

        let mut partial_ruby_work = TextWorkMeter::new(TextWorkBudget::new(
            NonZeroUsize::new(1).expect("text limit is non-zero"),
            NonZeroUsize::new(1).expect("operation limit is non-zero"),
        ));
        assert!(session
            .advance_with_text_work(usize::MAX, &mut partial_ruby_work, &fonts)
            .is_empty());
        assert!(!session.is_complete());

        let mut second_partial_ruby_work = TextWorkMeter::new(TextWorkBudget::new(
            NonZeroUsize::new(1).expect("text limit is non-zero"),
            NonZeroUsize::new(1).expect("operation limit is non-zero"),
        ));
        assert!(session
            .advance_with_text_work(usize::MAX, &mut second_partial_ruby_work, &fonts)
            .is_empty());
        assert!(!session.is_complete());

        let mut finish_work = TextWorkMeter::new(TextWorkBudget::new(
            NonZeroUsize::new(1).expect("text limit is non-zero"),
            NonZeroUsize::new(1).expect("operation limit is non-zero"),
        ));
        let actual = session.advance_with_text_work(usize::MAX, &mut finish_work, &fonts);

        assert_eq!(actual, expected);
        assert!(session.is_complete());
    }

    #[test]
    fn justify_analysis_yields_without_publishing_a_partial_line() {
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("textAlign".to_owned(), Value::String("justify".to_owned())),
            (
                "textJustify".to_owned(),
                Value::String("inter-character".to_owned()),
            ),
            (
                "wordBreak".to_owned(),
                Value::String("break-all".to_owned()),
            ),
        ]);
        let segments = vec![text_segment("中文中文中文中文".to_owned(), style)];
        let fonts = TextMeasurementFonts::empty();
        let expected = layout_greedy_lines_with_fonts(&segments, 25.0, &fonts);
        let mut session = GreedyLineLayoutSession::new(&segments, 25.0, &fonts);
        let mut quantum_count = 0;

        while !session.is_analyzing_justify() {
            quantum_count += 1;
            assert!(quantum_count < 100, "session must reach justify analysis");
            let mut work = TextWorkMeter::new(TextWorkBudget::new(
                NonZeroUsize::new(1).expect("text limit is non-zero"),
                NonZeroUsize::new(1).expect("operation limit is non-zero"),
            ));
            assert!(session
                .advance_with_text_work(usize::MAX, &mut work, &fonts)
                .is_empty());
            assert!(!session.is_complete());
        }

        let mut partial_analysis = TextWorkMeter::new(TextWorkBudget::new(
            NonZeroUsize::new(1).expect("text limit is non-zero"),
            NonZeroUsize::new(1).expect("operation limit is non-zero"),
        ));
        assert!(session
            .advance_with_text_work(usize::MAX, &mut partial_analysis, &fonts)
            .is_empty());
        assert!(session.is_analyzing_justify());

        let mut actual = Vec::new();
        while !session.is_complete() {
            actual.extend(session.advance(usize::MAX, &fonts));
        }
        assert_eq!(actual, expected);
    }

    #[test]
    fn justify_distribution_yields_without_publishing_a_partial_line() {
        let base_style = Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("textAlign".to_owned(), Value::String("justify".to_owned())),
            (
                "textJustify".to_owned(),
                Value::String("inter-character".to_owned()),
            ),
            (
                "wordBreak".to_owned(),
                Value::String("break-all".to_owned()),
            ),
            ("color".to_owned(), Value::String("red".to_owned())),
        ]);
        let mut alternate_style = base_style.clone();
        alternate_style.insert("color".to_owned(), Value::String("blue".to_owned()));
        let segments = vec![
            text_segment("中".to_owned(), base_style.clone()),
            text_segment("文".to_owned(), alternate_style.clone()),
            text_segment("中".to_owned(), base_style),
            text_segment("文".to_owned(), alternate_style),
        ];
        let fonts = TextMeasurementFonts::empty();
        let expected = layout_greedy_lines_with_fonts(&segments, 13.0, &fonts);
        assert!(expected.len() > 1);
        let mut session = GreedyLineLayoutSession::new(&segments, 13.0, &fonts);
        let mut quantum_count = 0;

        while !session.is_distributing_justify() {
            quantum_count += 1;
            assert!(quantum_count < 100, "session must reach distribution");
            let mut work = TextWorkMeter::new(TextWorkBudget::new(
                NonZeroUsize::new(1).expect("text limit is non-zero"),
                NonZeroUsize::new(1).expect("operation limit is non-zero"),
            ));
            assert!(session
                .advance_with_text_work(usize::MAX, &mut work, &fonts)
                .is_empty());
            assert!(!session.is_complete());
        }

        let mut partial_distribution = TextWorkMeter::new(TextWorkBudget::new(
            NonZeroUsize::new(1).expect("text limit is non-zero"),
            NonZeroUsize::new(1).expect("operation limit is non-zero"),
        ));
        assert!(session
            .advance_with_text_work(usize::MAX, &mut partial_distribution, &fonts)
            .is_empty());
        assert!(session.is_distributing_justify());

        let mut actual = Vec::new();
        while !session.is_complete() {
            actual.extend(session.advance(usize::MAX, &fonts));
        }
        assert_eq!(actual, expected);
    }

    #[test]
    fn oversized_nowrap_measure_and_shape_resume_without_partial_output() {
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("whiteSpace".to_owned(), Value::String("nowrap".to_owned())),
        ]);
        let segments = vec![text_segment("x".repeat(200), style)];
        let fonts = TextMeasurementFonts::empty();
        let (expected, expected_trace) =
            capture_text_work_trace(|| layout_greedy_lines_with_fonts(&segments, 72.0, &fonts));
        let ((actual, quantum_count), actual_trace) =
            capture_text_work_trace(|| layout_with_text_quanta(&segments, 72.0, &fonts, 16, 1));

        assert_eq!(expected.len(), 1);
        assert!(quantum_count > 10);
        assert_eq!(actual, expected);
        assert_eq!(actual_trace.events, expected_trace.events);
    }

    #[test]
    fn one_unit_quanta_finish_astral_run_copy_measure_and_shape() {
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("whiteSpace".to_owned(), Value::String("nowrap".to_owned())),
        ]);
        let segments = vec![text_segment("😀😀".to_owned(), style)];
        let fonts = TextMeasurementFonts::empty();
        let expected = layout_greedy_lines_with_fonts(&segments, 72.0, &fonts);

        let (actual, quantum_count) = layout_with_text_quanta(&segments, 72.0, &fonts, 1, 1);

        assert!(quantum_count >= 6);
        assert_eq!(actual, expected);
    }

    #[test]
    #[should_panic(expected = "must resume with the same font profile")]
    fn session_rejects_a_different_font_profile() {
        let segments = resumable_segments();
        let construction_fonts = TextMeasurementFonts::empty();
        let different_fonts = TextMeasurementFonts::font_aware_empty();
        let mut session = GreedyLineLayoutSession::new(&segments, 72.0, &construction_fonts);

        let _ = session.advance(1, &different_fonts);
    }

    #[test]
    fn no_op_advances_do_not_require_the_construction_font_profile() {
        let segments = resumable_segments();
        let construction_fonts = TextMeasurementFonts::empty();
        let different_fonts = TextMeasurementFonts::font_aware_empty();
        let mut session = GreedyLineLayoutSession::new(&segments, 72.0, &construction_fonts);

        assert!(session.advance(0, &different_fonts).is_empty());
        while !session.is_complete() {
            let _ = session.advance(usize::MAX, &construction_fonts);
        }
        assert!(session.advance(1, &different_fonts).is_empty());

        let mut empty = GreedyLineLayoutSession::new(&[], 72.0, &construction_fonts);
        assert!(empty.advance(1, &different_fonts).is_empty());
    }

    fn layout_with_text_quanta(
        segments: &[InlineSegment],
        max_width: f64,
        fonts: &TextMeasurementFonts<'_>,
        max_utf16_units: usize,
        max_atomic_operations: usize,
    ) -> (Vec<crate::layout::line::LineBox>, usize) {
        let mut session = GreedyLineLayoutSession::new(segments, max_width, fonts);
        let mut lines = Vec::new();
        let mut quantum_count = 0;
        while !session.is_complete() {
            quantum_count += 1;
            assert!(quantum_count < 10_000, "text layout must not livelock");
            let budget = TextWorkBudget::new(
                NonZeroUsize::new(max_utf16_units).expect("text limit is non-zero"),
                NonZeroUsize::new(max_atomic_operations).expect("operation limit is non-zero"),
            );
            let mut work = TextWorkMeter::new(budget);
            let chunk = session.advance_with_text_work(usize::MAX, &mut work, fonts);
            lines.extend(chunk);
        }
        (lines, quantum_count)
    }

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

    fn first_text_run(lines: &[crate::layout::line::LineBox]) -> &TextRunBox {
        lines
            .iter()
            .flat_map(|line| &line.runs)
            .find_map(|run| match run {
                LineRun::Text(run) => Some(run),
                LineRun::Atom(_) | LineRun::Ruby(_) => None,
            })
            .expect("layout has a text run")
    }

    fn vertical_metric_fonts(
        samples: Vec<FontVerticalMetricSample>,
    ) -> TextMeasurementFonts<'static> {
        TextMeasurementFonts::new_with_cache_and_vertical_metrics(
            Vec::new(),
            TextMeasurementCache::default(),
            BTreeMap::new(),
            BTreeMap::new(),
            BTreeMap::new(),
            BTreeMap::new(),
            samples,
        )
    }

    fn vertical_metrics(
        family: &str,
        style: &str,
        weight: u16,
        size: f64,
        ascent: f64,
        descent: f64,
    ) -> FontVerticalMetricSample {
        FontVerticalMetricSample {
            font_family: family.to_owned(),
            font_style: style.to_owned(),
            font_weight: weight,
            font_size_px: size,
            top_baseline_ascent_px: ascent,
            top_baseline_descent_px: descent,
        }
    }

    fn resumable_segments() -> Vec<InlineSegment> {
        let base_style = Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.4)),
            ("language".to_owned(), Value::String("ja".to_owned())),
            ("textIndent".to_owned(), json!(8)),
            ("textAlign".to_owned(), Value::String("justify".to_owned())),
        ]);
        let accent_style = Map::from_iter([
            ("fontSize".to_owned(), json!(12)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("language".to_owned(), Value::String("ja".to_owned())),
            ("paddingLeft".to_owned(), json!(1)),
            ("paddingRight".to_owned(), json!(2)),
            ("borderLeftWidth".to_owned(), json!(1)),
            ("borderRightWidth".to_owned(), json!(1)),
        ]);
        vec![
            InlineSegment::Text(TextSegment {
                text: "Nokyoushitsue 这是一段需要稳定分批断行的中文文本，包含标点与空格。\n下一行继续验证纵向坐标。"
                    .to_owned(),
                mapping: TextSegmentMapping::synthetic(),
                style: base_style,
                href: None,
                source_path: Some(vec![0, 1]),
                source_text: Some("source one".into()),
                source_text_offset: Some(3),
                ruby_annotation: None,
                inline_margin_left: None,
                inline_margin_right: None,
                border_start: false,
                border_end: false,
            }),
            InlineSegment::Text(TextSegment {
                text: " mixed-style tail with enough words to wrap more than once".to_owned(),
                mapping: TextSegmentMapping::synthetic(),
                style: accent_style,
                href: Some("#note".to_owned()),
                source_path: Some(vec![0, 2]),
                source_text: Some("source two".into()),
                source_text_offset: Some(7),
                ruby_annotation: Some("注".to_owned()),
                inline_margin_left: Some(2.0),
                inline_margin_right: Some(3.0),
                border_start: true,
                border_end: true,
            }),
        ]
    }
}
