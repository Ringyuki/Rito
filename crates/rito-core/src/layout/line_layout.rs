use std::{
    collections::{BTreeMap, BTreeSet},
    sync::OnceLock,
};

use serde_json::{Map, Value};

use super::{
    inline_segment::{AtomSegment, InlineSegment},
    line::{AtomRunBox, LineBox, LineRun, TextRunBox},
    line_align::apply_line_align,
    line_break::{
        adjust_break_position_with_offsets, find_word_break_with_offsets, line_break_offsets,
        try_ascii_hyphenation, utf16_len, LineBreakOptions, Utf16Text,
    },
    line_metrics::{
        effective_line_metrics, line_height_px, measure_text_slice_with_fonts, runs_width,
        shift_runs_y, vertical_align_offset,
    },
    style_values::{border_width, number_style, run_paint_value, string_style},
    text_measure::TextMeasurementFonts,
};

#[derive(Debug, Clone)]
struct LineContext<'a> {
    full_text: String,
    ranges: Vec<LineStyleRange>,
    atoms: BTreeMap<usize, LineAtom>,
    max_width: f64,
    line_height: f64,
    preserve_ws: bool,
    allow_wrap: bool,
    line_break_options: LineBreakOptions,
    break_offsets: OnceLock<BTreeSet<usize>>,
    base_style: Map<String, Value>,
    fonts: &'a TextMeasurementFonts<'a>,
}

#[derive(Debug, Clone)]
struct LineStyleRange {
    start: usize,
    end: usize,
    style: Map<String, Value>,
    href: Option<String>,
    source_path: Option<Vec<usize>>,
    source_text: Option<String>,
    source_text_offset: Option<usize>,
    ruby_annotation: Option<String>,
    inline_margin_left: Option<f64>,
    inline_margin_right: Option<f64>,
    border_start: bool,
    border_end: bool,
}

#[derive(Debug, Clone)]
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
    if segments.is_empty() {
        return Vec::new();
    }
    let Some(base_style) = segments.first().map(InlineSegment::style) else {
        return Vec::new();
    };
    let context = build_line_context(segments, base_style.clone(), max_width, fonts);
    if context.full_text.trim().is_empty()
        && !context.full_text.contains('\n')
        && context.atoms.is_empty()
    {
        return Vec::new();
    }
    layout_text(&context)
}

