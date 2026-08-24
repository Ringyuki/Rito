use super::{
    inline_content::flatten_inline_content,
    inline_segment::{InlineSegment, SegmentContext, TextSegment},
    line::LineBox,
    line_mode::layout_lines_with_fonts,
    style_values::{border_width, number_style, positive_style, string_or_default},
    text_mapping::TextSegmentMapping,
    text_measure::TextMeasurementFonts,
};
use crate::{
    layout::LineBreaking,
    style::{StyledNode, StyledNodeKind},
};

#[derive(Debug)]
pub(crate) struct ContinuousTableModel {
    pub(crate) rows: Vec<StyledNode>,
    pub(crate) col_count: usize,
    pub(crate) occupied: Vec<Vec<bool>>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ContinuousTableInsets {
    pub(crate) padding_top: f64,
    pub(crate) padding_right: f64,
    pub(crate) padding_bottom: f64,
    pub(crate) padding_left: f64,
    pub(crate) border_top: f64,
    pub(crate) border_right: f64,
    pub(crate) border_bottom: f64,
    pub(crate) border_left: f64,
    pub(crate) inner_width: f64,
}

#[derive(Debug, Clone, Copy)]
struct ContinuousCellWidthInfo {
    min_width: f64,
    pref_width: f64,
}

pub(crate) fn build_continuous_table_model(table: &StyledNode) -> Option<ContinuousTableModel> {
    let rows = collect_continuous_table_rows(table);
    let col_count = rows
        .iter()
        .map(|row| {
            row.children
                .iter()
                .filter(|child| is_continuous_cell_node(child))
                .map(|cell| cell.colspan.unwrap_or(1).max(1) as usize)
                .sum::<usize>()
        })
        .max()
        .unwrap_or(0);
    if col_count == 0 {
        return None;
    }
    let mut occupied = vec![vec![false; col_count]; rows.len()];
    apply_continuous_rowspan_occupancy(&rows, &mut occupied, col_count);
    Some(ContinuousTableModel {
        rows,
        col_count,
        occupied,
    })
}

fn collect_continuous_table_rows(table: &StyledNode) -> Vec<StyledNode> {
    let mut rows = Vec::new();
    for child in &table.children {
        if child.node_type != StyledNodeKind::Block {
            continue;
        }
        match child.tag.as_deref() {
            Some("tr") => rows.push(child.clone()),
            Some("thead" | "tbody" | "tfoot") => {
                rows.extend(
                    child
                        .children
                        .iter()
                        .filter(|grandchild| {
                            grandchild.node_type == StyledNodeKind::Block
                                && grandchild.tag.as_deref() == Some("tr")
                        })
                        .cloned(),
                );
            }
            _ => {}
        }
    }
    rows
}

fn apply_continuous_rowspan_occupancy(
    rows: &[StyledNode],
    occupied: &mut [Vec<bool>],
    col_count: usize,
) {
    for (row_index, row) in rows.iter().enumerate() {
        let cells = row
            .children
            .iter()
            .filter(|child| is_continuous_cell_node(child))
            .collect::<Vec<_>>();
        let mut col = 0usize;
        let mut cell_index = 0usize;
        while col < col_count && cell_index < cells.len() {
            while col < col_count
                && occupied
                    .get(row_index)
                    .and_then(|row| row.get(col))
                    .copied()
                    .unwrap_or(false)
            {
                col += 1;
            }
            if col >= col_count {
                break;
            }
            let cell = cells[cell_index];
            cell_index += 1;
            let col_span = cell.colspan.unwrap_or(1).max(1) as usize;
            let row_span = cell.rowspan.unwrap_or(1).max(1) as usize;
            mark_continuous_occupied_rows(occupied, row_index, col, row_span, col_span, col_count);
            col += col_span;
        }
    }
}

fn mark_continuous_occupied_rows(
    occupied: &mut [Vec<bool>],
    row_index: usize,
    col: usize,
    row_span: usize,
    col_span: usize,
    col_count: usize,
) {
    if row_span <= 1 {
        return;
    }
    for row_offset in 1..row_span {
        let Some(row) = occupied.get_mut(row_index + row_offset) else {
            continue;
        };
        for col_offset in 0..col_span {
            if col + col_offset < col_count {
                row[col + col_offset] = true;
            }
        }
    }
}

pub(crate) fn resolve_continuous_table_insets(
    node: &StyledNode,
    content_width: f64,
) -> ContinuousTableInsets {
    let padding_top = number_style(&node.style, "paddingTop").unwrap_or(0.0);
    let padding_right = number_style(&node.style, "paddingRight").unwrap_or(0.0);
    let padding_bottom = number_style(&node.style, "paddingBottom").unwrap_or(0.0);
    let padding_left = number_style(&node.style, "paddingLeft").unwrap_or(0.0);
    let border_top = border_width(&node.style, "borderTop");
    let border_right = border_width(&node.style, "borderRight");
    let border_bottom = border_width(&node.style, "borderBottom");
    let border_left = border_width(&node.style, "borderLeft");
    ContinuousTableInsets {
        padding_top,
        padding_right,
        padding_bottom,
        padding_left,
        border_top,
        border_right,
        border_bottom,
        border_left,
        inner_width: content_width - padding_left - padding_right - border_left - border_right,
    }
}

pub(crate) fn compute_continuous_column_widths(
    rows: &[StyledNode],
    col_count: usize,
    table_width: f64,
    occupied: &[Vec<bool>],
    has_explicit_width: bool,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> Vec<f64> {
    let mut col_min = vec![0.0; col_count];
    let mut col_pref = vec![0.0; col_count];
    gather_continuous_column_constraints(
        rows,
        col_count,
        occupied,
        &mut col_min,
        &mut col_pref,
        line_breaking,
        fonts,
    );
    let pref_total = col_pref.iter().sum::<f64>();
    let effective_width = if has_explicit_width {
        table_width
    } else {
        pref_total.min(table_width)
    };
    distribute_continuous_widths(&col_min, &col_pref, effective_width)
}

fn gather_continuous_column_constraints(
    rows: &[StyledNode],
    col_count: usize,
    occupied: &[Vec<bool>],
    col_min: &mut [f64],
    col_pref: &mut [f64],
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) {
    for (row_index, row) in rows.iter().enumerate() {
        let cells = row
            .children
            .iter()
            .filter(|child| is_continuous_cell_node(child))
            .collect::<Vec<_>>();
        let mut col = 0usize;
        let mut cell_index = 0usize;
        while col < col_count && cell_index < cells.len() {
            while col < col_count
                && occupied
                    .get(row_index)
                    .and_then(|row| row.get(col))
                    .copied()
                    .unwrap_or(false)
            {
                col += 1;
            }
            if col >= col_count {
                break;
            }
            let cell = cells[cell_index];
            cell_index += 1;
            let col_span = cell.colspan.unwrap_or(1).max(1) as usize;
            if col_span == 1 {
                let info = measure_continuous_cell_widths(cell, line_breaking, fonts);
                col_min[col] = col_min[col].max(info.min_width);
                col_pref[col] = col_pref[col].max(info.pref_width);
            }
            col += col_span;
        }
    }
}

fn distribute_continuous_widths(col_min: &[f64], col_pref: &[f64], table_width: f64) -> Vec<f64> {
    let mut widths = col_min.to_vec();
    let total_min = col_min.iter().sum::<f64>();
    if total_min >= table_width || col_min.is_empty() {
        return widths;
    }
    let remaining = table_width - total_min;
    let flex_total = col_pref
        .iter()
        .enumerate()
        .map(|(index, pref_width)| (pref_width - col_min[index]).max(0.0))
        .sum::<f64>();
    if flex_total <= 0.0 {
        let extra = remaining / col_min.len() as f64;
        for width in &mut widths {
            *width += extra;
        }
        return widths;
    }
    for index in 0..col_min.len() {
        let flex = (col_pref[index] - col_min[index]).max(0.0);
        widths[index] += remaining * flex / flex_total;
    }
    widths
}

fn measure_continuous_cell_widths(
    cell: &StyledNode,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> ContinuousCellWidthInfo {
    let hpad = number_style(&cell.style, "paddingLeft").unwrap_or(0.0)
        + number_style(&cell.style, "paddingRight").unwrap_or(0.0);
    let css_width = positive_style(&cell.style, "width")
        .map(|width| width + hpad)
        .unwrap_or(0.0);
    let has_block_children = cell.children.iter().any(|child| {
        matches!(
            child.node_type,
            StyledNodeKind::Block | StyledNodeKind::Image
        )
    });

    if has_block_children {
        let mut max_min = 0.0_f64;
        let mut max_pref = 0.0_f64;
        for child in &cell.children {
            let info = measure_continuous_node_widths(child, line_breaking, fonts);
            max_min = max_min.max(info.min_width);
            max_pref = max_pref.max(info.pref_width);
        }
        let content_min = max_min + hpad;
        let content_pref = max_pref + hpad;
        if css_width > 0.0 {
            return ContinuousCellWidthInfo {
                min_width: content_min.min(css_width),
                pref_width: css_width,
            };
        }
        return ContinuousCellWidthInfo {
            min_width: content_min,
            pref_width: content_pref,
        };
    }

    let segments = flatten_inline_content(&cell.children, SegmentContext::default());
    if segments.is_empty() {
        let width = hpad.max(css_width);
        return ContinuousCellWidthInfo {
            min_width: width,
            pref_width: width,
        };
    }
    let content_min = measure_continuous_minimum_width(&segments, line_breaking, fonts) + hpad;
    let content_pref = measure_continuous_preferred_width(&segments, line_breaking, fonts) + hpad;
    if css_width > 0.0 {
        return ContinuousCellWidthInfo {
            min_width: content_min.min(css_width),
            pref_width: css_width,
        };
    }
    ContinuousCellWidthInfo {
        min_width: content_min,
        pref_width: content_pref,
    }
}

fn measure_continuous_node_widths(
    node: &StyledNode,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> ContinuousCellWidthInfo {
    match node.node_type {
        StyledNodeKind::Text | StyledNodeKind::Inline => ContinuousCellWidthInfo {
            min_width: 0.0,
            pref_width: 0.0,
        },
        StyledNodeKind::Image => {
            let width = positive_style(&node.style, "width")
                .or_else(|| number_style(&node.style, "fontSize"))
                .unwrap_or(16.0);
            ContinuousCellWidthInfo {
                min_width: width,
                pref_width: width,
            }
        }
        StyledNodeKind::Block => measure_continuous_block_node_widths(node, line_breaking, fonts),
    }
}

fn measure_continuous_block_node_widths(
    node: &StyledNode,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> ContinuousCellWidthInfo {
    let hpad = number_style(&node.style, "paddingLeft").unwrap_or(0.0)
        + number_style(&node.style, "paddingRight").unwrap_or(0.0);
    let hborder =
        border_width(&node.style, "borderLeft") + border_width(&node.style, "borderRight");
    let extra = hpad + hborder;
    if let Some(width) = positive_style(&node.style, "width") {
        let box_width =
            if string_or_default(&node.style, "boxSizing", "content-box") == "border-box" {
                width
            } else {
                width + extra
            };
        return ContinuousCellWidthInfo {
            min_width: box_width,
            pref_width: box_width,
        };
    }

    let has_block_children = node.children.iter().any(|child| {
        matches!(
            child.node_type,
            StyledNodeKind::Block | StyledNodeKind::Image
        )
    });
    if has_block_children {
        let mut max_min = 0.0_f64;
        let mut max_pref = 0.0_f64;
        for child in &node.children {
            let info = measure_continuous_node_widths(child, line_breaking, fonts);
            max_min = max_min.max(info.min_width);
            max_pref = max_pref.max(info.pref_width);
        }
        return ContinuousCellWidthInfo {
            min_width: max_min + extra,
            pref_width: max_pref + extra,
        };
    }

    let segments = flatten_inline_content(&node.children, SegmentContext::default());
    if segments.is_empty() {
        return ContinuousCellWidthInfo {
            min_width: extra,
            pref_width: extra,
        };
    }
    ContinuousCellWidthInfo {
        min_width: measure_continuous_minimum_width(&segments, line_breaking, fonts) + extra,
        pref_width: measure_continuous_preferred_width(&segments, line_breaking, fonts) + extra,
    }
}

fn measure_continuous_preferred_width(
    segments: &[InlineSegment],
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> f64 {
    let lines = layout_lines_with_fonts(segments, 1_000_000.0, line_breaking, fonts);
    lines
        .iter()
        .map(measure_line_content_width)
        .fold(0.0_f64, f64::max)
}

fn measure_continuous_minimum_width(
    segments: &[InlineSegment],
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> f64 {
    let mut max_word_width = 0.0_f64;
    for segment in segments {
        match segment {
            InlineSegment::Atom(atom) => {
                max_word_width = max_word_width.max(atom.width);
            }
            InlineSegment::Text(text) => {
                for chunk in split_continuous_breakable_chunks(&text.text) {
                    let chunk_segment = InlineSegment::Text(TextSegment {
                        text: chunk,
                        mapping: TextSegmentMapping::synthetic(),
                        style: text.style.clone(),
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
                    max_word_width = max_word_width.max(measure_continuous_preferred_width(
                        &[chunk_segment],
                        line_breaking,
                        fonts,
                    ));
                }
            }
        }
    }
    max_word_width
}

fn split_continuous_breakable_chunks(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            }
        } else if is_continuous_cjk_char(ch) {
            if !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            }
            chunks.push(ch.to_string());
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn is_continuous_cjk_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x2e80..=0x9fff | 0xf900..=0xfaff | 0xfe30..=0xfe4f | 0x20000..=0x2fa1f
    )
}

fn is_continuous_cell_node(node: &StyledNode) -> bool {
    node.node_type == StyledNodeKind::Block && matches!(node.tag.as_deref(), Some("td" | "th"))
}

pub(crate) fn has_explicit_width(style: &serde_json::Map<String, serde_json::Value>) -> bool {
    positive_style(style, "width").is_some() || style.get("widthPct").is_some()
}

fn measure_line_content_width(line: &LineBox) -> f64 {
    let mut min_left = f64::INFINITY;
    let mut max_right = 0.0_f64;
    for run in &line.runs {
        let (x, width) = run.geometry();
        min_left = min_left.min(x);
        max_right = max_right.max(x + width);
    }
    if min_left.is_infinite() {
        0.0
    } else {
        max_right - min_left
    }
}
