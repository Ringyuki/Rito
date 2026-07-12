#![allow(dead_code)]
// Staged Knuth-Plass solver port. It is intentionally kept internal until the
// item builder and line-box rebuild path are wired to `LineBreaking::Optimal`.

use super::{
    hyphenation::find_hyphenation_points,
    inline_segment::{AtomSegment, InlineSegment, TextSegment},
    line::{AtomRunBox, LineBox, LineRun, TextRunBox},
    line_align::apply_line_align,
    line_break::{
        contains_cjk, split_line_break_segments, split_text_units, utf16_len, LineBreakOptions,
    },
    line_layout::layout_greedy_lines_with_fonts,
    line_metrics::{
        effective_line_metrics, line_height_px, measure_text_slice_with_fonts, shift_runs_y,
    },
    style_values::{
        border_width, number_style, run_border_edge_value, run_paint_value, string_style,
    },
    text_measure::{shape_text_with_style, TextMeasurementFonts},
    text_shape::{RunShape, RunShapeUnavailableReason},
};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum KpItem {
    Box(KpBox),
    Glue(KpGlue),
    Penalty(KpPenalty),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct KpBox {
    pub(crate) width: f64,
    pub(crate) text: String,
    pub(crate) segment_index: usize,
    pub(crate) atom_index: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct KpGlue {
    pub(crate) width: f64,
    pub(crate) stretch: f64,
    pub(crate) shrink: f64,
    pub(crate) text: &'static str,
    pub(crate) segment_index: Option<usize>,
    pub(crate) source_length: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct KpPenalty {
    pub(crate) width: f64,
    pub(crate) penalty: f64,
    pub(crate) flagged: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum FitnessClass {
    VeryTight,
    Tight,
    Loose,
    VeryLoose,
}

#[derive(Debug, Clone)]
struct KpBreakpoint {
    position: isize,
    line: usize,
    demerits: f64,
    ratio: f64,
    fitness: FitnessClass,
    prev: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum LineWidthSpec {
    Fixed(f64),
    FirstAndSubsequent {
        first_line: f64,
        subsequent_lines: f64,
    },
}

impl LineWidthSpec {
    fn resolve(self, line: usize) -> f64 {
        match self {
            Self::Fixed(width) => width,
            Self::FirstAndSubsequent {
                first_line,
                subsequent_lines,
            } => {
                if line == 0 {
                    first_line
                } else {
                    subsequent_lines
                }
            }
        }
    }
}

impl From<f64> for LineWidthSpec {
    fn from(width: f64) -> Self {
        Self::Fixed(width)
    }
}

#[derive(Debug, Clone, Copy)]
struct CumulativeSums {
    width: f64,
    stretch: f64,
    shrink: f64,
}

const TOLERANCE: f64 = 10.0;
const FLAGGED_DEMERITS: f64 = 3000.0;
const FITNESS_DEMERITS: f64 = 100.0;
const INF_BADNESS: f64 = 10_000.0;
const HYPHEN_PENALTY: f64 = 50.0;
const FORCED_BREAK_PENALTY: f64 = f64::NEG_INFINITY;

pub(crate) fn layout_optimal_lines(segments: &[InlineSegment], max_width: f64) -> Vec<LineBox> {
    layout_optimal_lines_with_fonts(segments, max_width, &TextMeasurementFonts::empty())
}

pub(crate) fn layout_optimal_lines_with_fonts<'a>(
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
    let has_atoms = segments.iter().any(InlineSegment::is_atom);
    let full_text = segments
        .iter()
        .map(|segment| match segment {
            InlineSegment::Text(text) => text.text.as_str(),
            InlineSegment::Atom(_) => "\u{fffc}",
        })
        .collect::<String>();
    if full_text.trim().is_empty() && !full_text.contains('\n') && !has_atoms {
        return Vec::new();
    }
    if matches!(
        string_style(base_style, "whiteSpace").as_deref(),
        Some("pre" | "pre-wrap" | "nowrap")
    ) {
        return layout_greedy_lines_with_fonts(segments, max_width, fonts);
    }

    let items = build_kp_items_with_fonts(segments, fonts);
    if items.is_empty() {
        return Vec::new();
    }
    if contains_forced_break(&items) && !contains_content_box(&items) {
        return forced_empty_lines(&items, max_width, line_height_px(base_style));
    }

    let indent = number_style(base_style, "textIndent").unwrap_or(0.0);
    let line_width = LineWidthSpec::FirstAndSubsequent {
        first_line: max_width - indent,
        subsequent_lines: max_width,
    };
    let break_positions =
        solve_kp(&items, line_width).unwrap_or_else(|| emergency_breaks(&items, line_width));
    build_line_boxes(
        &items,
        &break_positions,
        segments,
        max_width,
        indent,
        line_height_px(base_style),
        fonts,
    )
}

fn contains_forced_break(items: &[KpItem]) -> bool {
    items.iter().any(|item| {
        matches!(
            item,
            KpItem::Penalty(penalty) if penalty.penalty == FORCED_BREAK_PENALTY
        )
    })
}

fn contains_content_box(items: &[KpItem]) -> bool {
    items
        .iter()
        .any(|item| matches!(item, KpItem::Box(item_box) if !item_box.text.is_empty() || item_box.atom_index.is_some()))
}

fn forced_empty_lines(items: &[KpItem], max_width: f64, line_height: f64) -> Vec<LineBox> {
    let explicit_break_count = items
        .iter()
        .filter(|item| matches!(item, KpItem::Penalty(penalty) if penalty.penalty == FORCED_BREAK_PENALTY))
        .count()
        .saturating_sub(1);
    (0..explicit_break_count.max(1))
        .map(|index| LineBox {
            x: 0.0,
            y: line_height * index as f64,
            width: max_width,
            height: line_height,
            runs: Vec::new(),
        })
        .collect()
}

pub(crate) fn build_kp_items(segments: &[InlineSegment]) -> Vec<KpItem> {
    build_kp_items_with_fonts(segments, &TextMeasurementFonts::empty())
}

fn build_kp_items_with_fonts(
    segments: &[InlineSegment],
    fonts: &TextMeasurementFonts<'_>,
) -> Vec<KpItem> {
    let mut items = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        add_segment_items(&mut items, index, segment, fonts);
    }
    if !items.is_empty() {
        add_forced_break(&mut items, None, 0);
    }
    items
}

struct LineBuildState {
    lines: Vec<LineBox>,
    line_start: usize,
    y: f64,
    started_segments: Vec<usize>,
    trailing_edges: Vec<TrailingEdgeLocation>,
    source_offsets: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TrailingEdgeLocation {
    segment_index: usize,
    line_index: usize,
    run_index: usize,
}

fn build_line_boxes(
    items: &[KpItem],
    break_positions: &[usize],
    segments: &[InlineSegment],
    max_width: f64,
    indent: f64,
    line_height: f64,
    fonts: &TextMeasurementFonts<'_>,
) -> Vec<LineBox> {
    let Some(base_style) = segments.first().map(InlineSegment::style) else {
        return Vec::new();
    };
    let mut state = LineBuildState {
        lines: Vec::new(),
        line_start: 0,
        y: 0.0,
        started_segments: Vec::new(),
        trailing_edges: Vec::new(),
        source_offsets: vec![0; segments.len()],
    };

    for (line_index, break_pos) in break_positions.iter().copied().enumerate() {
        let start_x = if line_index == 0 && indent != 0.0 {
            indent
        } else {
            0.0
        };
        let runs = build_line_runs(LineRunBuildInput {
            items,
            start: state.line_start,
            end: break_pos,
            segments,
            start_x,
            line_height,
            line_index: state.lines.len(),
            started_segments: &mut state.started_segments,
            trailing_edges: &mut state.trailing_edges,
            source_offsets: &state.source_offsets,
            fonts,
        });
        let keep_empty_line = should_keep_empty_line(
            items,
            state.line_start,
            break_pos,
            line_index,
            break_positions.len(),
        );
        append_runs_as_line(
            &mut state,
            runs,
            max_width,
            line_height,
            base_style,
            is_last_line_for_text_align(items, break_pos, line_index, break_positions.len()),
            keep_empty_line,
        );
        advance_source_offsets(
            &mut state.source_offsets,
            items,
            state.line_start,
            break_pos + 1,
        );
        state.line_start = break_pos + 1;
    }

    apply_trailing_edges(&mut state.lines, &state.trailing_edges, segments);
    state.lines
}

fn append_runs_as_line(
    state: &mut LineBuildState,
    runs: Vec<LineRun>,
    max_width: f64,
    line_height: f64,
    base_style: &serde_json::Map<String, serde_json::Value>,
    is_last_line: bool,
    keep_empty_line: bool,
) {
    if runs.is_empty() {
        if keep_empty_line {
            state.lines.push(LineBox {
                x: 0.0,
                y: state.y,
                width: max_width,
                height: line_height,
                runs,
            });
            state.y += line_height;
        }
        return;
    }
    let line_width = runs.iter().map(LineRun::right).fold(0.0_f64, f64::max);
    let (height, y_shift) = effective_line_metrics(&runs, line_height);
    let runs = shift_runs_y(runs, y_shift);
    state.lines.push(apply_line_align(
        runs,
        line_width,
        state.y,
        height,
        max_width,
        base_style,
        is_last_line,
    ));
    state.y += height;
}

struct RunBuildContext<'a> {
    runs: Vec<LineRun>,
    x: f64,
    current_text: String,
    current_segment_index: Option<usize>,
    current_source_offset: usize,
    has_trailing_hyphen: bool,
    segments: &'a [InlineSegment],
    line_height: f64,
    base_font_size: f64,
    items: &'a [KpItem],
    line_end: usize,
    started_segments: &'a mut Vec<usize>,
    trailing_edges: &'a mut Vec<TrailingEdgeLocation>,
    source_offsets: &'a [usize],
    line_index: usize,
    fonts: &'a TextMeasurementFonts<'a>,
}

struct LineRunBuildInput<'a> {
    items: &'a [KpItem],
    start: usize,
    end: usize,
    segments: &'a [InlineSegment],
    start_x: f64,
    line_height: f64,
    line_index: usize,
    started_segments: &'a mut Vec<usize>,
    trailing_edges: &'a mut Vec<TrailingEdgeLocation>,
    source_offsets: &'a [usize],
    fonts: &'a TextMeasurementFonts<'a>,
}

fn build_line_runs(input: LineRunBuildInput<'_>) -> Vec<LineRun> {
    let base_font_size = input
        .segments
        .first()
        .and_then(|segment| number_style(segment.style(), "fontSize"))
        .unwrap_or(16.0);
    let mut context = RunBuildContext {
        runs: Vec::new(),
        x: input.start_x,
        current_text: String::new(),
        current_segment_index: None,
        current_source_offset: 0,
        has_trailing_hyphen: false,
        segments: input.segments,
        line_height: input.line_height,
        base_font_size,
        items: input.items,
        line_end: input.end,
        started_segments: input.started_segments,
        trailing_edges: input.trailing_edges,
        source_offsets: input.source_offsets,
        line_index: input.line_index,
        fonts: input.fonts,
    };

    let content_start = skip_leading_non_content(input.items, input.start, input.end);
    for index in content_start..input.end {
        append_item(&mut context, input.items.get(index));
    }
    append_hyphen_if_needed(&mut context, input.items.get(input.end));
    flush_run(&mut context);
    trim_last_run(&mut context);
    context.runs
}

fn append_item(context: &mut RunBuildContext<'_>, item: Option<&KpItem>) {
    match item {
        Some(KpItem::Box(item_box)) if item_box.atom_index.is_some() => {
            flush_run(context);
            append_atom_run(context, item_box);
        }
        Some(KpItem::Box(item_box)) => append_text_box(context, item_box),
        Some(KpItem::Glue(glue)) if context.current_segment_index.is_some() => {
            context.current_text.push_str(glue.text);
        }
        Some(KpItem::Glue(_) | KpItem::Penalty(_)) | None => {}
    }
}

fn append_text_box(context: &mut RunBuildContext<'_>, item_box: &KpBox) {
    if !item_box.text.is_empty()
        && can_merge_text_box(
            context,
            context.current_segment_index,
            item_box.segment_index,
        )
    {
        context.current_text.push_str(&item_box.text);
        return;
    }
    flush_run(context);
    context.current_segment_index = Some(item_box.segment_index);
    context.current_text = item_box.text.clone();
    let base_offset = context
        .segments
        .get(item_box.segment_index)
        .and_then(|segment| match segment {
            InlineSegment::Text(segment) => segment.source_text_offset,
            InlineSegment::Atom(_) => None,
        })
        .unwrap_or(0);
    context.current_source_offset = base_offset
        + context
            .source_offsets
            .get(item_box.segment_index)
            .copied()
            .unwrap_or(0);
}

fn can_merge_text_box(
    context: &RunBuildContext<'_>,
    current_index: Option<usize>,
    next_index: usize,
) -> bool {
    let Some(current_index) = current_index else {
        return false;
    };
    if current_index == next_index {
        return true;
    }
    let (Some(InlineSegment::Text(current)), Some(InlineSegment::Text(next))) = (
        context.segments.get(current_index),
        context.segments.get(next_index),
    ) else {
        return false;
    };
    if current.source_path.is_some() || next.source_path.is_some() {
        return false;
    }
    current.style == next.style
        && current.href == next.href
        && current.ruby_annotation == next.ruby_annotation
        && !current.border_end
        && !next.border_start
}

fn append_atom_run(context: &mut RunBuildContext<'_>, item_box: &KpBox) {
    let Some(InlineSegment::Atom(atom)) = context.segments.get(item_box.segment_index) else {
        return;
    };
    context.runs.push(LineRun::Atom(build_atom_run(
        atom,
        context.x,
        context.line_height,
        context.base_font_size,
    )));
    context.x += atom.width;
}

fn append_hyphen_if_needed(context: &mut RunBuildContext<'_>, break_item: Option<&KpItem>) {
    if matches!(
        break_item,
        Some(KpItem::Penalty(KpPenalty {
            penalty,
            flagged: true,
            ..
        })) if penalty.is_finite()
    ) && context.current_segment_index.is_some()
    {
        context.current_text.push('-');
        context.has_trailing_hyphen = true;
    }
}

fn flush_run(context: &mut RunBuildContext<'_>) {
    let Some(segment_index) = context.current_segment_index else {
        return;
    };
    if context.current_text.is_empty() {
        return;
    }
    let Some(InlineSegment::Text(segment)) = context.segments.get(segment_index) else {
        context.current_text.clear();
        context.current_segment_index = None;
        return;
    };

    let is_first = mark_segment_started(context.started_segments, segment_index);
    let is_start = segment.border_start && is_first;
    context.x += leading_inset(segment, is_start, is_first);
    let run = build_text_run(context, segment, is_start);
    context.x += run.width + trailing_inset(segment);
    context.runs.push(LineRun::Text(run));
    record_trailing_edge(context, segment_index);
    advance_flush_state(context);
}

fn build_text_run(
    context: &RunBuildContext<'_>,
    segment: &TextSegment,
    is_start: bool,
) -> TextRunBox {
    let font_size = number_style(&segment.style, "fontSize").unwrap_or(16.0);
    let width = measure_text_slice_with_fonts(&context.current_text, &segment.style, context.fonts);
    let shape = if context.has_trailing_hyphen {
        RunShape::unavailable(RunShapeUnavailableReason::SyntheticLayoutText, width)
    } else {
        shape_text_with_style(&context.current_text, &segment.style, context.fonts)
    };
    debug_assert!((shape.advance() - width).abs() < 0.000_001);
    TextRunBox {
        text: context.current_text.clone(),
        x: context.x,
        y: kp_vertical_align_offset(&segment.style, context.line_height, context.base_font_size),
        width,
        height: line_height_px(&segment.style),
        font_size,
        paint: run_paint_value(&segment.style, is_start, false),
        line_height_px: number_style(&segment.style, "lineHeightPx"),
        href: segment.href.clone(),
        source_path: segment.source_path.clone(),
        source_text: segment.source_text.clone(),
        source_text_offset: segment
            .source_text
            .as_ref()
            .map(|_| context.current_source_offset),
        inline_margin_right: None,
        ruby_annotation: segment.ruby_annotation.clone(),
        shape,
    }
}

fn record_trailing_edge(context: &mut RunBuildContext<'_>, segment_index: usize) {
    let Some(InlineSegment::Text(segment)) = context.segments.get(segment_index) else {
        return;
    };
    if !segment.border_end && segment.inline_margin_right.is_none() {
        return;
    }
    let Some(run_index) = context.runs.len().checked_sub(1) else {
        return;
    };
    if let Some(existing) = context
        .trailing_edges
        .iter_mut()
        .find(|location| location.segment_index == segment_index)
    {
        existing.line_index = context.line_index;
        existing.run_index = run_index;
        return;
    }
    context.trailing_edges.push(TrailingEdgeLocation {
        segment_index,
        line_index: context.line_index,
        run_index,
    });
}

fn apply_trailing_edges(
    lines: &mut [LineBox],
    locations: &[TrailingEdgeLocation],
    segments: &[InlineSegment],
) {
    for location in locations {
        let Some(InlineSegment::Text(segment)) = segments.get(location.segment_index) else {
            continue;
        };
        let Some(LineRun::Text(run)) = lines
            .get_mut(location.line_index)
            .and_then(|line| line.runs.get_mut(location.run_index))
        else {
            continue;
        };
        patch_trailing_run(run, segment);
    }
}

fn patch_trailing_run(run: &mut TextRunBox, segment: &TextSegment) {
    if segment.border_end {
        patch_border_end(run, segment);
    }
    run.inline_margin_right = segment.inline_margin_right;
}

fn patch_border_end(run: &mut TextRunBox, segment: &TextSegment) {
    let Some(edge) = run_border_edge_value(&segment.style, "borderRight") else {
        return;
    };
    let Some(paint) = run.paint.as_object_mut() else {
        return;
    };
    let border = paint
        .entry("border".to_owned())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let Some(border) = border.as_object_mut() else {
        return;
    };
    border.insert("end".to_owned(), edge);
}

fn build_atom_run(atom: &AtomSegment, x: f64, line_height: f64, base_font_size: f64) -> AtomRunBox {
    AtomRunBox {
        x,
        y: kp_vertical_align_offset(&atom.style, line_height, base_font_size),
        width: atom.width,
        height: atom.height,
        image_src: atom.image_src.clone(),
        alt: atom.alt.clone(),
        href: atom.href.clone(),
    }
}

fn kp_vertical_align_offset(
    style: &serde_json::Map<String, serde_json::Value>,
    line_height: f64,
    base_font_size: f64,
) -> f64 {
    let font_size = number_style(style, "fontSize").unwrap_or(16.0);
    match string_style(style, "verticalAlign").as_deref() {
        Some("baseline") => 0.8 * (base_font_size - font_size),
        Some("top" | "text-top") => 0.0,
        Some("super") => -(font_size * 0.4),
        Some("sub") => font_size * 0.2,
        Some("middle") => (line_height - font_size) / 2.0,
        Some("bottom" | "text-bottom") => line_height - font_size,
        _ => 0.0,
    }
}

fn advance_flush_state(context: &mut RunBuildContext<'_>) {
    let advance = current_text_source_advance(context);
    context.current_source_offset += advance;
    context.current_text.clear();
    context.has_trailing_hyphen = false;
}

fn current_text_source_advance(context: &RunBuildContext<'_>) -> usize {
    let length = utf16_len(&context.current_text);
    if context.has_trailing_hyphen {
        length.saturating_sub(1)
    } else {
        length
    }
}

fn trim_last_run(context: &mut RunBuildContext<'_>) {
    let Some(LineRun::Text(run)) = context.runs.last_mut() else {
        return;
    };
    let trimmed = run.text.trim_end();
    if trimmed.len() == run.text.len() {
        return;
    }
    let Some(InlineSegment::Text(segment)) = context.segments.get(
        context
            .current_segment_index
            .unwrap_or_else(|| run.source_path.as_ref().map_or(0, |_| 0)),
    ) else {
        return;
    };
    run.text = trimmed.to_owned();
    run.width = measure_text_slice_with_fonts(&run.text, &segment.style, context.fonts);
    run.shape = shape_text_with_style(&run.text, &segment.style, context.fonts);
}

fn mark_segment_started(started_segments: &mut Vec<usize>, segment_index: usize) -> bool {
    if started_segments.contains(&segment_index) {
        false
    } else {
        started_segments.push(segment_index);
        true
    }
}

fn leading_inset(segment: &TextSegment, is_start: bool, is_first: bool) -> f64 {
    let margin_left = if is_first {
        segment.inline_margin_left.unwrap_or(0.0)
    } else {
        0.0
    };
    let border_padding = if is_start {
        border_width(&segment.style, "borderLeft")
            + number_style(&segment.style, "paddingLeft").unwrap_or(0.0)
    } else {
        0.0
    };
    border_padding + margin_left
}

fn trailing_inset(segment: &TextSegment) -> f64 {
    let mut inset = if segment.border_end {
        number_style(&segment.style, "paddingRight").unwrap_or(0.0)
            + border_width(&segment.style, "borderRight")
    } else {
        0.0
    };
    inset += segment.inline_margin_right.unwrap_or(0.0);
    inset
}

fn skip_leading_non_content(items: &[KpItem], start: usize, end: usize) -> usize {
    let mut index = start;
    while index < end && matches!(items.get(index), Some(KpItem::Glue(_))) {
        index += 1;
    }
    while index < end && is_leading_space_marker(items.get(index)) {
        index += 1;
    }
    while index < end && matches!(items.get(index), Some(KpItem::Penalty(_))) {
        index += 1;
    }
    index
}

fn is_leading_space_marker(item: Option<&KpItem>) -> bool {
    matches!(
        item,
        Some(KpItem::Box(item_box))
            if item_box.width == 0.0
                && item_box.atom_index.is_none()
                && item_box.text.chars().all(|character| character == ' ')
    )
}

fn is_forced_break(items: &[KpItem], break_pos: usize) -> bool {
    matches!(
        items.get(break_pos),
        Some(KpItem::Penalty(penalty)) if penalty.penalty == f64::NEG_INFINITY
    )
}

fn is_last_line_for_text_align(
    items: &[KpItem],
    break_pos: usize,
    line_index: usize,
    line_count: usize,
) -> bool {
    line_index == line_count - 1
        || is_forced_break(items, break_pos)
        || has_only_break_markers_before_forced_break(items, break_pos)
}

fn has_only_break_markers_before_forced_break(items: &[KpItem], break_pos: usize) -> bool {
    for item in items.iter().skip(break_pos + 1) {
        match item {
            KpItem::Penalty(penalty) if penalty.penalty == f64::NEG_INFINITY => return true,
            KpItem::Box(_) => return false,
            KpItem::Glue(_) | KpItem::Penalty(_) => {}
        }
    }
    false
}

fn should_keep_empty_line(
    items: &[KpItem],
    line_start: usize,
    break_pos: usize,
    line_index: usize,
    line_count: usize,
) -> bool {
    line_index < line_count - 1
        && is_forced_break(items, break_pos)
        && has_content_between(items, line_start, break_pos)
}

fn has_content_between(items: &[KpItem], start: usize, end: usize) -> bool {
    items
        .iter()
        .take(end)
        .skip(start)
        .any(|item| matches!(item, KpItem::Box(item_box) if !item_box.text.is_empty() || item_box.atom_index.is_some()))
}

fn add_segment_items(
    items: &mut Vec<KpItem>,
    segment_index: usize,
    segment: &InlineSegment,
    fonts: &TextMeasurementFonts<'_>,
) {
    match segment {
        InlineSegment::Atom(atom) => {
            items.push(KpItem::Box(KpBox {
                width: atom.width,
                text: "\u{fffc}".to_owned(),
                segment_index,
                atom_index: Some(segment_index),
            }));
        }
        InlineSegment::Text(text) if !text.text.is_empty() => {
            add_inline_start_inset(items, segment_index, segment);
            let space_width = measure_text_slice_with_fonts(" ", &text.style, fonts);
            for token in tokenize(&text.text) {
                add_token_items(items, segment_index, segment, &token, space_width, fonts);
            }
            add_inline_end_inset(items, segment_index, segment);
        }
        InlineSegment::Text(_) => {}
    }
}

fn add_token_items(
    items: &mut Vec<KpItem>,
    segment_index: usize,
    segment: &InlineSegment,
    token: &str,
    space_width: f64,
    fonts: &TextMeasurementFonts<'_>,
) {
    if token == "\n" {
        add_forced_break(items, Some(segment_index), 1);
    } else if token == " " {
        items.push(KpItem::Glue(KpGlue {
            width: space_width,
            stretch: space_width * 1.5,
            shrink: space_width * 0.5,
            text: " ",
            segment_index: Some(segment_index),
            source_length: Some(1),
        }));
    } else {
        add_word_items(items, segment_index, segment, token, fonts);
    }
}

fn add_word_items(
    items: &mut Vec<KpItem>,
    segment_index: usize,
    segment: &InlineSegment,
    word: &str,
    fonts: &TextMeasurementFonts<'_>,
) {
    let options = line_break_options_from_style(segment);
    let parts = split_line_break_segments(word, &options);
    if parts.len() <= 1 {
        add_hyphenated_word_items(items, segment_index, segment, word, fonts);
        return;
    }

    for (index, part) in parts.iter().enumerate() {
        add_hyphenated_word_items(items, segment_index, segment, part, fonts);
        if let Some(next) = parts.get(index + 1) {
            add_inter_character_glue(items, segment, part, next, fonts);
        }
    }
}

fn add_hyphenated_word_items(
    items: &mut Vec<KpItem>,
    segment_index: usize,
    segment: &InlineSegment,
    word: &str,
    fonts: &TextMeasurementFonts<'_>,
) {
    let hyphen_points = find_hyphenation_points(word, "en-us");
    if hyphen_points.is_empty() {
        add_text_box(items, segment_index, segment, word, fonts);
        return;
    }

    let hyphen_width = measure_text_slice_with_fonts("-", segment.style(), fonts);
    let mut previous = 0usize;
    for point in hyphen_points {
        if point <= previous || point >= word.len() {
            continue;
        }
        add_text_box(items, segment_index, segment, &word[previous..point], fonts);
        items.push(KpItem::Penalty(KpPenalty {
            width: hyphen_width,
            penalty: HYPHEN_PENALTY,
            flagged: true,
        }));
        previous = point;
    }
    if previous < word.len() {
        add_text_box(items, segment_index, segment, &word[previous..], fonts);
    }
}

fn add_text_box(
    items: &mut Vec<KpItem>,
    segment_index: usize,
    segment: &InlineSegment,
    text: &str,
    fonts: &TextMeasurementFonts<'_>,
) {
    items.push(KpItem::Box(KpBox {
        width: measure_text_slice_with_fonts(text, segment.style(), fonts),
        text: text.to_owned(),
        segment_index,
        atom_index: None,
    }));
}

fn add_leading_space_marker(items: &mut Vec<KpItem>, segment_index: usize) {
    items.push(KpItem::Box(KpBox {
        width: 0.0,
        text: " ".to_owned(),
        segment_index,
        atom_index: None,
    }));
}

fn add_inline_start_inset(items: &mut Vec<KpItem>, segment_index: usize, segment: &InlineSegment) {
    let InlineSegment::Text(text) = segment else {
        return;
    };
    if !text.border_start {
        return;
    }
    let inset = border_width(&text.style, "borderLeft")
        + number_style(&text.style, "paddingLeft").unwrap_or(0.0);
    if inset > 0.0 {
        items.push(KpItem::Box(KpBox {
            width: inset,
            text: String::new(),
            segment_index,
            atom_index: None,
        }));
    }
}

fn add_inline_end_inset(items: &mut Vec<KpItem>, segment_index: usize, segment: &InlineSegment) {
    let InlineSegment::Text(text) = segment else {
        return;
    };
    if !text.border_end {
        return;
    }
    let inset = number_style(&text.style, "paddingRight").unwrap_or(0.0)
        + border_width(&text.style, "borderRight");
    if inset > 0.0 {
        items.push(KpItem::Box(KpBox {
            width: inset,
            text: String::new(),
            segment_index,
            atom_index: None,
        }));
    }
}

fn add_inter_character_glue(
    items: &mut Vec<KpItem>,
    segment: &InlineSegment,
    before: &str,
    after: &str,
    fonts: &TextMeasurementFonts<'_>,
) {
    let before_edge = last_text_unit(before);
    let after_edge = first_text_unit(after);
    if before_edge.is_empty() || after_edge.is_empty() {
        return;
    }
    let reference = if contains_cjk(before) {
        before_edge
    } else {
        after_edge
    };
    items.push(KpItem::Glue(KpGlue {
        width: 0.0,
        stretch: measure_text_slice_with_fonts(&reference, segment.style(), fonts),
        shrink: 0.0,
        text: "",
        segment_index: None,
        source_length: None,
    }));
}

fn add_forced_break(items: &mut Vec<KpItem>, segment_index: Option<usize>, source_length: usize) {
    items.push(KpItem::Glue(KpGlue {
        width: 0.0,
        stretch: 1_000_000.0,
        shrink: 0.0,
        text: "",
        segment_index,
        source_length: Some(source_length),
    }));
    items.push(KpItem::Penalty(KpPenalty {
        width: 0.0,
        penalty: FORCED_BREAK_PENALTY,
        flagged: false,
    }));
}

fn advance_source_offsets(offsets: &mut [usize], items: &[KpItem], start: usize, end: usize) {
    for item in items.iter().take(end).skip(start) {
        match item {
            KpItem::Box(item_box) if item_box.atom_index.is_none() => {
                add_source_offset(offsets, item_box.segment_index, utf16_len(&item_box.text));
            }
            KpItem::Glue(glue) => {
                if let Some(segment_index) = glue.segment_index {
                    add_source_offset(
                        offsets,
                        segment_index,
                        glue.source_length.unwrap_or_else(|| utf16_len(glue.text)),
                    );
                }
            }
            KpItem::Box(_) | KpItem::Penalty(_) => {}
        }
    }
}

fn add_source_offset(offsets: &mut [usize], segment_index: usize, length: usize) {
    if let Some(offset) = offsets.get_mut(segment_index) {
        *offset += length;
    }
}

fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut mode = TokenMode::None;

    for character in text.chars() {
        match character {
            '\n' => {
                flush_token(&mut tokens, &mut current, &mut mode);
                tokens.push("\n".to_owned());
            }
            ' ' | '\t' => {
                if !matches!(mode, TokenMode::Space) {
                    flush_token(&mut tokens, &mut current, &mut mode);
                    tokens.push(" ".to_owned());
                    mode = TokenMode::Space;
                }
            }
            _ => {
                if !matches!(mode, TokenMode::Word) {
                    flush_token(&mut tokens, &mut current, &mut mode);
                    mode = TokenMode::Word;
                }
                current.push(character);
            }
        }
    }
    flush_token(&mut tokens, &mut current, &mut mode);
    tokens
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenMode {
    None,
    Space,
    Word,
}

fn flush_token(tokens: &mut Vec<String>, current: &mut String, mode: &mut TokenMode) {
    if !current.is_empty() {
        tokens.push(std::mem::take(current));
    }
    *mode = TokenMode::None;
}

fn line_break_options_from_style(segment: &InlineSegment) -> LineBreakOptions {
    LineBreakOptions::from_style(
        string_style(segment.style(), "lineBreak").as_deref(),
        string_style(segment.style(), "wordBreak").as_deref(),
        string_style(segment.style(), "language").as_deref(),
    )
}

fn first_text_unit(text: &str) -> String {
    split_text_units(text)
        .into_iter()
        .next()
        .unwrap_or_default()
}

fn last_text_unit(text: &str) -> String {
    split_text_units(text)
        .into_iter()
        .last()
        .unwrap_or_default()
}

pub(crate) fn solve_kp(
    items: &[KpItem],
    line_width: impl Into<LineWidthSpec>,
) -> Option<Vec<usize>> {
    if items.is_empty() {
        return None;
    }

    let line_width = line_width.into();
    let sums = build_sums(items);
    let mut nodes = vec![KpBreakpoint {
        position: -1,
        line: 0,
        demerits: 0.0,
        ratio: 0.0,
        fitness: FitnessClass::Tight,
        prev: None,
    }];
    let mut active = vec![0usize];
    let mut best: Option<usize> = None;

    for index in 0..items.len() {
        if !is_legal_break(items, index) {
            continue;
        }
        let forced = matches!(
            items.get(index),
            Some(KpItem::Penalty(penalty)) if penalty.penalty == f64::NEG_INFINITY
        );
        let finishing = forced && index == items.len() - 1;
        let result = step_break(
            StepContext {
                items,
                position: index,
                line_width,
                sums: &sums,
                forced,
                finishing,
            },
            &active,
            &mut nodes,
        );
        active = result.active;
        if let Some(finished) = result.finished {
            best = better_node(best, finished, &nodes);
        }
        if active.is_empty() && best.is_none() {
            return None;
        }
    }

    best.map(|index| collect_break_positions(index, &nodes))
}

pub(crate) fn emergency_breaks(
    items: &[KpItem],
    line_width: impl Into<LineWidthSpec>,
) -> Vec<usize> {
    let line_width = line_width.into();
    let mut positions = Vec::new();
    let mut current_width = 0.0;

    for (index, item) in items.iter().enumerate() {
        match item {
            KpItem::Penalty(penalty) if penalty.penalty == f64::NEG_INFINITY => {
                positions.push(index);
                current_width = 0.0;
            }
            KpItem::Box(item_box) => {
                let current_line_width = line_width.resolve(positions.len());
                current_width = emergency_box(
                    items,
                    &mut positions,
                    index,
                    item_box.width,
                    current_width,
                    current_line_width,
                );
            }
            KpItem::Glue(glue) => {
                current_width += glue.width;
            }
            KpItem::Penalty(_) => {}
        }
    }

    positions
}

struct StepResult {
    active: Vec<usize>,
    finished: Option<usize>,
}

struct StepContext<'a> {
    items: &'a [KpItem],
    position: usize,
    line_width: LineWidthSpec,
    sums: &'a [CumulativeSums],
    forced: bool,
    finishing: bool,
}

fn step_break(
    context: StepContext<'_>,
    active: &[usize],
    nodes: &mut Vec<KpBreakpoint>,
) -> StepResult {
    let mut candidates = CandidateState::default();
    let mut survivors = Vec::new();
    let mut finished = None;

    for node_index in active {
        let node = nodes[*node_index].clone();
        let ratio = adjustment_ratio(
            context.items,
            node.position,
            context.position,
            context.line_width.resolve(node.line),
            context.sums,
        );
        if ratio < -1.0 {
            if context.forced {
                let created =
                    push_breakpoint(*node_index, context.position, ratio, context.items, nodes);
                record_breakpoint(
                    created,
                    context.finishing,
                    &mut candidates,
                    &mut finished,
                    nodes,
                );
            }
            continue;
        }
        if ratio > TOLERANCE {
            if context.forced {
                let created =
                    push_breakpoint(*node_index, context.position, ratio, context.items, nodes);
                record_breakpoint(
                    created,
                    context.finishing,
                    &mut candidates,
                    &mut finished,
                    nodes,
                );
            } else {
                survivors.push(*node_index);
            }
            continue;
        }

        let created = push_breakpoint(*node_index, context.position, ratio, context.items, nodes);
        if context.finishing {
            finished = better_node(finished, created, nodes);
        } else {
            candidates.add(created, nodes);
            if !context.forced {
                survivors.push(*node_index);
            }
        }
    }

    survivors.extend(candidates.values());
    StepResult {
        active: survivors,
        finished,
    }
}

fn record_breakpoint(
    index: usize,
    finishing: bool,
    candidates: &mut CandidateState,
    finished: &mut Option<usize>,
    nodes: &[KpBreakpoint],
) {
    if finishing {
        *finished = better_node(*finished, index, nodes);
    } else {
        candidates.add(index, nodes);
    }
}

fn push_breakpoint(
    previous: usize,
    position: usize,
    ratio: f64,
    items: &[KpItem],
    nodes: &mut Vec<KpBreakpoint>,
) -> usize {
    let node = make_breakpoint(&nodes[previous], previous, position, ratio, items);
    nodes.push(node);
    nodes.len() - 1
}

fn make_breakpoint(
    previous: &KpBreakpoint,
    previous_index: usize,
    position: usize,
    ratio: f64,
    items: &[KpItem],
) -> KpBreakpoint {
    let badness = if ratio < -1.0 {
        INF_BADNESS
    } else {
        (100.0 * ratio.abs().powi(3)).min(INF_BADNESS)
    };
    let penalty = item_penalty(items.get(position));
    let mut demerits = if penalty.is_finite() {
        if penalty >= 0.0 {
            (1.0 + badness + penalty).powi(2)
        } else {
            (1.0 + badness).powi(2) - penalty.powi(2)
        }
    } else {
        (1.0 + badness).powi(2)
    };

    if item_is_flagged_penalty(items.get(position))
        && previous.position >= 0
        && item_is_flagged_penalty(items.get(previous.position as usize))
    {
        demerits += FLAGGED_DEMERITS;
    }

    let fitness = fitness_class_for_ratio(ratio);
    if previous.position >= 0 && fitness_distance(previous.fitness, fitness) > 1 {
        demerits += FITNESS_DEMERITS;
    }

    KpBreakpoint {
        position: position as isize,
        line: previous.line + 1,
        demerits: demerits + previous.demerits,
        ratio,
        fitness,
        prev: Some(previous_index),
    }
}

#[derive(Default)]
struct CandidateState {
    very_tight: Option<usize>,
    tight: Option<usize>,
    loose: Option<usize>,
    very_loose: Option<usize>,
}

impl CandidateState {
    fn add(&mut self, index: usize, nodes: &[KpBreakpoint]) {
        let slot = match nodes[index].fitness {
            FitnessClass::VeryTight => &mut self.very_tight,
            FitnessClass::Tight => &mut self.tight,
            FitnessClass::Loose => &mut self.loose,
            FitnessClass::VeryLoose => &mut self.very_loose,
        };
        *slot = better_node(*slot, index, nodes);
    }

    fn values(self) -> Vec<usize> {
        [self.very_tight, self.tight, self.loose, self.very_loose]
            .into_iter()
            .flatten()
            .collect()
    }
}

fn build_sums(items: &[KpItem]) -> Vec<CumulativeSums> {
    let mut sums = Vec::with_capacity(items.len() + 1);
    sums.push(CumulativeSums {
        width: 0.0,
        stretch: 0.0,
        shrink: 0.0,
    });
    for item in items {
        let previous = *sums.last().expect("sums has seed");
        let next = match item {
            KpItem::Box(item_box) => CumulativeSums {
                width: previous.width + item_box.width,
                ..previous
            },
            KpItem::Glue(glue) => CumulativeSums {
                width: previous.width + glue.width,
                stretch: previous.stretch + glue.stretch,
                shrink: previous.shrink + glue.shrink,
            },
            KpItem::Penalty(_) => previous,
        };
        sums.push(next);
    }
    sums
}

fn better_node(current: Option<usize>, candidate: usize, nodes: &[KpBreakpoint]) -> Option<usize> {
    match current {
        Some(current) if nodes[current].demerits <= nodes[candidate].demerits => Some(current),
        _ => Some(candidate),
    }
}

fn collect_break_positions(mut index: usize, nodes: &[KpBreakpoint]) -> Vec<usize> {
    let mut positions = Vec::new();
    loop {
        let node = &nodes[index];
        if node.position >= 0 {
            positions.push(node.position as usize);
        }
        let Some(previous) = node.prev else {
            break;
        };
        index = previous;
    }
    positions.reverse();
    positions
}

fn is_legal_break(items: &[KpItem], index: usize) -> bool {
    match items.get(index) {
        Some(KpItem::Penalty(penalty)) => penalty.penalty < f64::INFINITY,
        Some(KpItem::Glue(_)) => index > 0 && matches!(items.get(index - 1), Some(KpItem::Box(_))),
        Some(KpItem::Box(_)) | None => false,
    }
}

fn adjustment_ratio(
    items: &[KpItem],
    start_pos: isize,
    end_pos: usize,
    line_width: f64,
    sums: &[CumulativeSums],
) -> f64 {
    let dims = line_dimensions(items, start_pos, end_pos, sums);
    let penalty_width = match items.get(end_pos) {
        Some(KpItem::Penalty(penalty)) => penalty.width,
        _ => 0.0,
    };
    let adjustment = line_width - (dims.width + penalty_width);
    if adjustment > 0.0 {
        if dims.stretch > 0.0 {
            adjustment / dims.stretch
        } else {
            INF_BADNESS
        }
    } else if adjustment < 0.0 {
        if dims.shrink > 0.0 {
            adjustment / dims.shrink
        } else {
            -INF_BADNESS
        }
    } else {
        0.0
    }
}

fn line_dimensions(
    items: &[KpItem],
    start_pos: isize,
    end_pos: usize,
    sums: &[CumulativeSums],
) -> CumulativeSums {
    let from = (start_pos + 1) as usize;
    let mut width = sums[end_pos].width - sums[from].width;
    let mut stretch = sums[end_pos].stretch - sums[from].stretch;
    let mut shrink = sums[end_pos].shrink - sums[from].shrink;

    for item in items.iter().take(end_pos).skip(from) {
        match item {
            KpItem::Box(_) => break,
            KpItem::Glue(glue) => {
                width -= glue.width;
                stretch -= glue.stretch;
                shrink -= glue.shrink;
            }
            KpItem::Penalty(_) => {}
        }
    }

    CumulativeSums {
        width,
        stretch,
        shrink,
    }
}

fn emergency_box(
    items: &[KpItem],
    positions: &mut Vec<usize>,
    index: usize,
    box_width: f64,
    current_width: f64,
    line_width: f64,
) -> f64 {
    if current_width + box_width <= line_width || current_width == 0.0 {
        return current_width + box_width;
    }

    let start = positions.last().map_or(0, |position| position + 1);
    let mut break_pos = None;
    for cursor in (start..index).rev() {
        match items.get(cursor) {
            Some(KpItem::Glue(_)) => {
                break_pos = Some(cursor);
                break;
            }
            Some(KpItem::Penalty(penalty)) if penalty.penalty.is_finite() => {
                break_pos = Some(cursor);
                break;
            }
            _ => {}
        }
    }

    if let Some(break_pos) = break_pos {
        positions.push(break_pos);
        return items
            .iter()
            .take(index + 1)
            .skip(break_pos + 1)
            .map(|item| match item {
                KpItem::Box(item_box) => item_box.width,
                KpItem::Glue(glue) => glue.width,
                KpItem::Penalty(_) => 0.0,
            })
            .sum();
    }

    if index > 0 {
        positions.push(index - 1);
        return box_width;
    }

    current_width + box_width
}

fn item_penalty(item: Option<&KpItem>) -> f64 {
    match item {
        Some(KpItem::Penalty(penalty)) => penalty.penalty,
        _ => 0.0,
    }
}

fn item_is_flagged_penalty(item: Option<&KpItem>) -> bool {
    matches!(item, Some(KpItem::Penalty(penalty)) if penalty.flagged)
}

fn fitness_class_for_ratio(ratio: f64) -> FitnessClass {
    if ratio < -0.5 {
        FitnessClass::VeryTight
    } else if ratio <= 0.5 {
        FitnessClass::Tight
    } else if ratio <= 1.0 {
        FitnessClass::Loose
    } else {
        FitnessClass::VeryLoose
    }
}

fn fitness_distance(left: FitnessClass, right: FitnessClass) -> usize {
    left.abs_diff(right)
}

impl FitnessClass {
    fn abs_diff(self, other: Self) -> usize {
        let left = self as isize;
        let right = other as isize;
        left.abs_diff(right)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map, Value};

    use super::{
        build_kp_items, emergency_breaks, layout_optimal_lines, solve_kp, KpBox, KpGlue, KpItem,
        KpPenalty, LineWidthSpec,
    };
    use crate::layout::inline_segment::{AtomSegment, InlineSegment, TextSegment};

    fn word(width: f64) -> KpItem {
        KpItem::Box(KpBox {
            width,
            text: "word".to_owned(),
            segment_index: 0,
            atom_index: None,
        })
    }

    fn space(width: f64, stretch: f64, shrink: f64) -> KpItem {
        KpItem::Glue(KpGlue {
            width,
            stretch,
            shrink,
            text: " ",
            segment_index: Some(0),
            source_length: Some(1),
        })
    }

    fn forced_break() -> KpItem {
        KpItem::Penalty(KpPenalty {
            width: 0.0,
            penalty: f64::NEG_INFINITY,
            flagged: false,
        })
    }

    #[test]
    fn solves_balanced_breaks_with_forced_finish() {
        let items = vec![
            word(40.0),
            space(10.0, 15.0, 5.0),
            word(40.0),
            space(10.0, 15.0, 5.0),
            word(40.0),
            space(10.0, 15.0, 5.0),
            word(40.0),
            space(0.0, 1_000_000.0, 0.0),
            forced_break(),
        ];

        assert_eq!(solve_kp(&items, 95.0), Some(vec![3, 8]));
    }

    #[test]
    fn forced_breaks_are_mandatory_before_final_finish() {
        let items = vec![word(20.0), forced_break(), word(20.0), forced_break()];

        assert_eq!(solve_kp(&items, 100.0), Some(vec![1, 3]));
    }

    #[test]
    fn solver_restores_width_after_forced_first_line() {
        let items = vec![
            word(40.0),
            forced_break(),
            word(40.0),
            space(5.0, 10.0, 2.0),
            word(40.0),
            space(0.0, 1_000_000.0, 0.0),
            forced_break(),
        ];
        let line_width = LineWidthSpec::FirstAndSubsequent {
            first_line: 40.0,
            subsequent_lines: 85.0,
        };

        assert_eq!(solve_kp(&items, line_width), Some(vec![1, 6]));
    }

    #[test]
    fn normal_breaks_match_ts_negative_spacing_tolerance() {
        let items = vec![
            word(20.0),
            space(10.0, 20.0, 5.0),
            word(20.0),
            space(10.0, 20.0, 5.0),
            word(20.0),
            space(0.0, 1_000_000.0, 0.0),
            forced_break(),
        ];

        assert_eq!(solve_kp(&items, 55.0), Some(vec![3, 6]));
    }

    #[test]
    fn returns_none_when_no_active_solution_survives() {
        let items = vec![word(200.0), space(0.0, 1_000_000.0, 0.0), forced_break()];

        assert_eq!(solve_kp(&items, 50.0), None);
    }

    #[test]
    fn emergency_breaks_use_previous_glue_before_overflow() {
        let items = vec![
            word(30.0),
            space(5.0, 10.0, 2.0),
            word(30.0),
            space(5.0, 10.0, 2.0),
            word(30.0),
            space(0.0, 1_000_000.0, 0.0),
            forced_break(),
        ];

        assert_eq!(emergency_breaks(&items, 65.0), vec![3, 6]);
    }

    #[test]
    fn emergency_breaks_restore_width_after_first_line() {
        let items = vec![
            word(40.0),
            space(5.0, 10.0, 2.0),
            word(40.0),
            space(5.0, 10.0, 2.0),
            word(40.0),
            forced_break(),
        ];
        let line_width = LineWidthSpec::FirstAndSubsequent {
            first_line: 50.0,
            subsequent_lines: 100.0,
        };

        assert_eq!(emergency_breaks(&items, line_width), vec![1, 5]);
    }

    #[test]
    fn avoids_consecutive_flagged_penalty_when_later_break_fits() {
        let items = vec![
            word(20.0),
            KpItem::Penalty(KpPenalty {
                width: 5.0,
                penalty: 50.0,
                flagged: true,
            }),
            word(20.0),
            KpItem::Penalty(KpPenalty {
                width: 5.0,
                penalty: 50.0,
                flagged: true,
            }),
            word(20.0),
            space(0.0, 1_000_000.0, 0.0),
            forced_break(),
        ];

        assert_eq!(solve_kp(&items, 45.0), Some(vec![3, 6]));
    }

    #[test]
    fn builds_kp_items_from_text_tokens_and_forced_breaks() {
        let items = build_kp_items(&[text_segment("a  b\nc")]);
        let kinds = item_kinds(&items);

        assert_eq!(
            kinds,
            [
                "box:a",
                "glue: ",
                "box:b",
                "glue:",
                "penalty:-inf",
                "box:c",
                "glue:",
                "penalty:-inf"
            ]
        );
    }

    #[test]
    fn builds_atom_boxes_and_inline_inset_boxes() {
        let mut text = text_segment("edge");
        if let InlineSegment::Text(segment) = &mut text {
            segment.border_start = true;
            segment.border_end = true;
            segment.style.insert("paddingLeft".to_owned(), json!(2));
            segment.style.insert("paddingRight".to_owned(), json!(3));
            segment.style.insert(
                "borderLeft".to_owned(),
                json!({"width": 1, "style": "solid", "color": "#000"}),
            );
            segment.style.insert(
                "borderRight".to_owned(),
                json!({"width": 4, "style": "solid", "color": "#000"}),
            );
        }
        let atom = InlineSegment::Atom(AtomSegment {
            width: 12.0,
            height: 8.0,
            style: style(),
            image_src: Some("Images/pic.png".to_owned()),
            alt: None,
            href: None,
            source_path: None,
        });

        let items = build_kp_items(&[text, atom]);
        let boxes = items
            .iter()
            .filter_map(|item| match item {
                KpItem::Box(item_box) => Some((item_box.text.as_str(), item_box.width)),
                KpItem::Glue(_) | KpItem::Penalty(_) => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(boxes[0], ("", 3.0));
        assert_eq!(boxes[2], ("", 7.0));
        assert_eq!(boxes[3], ("\u{fffc}", 12.0));
    }

    #[test]
    fn builds_hyphenation_penalties_for_ascii_words() {
        let items = build_kp_items(&[text_segment("hyphenation")]);

        assert!(items.iter().any(|item| matches!(
            item,
            KpItem::Penalty(KpPenalty {
                penalty: 50.0,
                flagged: true,
                ..
            })
        )));
        assert_eq!(item_text(&items), "hyphenation");
    }

    #[test]
    fn matches_ts_hyphenation_for_explicit_non_english_language() {
        let mut segment = text_segment("hyphenation");
        if let InlineSegment::Text(text) = &mut segment {
            text.style
                .insert("language".to_owned(), Value::String("ja".to_owned()));
        }

        let items = build_kp_items(&[segment]);

        assert!(items.iter().any(|item| matches!(
            item,
            KpItem::Penalty(KpPenalty {
                penalty: 50.0,
                flagged: true,
                ..
            })
        )));
        assert_eq!(item_text(&items), "hyphenation");
    }

    #[test]
    fn inserts_inter_character_glue_between_cjk_parts() {
        let mut segment = text_segment("猫犬");
        if let InlineSegment::Text(text) = &mut segment {
            text.style
                .insert("language".to_owned(), Value::String("ja".to_owned()));
            text.style
                .insert("lineBreak".to_owned(), Value::String("strict".to_owned()));
        }

        let items = build_kp_items(&[segment]);

        assert!(items.iter().any(|item| {
            matches!(
                item,
                KpItem::Glue(KpGlue {
                    width: 0.0,
                    shrink: 0.0,
                    text: "",
                    ..
                })
            )
        }));
        assert_eq!(item_text(&items), "猫犬");
    }

    #[test]
    fn lays_out_optimal_lines_from_items_and_solver() {
        let lines = layout_optimal_lines(&[text_segment("one two three four")], 60.0);

        assert_eq!(lines.len(), 2);
        assert_eq!(line_text(&lines[0]), "one two");
        assert_eq!(line_text(&lines[1]), "three four");
    }

    #[test]
    fn optimal_line_rebuild_preserves_source_offsets_across_lines() {
        let lines = layout_optimal_lines(&[source_text_segment("one two three four")], 60.0);

        let offsets = lines
            .iter()
            .filter_map(first_text_run_source_offset)
            .collect::<Vec<_>>();

        assert_eq!(offsets, vec![0, 8]);
    }

    #[test]
    fn optimal_line_rebuild_matches_ts_break_all_for_consecutive_dash_runs() {
        let mut segments = vec![
            sourced_segment(" ", vec![1, 0]),
            sourced_segment(&"-".repeat(44), vec![1, 8, 0]),
            sourced_segment(" ", vec![1, 9]),
            sourced_segment(&"-".repeat(27), vec![1, 35, 0]),
            sourced_segment(" ", vec![1, 36]),
        ];
        for segment in &mut segments {
            let InlineSegment::Text(text) = segment else {
                continue;
            };
            text.style.insert("fontSize".to_owned(), json!(16));
            text.style.insert("lineHeight".to_owned(), json!(1.2));
            text.style.insert("textIndent".to_owned(), json!(24));
            text.style.insert("textAlign".to_owned(), json!("justify"));
        }
        for index in [1, 3] {
            let Some(InlineSegment::Text(text)) = segments.get_mut(index) else {
                continue;
            };
            text.style
                .insert("wordBreak".to_owned(), json!("break-all"));
        }

        let lines = layout_optimal_lines(&segments, 520.0);

        assert_eq!(lines.len(), 2);
        let first_runs = text_runs(&lines[0]);
        let second_runs = text_runs(&lines[1]);
        assert_eq!(first_runs.len(), 1);
        assert_eq!(second_runs.len(), 1);
        assert_eq!(line_text(&lines[0]), "-".repeat(44));
        assert_eq!(line_text(&lines[1]), "-".repeat(27));
        assert!((first_runs[0].x - 24.0).abs() < f64::EPSILON);
        assert!((first_runs[0].width - 422.4).abs() < 1e-9);
        assert!(second_runs[0].x.abs() < f64::EPSILON);
        assert!((second_runs[0].width - 259.2).abs() < 1e-9);
        assert_eq!(
            first_text_run(&lines[0]).and_then(|run| run.source_path.as_deref()),
            Some([1, 8, 0].as_slice())
        );
        assert_eq!(
            first_text_run(&lines[1]).and_then(|run| run.source_path.as_deref()),
            Some([1, 35, 0].as_slice())
        );
        assert_eq!(first_text_run_source_offset(&lines[1]), Some(0));
    }

    #[test]
    fn optimal_line_rebuild_matches_ts_cjk_breaks_under_text_indent() {
        let mut segment = source_text_segment("当年，我以三男的身分出生于一个还算富裕的家庭。有两个哥哥一个姐姐和一个弟弟，是五兄弟里的老四。小学时期，是在「小小年纪却如此聪明」的称赞声中成长。虽然对念书并不在行，不过是个很会玩游戏也擅长运动，容易得意忘形的家伙。同时还是班上的中心人物。");
        let InlineSegment::Text(text_segment) = &mut segment else {
            panic!("text segment expected");
        };
        text_segment.style.insert("fontSize".to_owned(), json!(16));
        text_segment
            .style
            .insert("lineHeight".to_owned(), json!(1.3));
        text_segment
            .style
            .insert("lineHeightPx".to_owned(), json!(20.8));
        text_segment
            .style
            .insert("textIndent".to_owned(), json!(32));

        let lines = layout_optimal_lines(&[segment], 520.0);
        let offsets = lines
            .iter()
            .filter_map(first_text_run_source_offset)
            .collect::<Vec<_>>();
        let texts = lines.iter().map(line_text).collect::<Vec<_>>();

        assert_eq!(
            texts
                .iter()
                .map(|text| text.chars().count())
                .collect::<Vec<_>>(),
            vec![50, 54, 16]
        );
        assert_eq!(offsets, vec![0, 50, 104]);
    }

    #[test]
    fn optimal_line_rebuild_matches_late_cjk_breaks_under_text_indent() {
        let mut segment = source_text_segment("「学校并不是那么美好的地方喔。礼仪规矩拘束无聊又一点用都没有，历史那种东西就算知道也没有意义。还有，你绝对会遭到霸凌。因为这附近的贵族家死小鬼们都会前往学校，而且全是一些自己不是第一就不甘心的家伙。看到像你这样的人，应该会成群结党地来霸凌你吧。理由大概会是『你这家伙身分这么低，却比父亲是某某侯爵的我在某某方面更厉害，实在太嚣张了』之类。」");
        let InlineSegment::Text(text_segment) = &mut segment else {
            panic!("text segment expected");
        };
        text_segment.style.insert("fontSize".to_owned(), json!(16));
        text_segment
            .style
            .insert("lineHeight".to_owned(), json!(1.3));
        text_segment
            .style
            .insert("lineHeightPx".to_owned(), json!(20.8));
        text_segment
            .style
            .insert("textIndent".to_owned(), json!(32));

        let lines = layout_optimal_lines(&[segment], 520.0);
        let offsets = lines
            .iter()
            .filter_map(first_text_run_source_offset)
            .collect::<Vec<_>>();
        let lengths = lines
            .iter()
            .map(line_text)
            .map(|text| text.chars().count())
            .collect::<Vec<_>>();

        assert_eq!(lengths, vec![50, 53, 54, 13]);
        assert_eq!(offsets, vec![0, 50, 103, 157]);
    }

    #[test]
    fn optimal_line_rebuild_applies_inline_end_paint_only_on_final_fragment() {
        let lines = layout_optimal_lines(&[inline_end_text_segment("one two three four")], 60.0);

        let first = first_text_run(&lines[0]).expect("first line text run");
        let last = last_text_run(lines.last().expect("last line")).expect("last line text run");

        assert!(paint_path(&first.paint, &["border", "end"]).is_none());
        assert_eq!(first.inline_margin_right, None);
        assert!(!last.text.is_empty());
        assert!(paint_path(&last.paint, &["border", "end"]).is_some());
        assert_eq!(last.inline_margin_right, Some(7.0));
    }

    #[test]
    fn optimal_line_rebuild_respects_nowrap_white_space() {
        let lines = layout_optimal_lines(&[nowrap_text_segment("one two three four")], 30.0);

        assert_eq!(lines.len(), 1);
        assert_eq!(line_text(&lines[0]), "one two three four");
    }

    #[test]
    fn optimal_line_rebuild_preserves_pre_wrap_spaces_via_greedy_path() {
        let lines = layout_optimal_lines(&[pre_wrap_text_segment("one  two")], 200.0);

        assert_eq!(lines.len(), 1);
        assert_eq!(line_text(&lines[0]), "one  two");
    }

    #[test]
    fn optimal_line_rebuild_trims_collapsible_leading_ascii_space() {
        let lines = layout_optimal_lines(&[source_text_segment(" lead")], 200.0);

        assert_eq!(line_text(&lines[0]), "lead");
        assert_eq!(first_text_run_source_offset(&lines[0]), Some(0));
    }

    #[test]
    fn optimal_line_rebuild_trims_leading_space_with_text_indent() {
        let mut segment = source_text_segment(" lead");
        let InlineSegment::Text(text_segment) = &mut segment else {
            panic!("text segment expected");
        };
        text_segment
            .style
            .insert("textIndent".to_owned(), json!(12));

        let lines = layout_optimal_lines(&[segment], 200.0);

        assert_eq!(line_text(&lines[0]), "lead");
        assert_eq!(first_text_run(&lines[0]).map(|run| run.x), Some(12.0));
        assert_eq!(first_text_run_source_offset(&lines[0]), Some(0));
    }

    #[test]
    fn optimal_line_rebuild_skips_collapsible_whitespace_only_segments() {
        let lines = layout_optimal_lines(&[text_segment(" "), text_segment("lead")], 200.0);

        assert_eq!(lines.len(), 1);
        assert_eq!(line_text(&lines[0]), "lead");
    }

    #[test]
    fn optimal_line_rebuild_does_not_emit_leading_empty_line_for_newline_segment() {
        let lines = layout_optimal_lines(&[text_segment("\n"), text_segment("lead")], 200.0);

        assert_eq!(lines.len(), 1);
        assert_eq!(line_text(&lines[0]), "lead");
    }

    #[test]
    fn optimal_line_rebuild_keeps_br_only_empty_line() {
        let lines = layout_optimal_lines(&[text_segment("\n")], 200.0);

        assert_eq!(lines.len(), 1);
        assert!(lines[0].runs.is_empty());
        assert_eq!(lines[0].height, 12.0);
    }

    #[test]
    fn optimal_line_rebuild_keeps_multiple_forced_empty_lines() {
        let lines = layout_optimal_lines(&[text_segment("\n\n\n")], 200.0);

        assert_eq!(lines.len(), 3);
        assert!(lines.iter().all(|line| line.runs.is_empty()));
        assert_eq!(lines[2].y, 24.0);
    }

    #[test]
    fn optimal_line_rebuild_keeps_inline_atoms() {
        let atom = InlineSegment::Atom(AtomSegment {
            width: 12.0,
            height: 8.0,
            style: style(),
            image_src: Some("Images/pic.png".to_owned()),
            alt: Some("cover".to_owned()),
            href: Some("chapter.xhtml#image".to_owned()),
            source_path: None,
        });

        let lines = layout_optimal_lines(&[text_segment("see"), atom], 80.0);

        assert_eq!(lines.len(), 1);
        assert!(lines[0].runs.iter().any(|run| matches!(run, crate::layout::line::LineRun::Atom(atom) if atom.image_src.as_deref() == Some("Images/pic.png"))));
    }

    #[test]
    fn optimal_line_rebuild_keeps_source_provenance_across_inline_atom() {
        let mut left = source_text_segment("left");
        let InlineSegment::Text(left_segment) = &mut left else {
            unreachable!();
        };
        left_segment.source_path = Some(vec![1, 0]);
        left_segment.source_text = Some(" left".to_owned());
        left_segment.source_text_offset = Some(1);

        let atom = InlineSegment::Atom(AtomSegment {
            width: 12.0,
            height: 8.0,
            style: style(),
            image_src: Some("Images/pic.png".to_owned()),
            alt: None,
            href: None,
            source_path: Some(vec![1, 1]),
        });

        let mut right = source_text_segment("right");
        let InlineSegment::Text(right_segment) = &mut right else {
            unreachable!();
        };
        right_segment.source_path = Some(vec![1, 2]);
        right_segment.source_text = Some("  right".to_owned());
        right_segment.source_text_offset = Some(2);

        let lines = layout_optimal_lines(&[left, atom, right], 200.0);
        let text_runs = lines[0]
            .runs
            .iter()
            .filter_map(|run| match run {
                crate::layout::line::LineRun::Text(run) => Some(run),
                crate::layout::line::LineRun::Atom(_) | crate::layout::line::LineRun::Ruby(_) => {
                    None
                }
            })
            .collect::<Vec<_>>();

        assert_eq!(text_runs.len(), 2);
        assert_eq!(text_runs[0].text, "left");
        assert_eq!(text_runs[0].source_path.as_deref(), Some([1, 0].as_slice()));
        assert_eq!(text_runs[0].source_text_offset, Some(1));
        assert_eq!(text_runs[1].text, "right");
        assert_eq!(text_runs[1].source_path.as_deref(), Some([1, 2].as_slice()));
        assert_eq!(text_runs[1].source_text_offset, Some(2));
    }

    fn text_segment(text: &str) -> InlineSegment {
        InlineSegment::Text(TextSegment {
            text: text.to_owned(),
            style: style(),
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

    fn source_text_segment(text: &str) -> InlineSegment {
        InlineSegment::Text(TextSegment {
            text: text.to_owned(),
            style: style(),
            href: None,
            source_path: Some(vec![1, 0]),
            source_text: Some(text.to_owned()),
            source_text_offset: None,
            ruby_annotation: None,
            inline_margin_left: None,
            inline_margin_right: None,
            border_start: false,
            border_end: false,
        })
    }

    fn sourced_segment(text: &str, source_path: Vec<usize>) -> InlineSegment {
        InlineSegment::Text(TextSegment {
            text: text.to_owned(),
            style: style(),
            href: None,
            source_path: Some(source_path),
            source_text: Some(text.to_owned()),
            source_text_offset: Some(0),
            ruby_annotation: None,
            inline_margin_left: None,
            inline_margin_right: None,
            border_start: false,
            border_end: false,
        })
    }

    fn inline_end_text_segment(text: &str) -> InlineSegment {
        let mut segment = source_text_segment(text);
        let InlineSegment::Text(text_segment) = &mut segment else {
            return segment;
        };
        text_segment.border_end = true;
        text_segment.inline_margin_right = Some(7.0);
        text_segment.style.insert(
            "borderRight".to_owned(),
            json!({"width": 2, "style": "solid", "color": "#111111"}),
        );
        text_segment
            .style
            .insert("paddingRight".to_owned(), json!(3));
        segment
    }

    fn nowrap_text_segment(text: &str) -> InlineSegment {
        let mut segment = text_segment(text);
        let InlineSegment::Text(text_segment) = &mut segment else {
            return segment;
        };
        text_segment
            .style
            .insert("whiteSpace".to_owned(), Value::String("nowrap".to_owned()));
        segment
    }

    fn pre_wrap_text_segment(text: &str) -> InlineSegment {
        let mut segment = text_segment(text);
        let InlineSegment::Text(text_segment) = &mut segment else {
            return segment;
        };
        text_segment.style.insert(
            "whiteSpace".to_owned(),
            Value::String("pre-wrap".to_owned()),
        );
        segment
    }

    fn style() -> Map<String, Value> {
        Map::from_iter([
            ("fontSize".to_owned(), json!(10)),
            ("lineHeight".to_owned(), json!(1.2)),
        ])
    }

    fn item_kinds(items: &[KpItem]) -> Vec<String> {
        items
            .iter()
            .map(|item| match item {
                KpItem::Box(item_box) => format!("box:{}", item_box.text),
                KpItem::Glue(glue) => format!("glue:{}", glue.text),
                KpItem::Penalty(penalty) if penalty.penalty == f64::NEG_INFINITY => {
                    "penalty:-inf".to_owned()
                }
                KpItem::Penalty(penalty) => format!("penalty:{}", penalty.penalty),
            })
            .collect()
    }

    fn item_text(items: &[KpItem]) -> String {
        items
            .iter()
            .filter_map(|item| match item {
                KpItem::Box(item_box) => Some(item_box.text.as_str()),
                KpItem::Glue(_) | KpItem::Penalty(_) => None,
            })
            .collect()
    }

    fn line_text(line: &crate::layout::line::LineBox) -> String {
        line.runs
            .iter()
            .filter_map(|run| match run {
                crate::layout::line::LineRun::Text(run) => Some(run.text.as_str()),
                crate::layout::line::LineRun::Atom(_) | crate::layout::line::LineRun::Ruby(_) => {
                    None
                }
            })
            .collect()
    }

    fn text_runs(line: &crate::layout::line::LineBox) -> Vec<&crate::layout::line::TextRunBox> {
        line.runs
            .iter()
            .filter_map(|run| match run {
                crate::layout::line::LineRun::Text(run) => Some(run),
                crate::layout::line::LineRun::Atom(_) | crate::layout::line::LineRun::Ruby(_) => {
                    None
                }
            })
            .collect()
    }

    fn first_text_run_source_offset(line: &crate::layout::line::LineBox) -> Option<usize> {
        line.runs.iter().find_map(|run| match run {
            crate::layout::line::LineRun::Text(run) => run.source_text_offset,
            crate::layout::line::LineRun::Atom(_) | crate::layout::line::LineRun::Ruby(_) => None,
        })
    }

    fn first_text_run(
        line: &crate::layout::line::LineBox,
    ) -> Option<&crate::layout::line::TextRunBox> {
        line.runs.iter().find_map(|run| match run {
            crate::layout::line::LineRun::Text(run) => Some(run),
            crate::layout::line::LineRun::Atom(_) | crate::layout::line::LineRun::Ruby(_) => None,
        })
    }

    fn last_text_run(
        line: &crate::layout::line::LineBox,
    ) -> Option<&crate::layout::line::TextRunBox> {
        line.runs.iter().rev().find_map(|run| match run {
            crate::layout::line::LineRun::Text(run) => Some(run),
            crate::layout::line::LineRun::Atom(_) | crate::layout::line::LineRun::Ruby(_) => None,
        })
    }

    fn paint_path<'a>(paint: &'a Value, path: &[&str]) -> Option<&'a Value> {
        let mut current = paint;
        for key in path {
            current = current.as_object()?.get(*key)?;
        }
        Some(current)
    }
}