fn build_line_context<'a>(
    segments: &'a [InlineSegment],
    base_style: Map<String, Value>,
    max_width: f64,
    fonts: &'a TextMeasurementFonts<'a>,
) -> LineContext<'a> {
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
                });
                offset = end;
            }
        }
    }

    let line_height = line_height_px(&base_style);
    let line_break_options = LineBreakOptions::from_style(
        string_style(&base_style, "lineBreak").as_deref(),
        string_style(&base_style, "wordBreak").as_deref(),
        string_style(&base_style, "language").as_deref(),
    );
    LineContext {
        full_text: text_parts.join(""),
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
        fonts,
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

fn layout_text(context: &LineContext) -> Vec<LineBox> {
    let text = Utf16Text::new(&context.full_text);
    let mut lines = Vec::new();
    let mut y = 0.0;
    let mut pos = 0usize;
    let mut is_first_line = true;
    let indent = number_style(&context.base_style, "textIndent").unwrap_or(0.0);

    while pos < text.len {
        if !context.preserve_ws && (!is_first_line || indent <= 0.0) {
            pos = skip_ascii_spaces(&text, pos);
        }
        if pos >= text.len {
            break;
        }

        let line = layout_single_line(context, &text, pos, is_first_line, indent);
        pos = consume_newline(&text, line.next_pos);
        let is_last_line = pos >= text.len || line.ends_with_forced_break;
        let (height, y_shift) = effective_line_metrics(&line.runs, context.line_height);
        let shifted = shift_runs_y(line.runs, y_shift);
        lines.push(apply_line_align(
            shifted,
            line.width,
            y,
            height,
            context.max_width,
            &context.base_style,
            is_last_line,
        ));
        y += height;
        is_first_line = false;
    }

    lines
}

struct SingleLineLayout {
    runs: Vec<LineRun>,
    width: f64,
    next_pos: usize,
    ends_with_forced_break: bool,
}

fn layout_single_line(
    context: &LineContext,
    text: &Utf16Text<'_>,
    pos: usize,
    is_first_line: bool,
    indent: f64,
) -> SingleLineLayout {
    let effective_max = if is_first_line && indent != 0.0 {
        context.max_width - indent
    } else {
        context.max_width
    };
    let line_start_x = if is_first_line && indent != 0.0 {
        indent
    } else {
        0.0
    };
    let newline_index = text.find_char(pos, '\n');
    let line_end = newline_index.unwrap_or(text.len);
    let break_result = if context.allow_wrap {
        find_break_position(context, text, pos, line_end, effective_max)
    } else {
        LineBreakPosition {
            position: line_end,
            hyphenated: false,
        }
    };
    let break_pos = break_result.position;
    let line_text_end = if break_pos <= pos {
        text.next_offset(pos)
    } else {
        break_pos
    };
    let ends_with_forced_break = newline_index.is_some_and(|index| line_text_end >= index);
    let render_end = if context.preserve_ws {
        line_text_end
    } else {
        trim_end_js_whitespace(text, pos, line_text_end)
    };
    let mut runs = build_line_runs(context, text, pos, render_end, line_start_x);
    if break_result.hyphenated {
        append_trailing_hyphen(context, break_pos, &mut runs);
    }
    SingleLineLayout {
        width: runs_width(&runs),
        runs,
        next_pos: line_text_end,
        ends_with_forced_break,
    }
}

#[derive(Debug, Clone, Copy)]
struct LineBreakPosition {
    position: usize,
    hyphenated: bool,
}

fn find_break_position(
    context: &LineContext,
    text: &Utf16Text<'_>,
    start: usize,
    end: usize,
    max_width: f64,
) -> LineBreakPosition {
    if measure_slice(context, text, start, end) <= max_width {
        return LineBreakPosition {
            position: end,
            hyphenated: false,
        };
    }

    let mut lo = start;
    let mut hi = end;
    while lo < hi.saturating_sub(1) {
        let mid = text.floor_boundary((lo + hi) / 2);
        if mid <= lo {
            break;
        }
        if measure_slice(context, text, start, mid) <= max_width {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    let break_offsets = context
        .break_offsets
        .get_or_init(|| line_break_offsets(text, &context.line_break_options));
    let word_break = find_word_break_with_offsets(start, lo, break_offsets);
    if word_break == lo {
        if let Some(hyphen_break) =
            try_ascii_hyphenation(text, start, lo, &context.line_break_options, |candidate| {
                measure_hyphenated_slice(context, text, start, candidate) <= max_width
            })
        {
            let position = adjust_break_position_with_offsets(
                start,
                end,
                hyphen_break,
                max_width,
                |slice_end| measure_slice(context, text, start, slice_end),
                break_offsets,
            );
            return LineBreakPosition {
                position,
                hyphenated: position == hyphen_break,
            };
        }
    }
    LineBreakPosition {
        position: adjust_break_position_with_offsets(
            start,
            end,
            word_break,
            max_width,
            |slice_end| measure_slice(context, text, start, slice_end),
            break_offsets,
        ),
        hyphenated: false,
    }
}

fn append_trailing_hyphen(context: &LineContext<'_>, break_pos: usize, runs: &mut [LineRun]) {
    let Some(LineRun::Text(run)) = runs.last_mut() else {
        return;
    };
    let Some(range) = break_pos
        .checked_sub(1)
        .and_then(|position| find_range(&context.ranges, position))
    else {
        return;
    };
    run.text.push('-');
    run.width = measure_text_slice_with_fonts(&run.text, &range.style, context.fonts);
}

fn measure_hyphenated_slice(
    context: &LineContext,
    text: &Utf16Text<'_>,
    start: usize,
    end: usize,
) -> f64 {
    measure_slice(context, text, start, end)
        + measure_text_slice_with_fonts("-", &context.base_style, context.fonts)
}

fn measure_slice(context: &LineContext, text: &Utf16Text<'_>, start: usize, end: usize) -> f64 {
    let mut width = 0.0;
    let mut pos = start;
    while pos < end {
        if let Some(atom) = context.atoms.get(&pos) {
            width += atom.width;
            pos += 1;
            continue;
        }
        let range = find_range(&context.ranges, pos);
        let range_end = range.map(|range| range.end.min(end)).unwrap_or(end);
        let slice_end = find_text_slice_end(context, pos, range_end);
        let style = range
            .map(|range| &range.style)
            .unwrap_or(&context.base_style);
        width += range_start_inset(range, style, pos);
        width += measure_text_slice_with_fonts(text.slice(pos, slice_end), style, context.fonts);
        width += range_end_inset(range, style, slice_end);
        pos = slice_end;
    }
    width
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

fn build_line_runs(
    context: &LineContext,
    text: &Utf16Text<'_>,
    global_offset: usize,
    render_end: usize,
    start_x: f64,
) -> Vec<LineRun> {
    let mut runs = Vec::new();
    let mut x = start_x;
    let mut pos = global_offset;

    while pos < render_end {
        if let Some(atom) = context.atoms.get(&pos) {
            runs.push(LineRun::Atom(build_inline_atom(
                atom,
                x,
                context.line_height,
                context,
            )));
            x += atom.width;
            pos += 1;
            continue;
        }

        let Some(range) = find_range(&context.ranges, pos) else {
            break;
        };
        let range_end = range.end.min(render_end);
        let run_text = text.slice(pos, range_end).replace('\u{fffc}', "");
        if run_text.is_empty() {
            pos = range_end;
            continue;
        }

        let edges = RangeEdges {
            is_start: range.border_start && pos == range.start,
            is_end: range.border_end && range_end >= range.end,
            line_range_end: range_end,
        };
        let spacing = range_spacing(range, &edges, pos);
        let source_text_offset = range
            .source_text
            .as_ref()
            .map(|_| range.source_text_offset.unwrap_or(0) + pos - range.start);
        let width = measure_text_slice_with_fonts(&run_text, &range.style, context.fonts);
        let mut run = build_text_run(BuildTextRunInput {
            text: run_text,
            x: x + spacing.margin_left + spacing.inset_left,
            line_height: context.line_height,
            width,
            range,
            is_start: edges.is_start,
            is_end: edges.is_end,
            source_text_offset,
            context,
        });
        if spacing.margin_right > 0.0 {
            run.inline_margin_right = Some(spacing.margin_right);
        }
        x += spacing.inset_left
            + spacing.margin_left
            + run.width
            + spacing.inset_right
            + spacing.margin_right;
        runs.push(LineRun::Text(run));
        pos = range_end;
    }

    runs
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
    x: f64,
    line_height: f64,
    width: f64,
    range: &'a LineStyleRange,
    is_start: bool,
    is_end: bool,
    source_text_offset: Option<usize>,
    context: &'a LineContext<'a>,
}

fn build_text_run(input: BuildTextRunInput<'_>) -> TextRunBox {
    let font_size = number_style(&input.range.style, "fontSize").unwrap_or(16.0);
    let y = vertical_align_offset(
        &input.range.style,
        input.line_height,
        base_font_size(input.context),
    );
    let height = line_height_px(&input.range.style);
    TextRunBox {
        text: input.text,
        x: input.x,
        y,
        width: input.width,
        height,
        font_size,
        paint: run_paint_value(&input.range.style, input.is_start, input.is_end),
        line_height_px: number_style(&input.range.style, "lineHeightPx"),
        href: input.range.href.clone(),
        source_path: input.range.source_path.clone(),
        source_text: input.range.source_text.clone(),
        source_text_offset: input.source_text_offset,
        inline_margin_right: None,
        ruby_annotation: input.range.ruby_annotation.clone(),
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

fn skip_ascii_spaces(text: &Utf16Text<'_>, mut pos: usize) -> usize {
    while pos < text.len && text.char_at(pos) == Some(' ') {
        pos += 1;
    }
    pos
}

fn consume_newline(text: &Utf16Text<'_>, pos: usize) -> usize {
    if pos < text.len && text.char_at(pos) == Some('\n') {
        pos + 1
    } else {
        pos
    }
}

fn trim_end_js_whitespace(text: &Utf16Text<'_>, start: usize, mut end: usize) -> usize {
    while end > start && text.char_before(end).is_some_and(char::is_whitespace) {
        end -= 1;
    }
    end
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map, Value};

    use super::{build_line_context, layout_greedy_lines, layout_text};
    use crate::layout::{
        inline_segment::{InlineSegment, TextSegment},
        text_measure::TextMeasurementFonts,
    };

    #[test]
    fn emits_the_discretionary_hyphen_selected_by_the_breaker() {
        let segment = InlineSegment::Text(TextSegment {
            text: "Nokyoushitsue".to_owned(),
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
            style: style.clone(),
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
        let context = build_line_context(&segments, style, 160.0, &fonts);

        let lines = layout_text(&context);

        assert!(lines.len() > 100);
        assert!(context.break_offsets.get().is_some());
    }
}
