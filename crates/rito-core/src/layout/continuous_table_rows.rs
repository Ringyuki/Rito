use super::{
    content::{RuntimeBlock, RuntimeChild},
    continuous_layout::{layout_continuous_nodes_at, ContinuousTextLayout},
    continuous_table_model::ContinuousTableInsets,
    image_size::ImageSizeIndex,
    inline_content::flatten_inline_content,
    inline_segment::SegmentContext,
    line::LineBox,
    line_mode::layout_lines_with_fonts,
    style_values::{number_style, resolve_margin_bottom, string_or_default},
};
use crate::style::{StyledNode, StyledNodeKind};

type ContinuousBlock = RuntimeBlock<LineBox>;
type ContinuousChild = RuntimeChild<LineBox>;

#[derive(Debug)]
pub(crate) struct ContinuousTableRowsLayout {
    pub(crate) blocks: Vec<ContinuousBlock>,
    pub(crate) height: f64,
}

#[derive(Debug)]
struct ContinuousTableCellResult {
    block: ContinuousBlock,
    vertical_align: String,
    content_height: f64,
}

struct ContinuousTableRowsContext<'a> {
    col_count: usize,
    col_widths: &'a [f64],
    occupied: &'a [Vec<bool>],
    content_height: f64,
    image_sizes: &'a ImageSizeIndex,
    text_layout: ContinuousTextLayout<'a>,
}

pub(crate) fn layout_continuous_table_rows<'a>(
    rows: &[StyledNode],
    col_count: usize,
    col_widths: &[f64],
    occupied: &[Vec<bool>],
    content_height: f64,
    image_sizes: &ImageSizeIndex,
    text_layout: ContinuousTextLayout<'a>,
) -> ContinuousTableRowsLayout {
    let ctx = ContinuousTableRowsContext {
        col_count,
        col_widths,
        occupied,
        content_height,
        image_sizes,
        text_layout,
    };
    let mut blocks = Vec::new();
    let mut current_y = 0.0;
    for (row_index, row) in rows.iter().enumerate() {
        let (block, height) = layout_continuous_table_row(
            row,
            current_y,
            ctx.occupied
                .get(row_index)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            &ctx,
        );
        blocks.push(block);
        current_y += height;
    }
    ContinuousTableRowsLayout {
        blocks,
        height: current_y,
    }
}

fn layout_continuous_table_row(
    row: &StyledNode,
    y: f64,
    row_occupied: &[bool],
    ctx: &ContinuousTableRowsContext<'_>,
) -> (ContinuousBlock, f64) {
    let (cell_blocks, max_cell_height) = layout_continuous_row_cells(row, row_occupied, ctx);
    let total_width = ctx.col_widths.iter().sum::<f64>();
    let children = cell_blocks
        .into_iter()
        .map(|result| {
            let dy = compute_continuous_cell_vertical_offset(
                &result.vertical_align,
                result.content_height,
                max_cell_height,
            );
            let mut cell = result.block;
            cell.height = max_cell_height;
            if dy > 0.0 {
                cell.children = offset_continuous_children(cell.children, 0.0, dy);
            }
            ContinuousChild::Block(Box::new(cell))
        })
        .collect();
    (
        ContinuousBlock {
            x: 0.0,
            y,
            width: total_width,
            height: max_cell_height,
            semantic_tag: None,
            anchor_id: None,
            paint: None,
            border_box: None,
            page_break_before: false,
            page_break_after: false,
            orphans: None,
            widows: None,
            children,
        },
        max_cell_height,
    )
}

fn layout_continuous_row_cells(
    row: &StyledNode,
    row_occupied: &[bool],
    ctx: &ContinuousTableRowsContext<'_>,
) -> (Vec<ContinuousTableCellResult>, f64) {
    let cells = row
        .children
        .iter()
        .filter(|child| child.node_type == StyledNodeKind::Block)
        .collect::<Vec<_>>();
    let mut cell_blocks = Vec::new();
    let mut max_cell_height = 0.0_f64;
    let mut col = 0usize;
    let mut cell_index = 0usize;

    while col < ctx.col_count {
        if row_occupied.get(col).copied().unwrap_or(false) {
            col += 1;
            continue;
        }
        let Some(cell) = cells.get(cell_index).copied() else {
            cell_blocks.push(ContinuousTableCellResult {
                block: empty_continuous_cell_block(ctx.col_widths, col),
                vertical_align: "baseline".to_owned(),
                content_height: 0.0,
            });
            col += 1;
            continue;
        };
        cell_index += 1;
        let result = layout_continuous_single_cell(cell, col, ctx);
        max_cell_height = max_cell_height.max(result.content_height);
        let col_span = cell.colspan.unwrap_or(1).max(1) as usize;
        cell_blocks.push(result);
        col += col_span;
    }

    (cell_blocks, max_cell_height)
}

fn layout_continuous_single_cell(
    cell: &StyledNode,
    col: usize,
    ctx: &ContinuousTableRowsContext<'_>,
) -> ContinuousTableCellResult {
    let col_span = cell.colspan.unwrap_or(1).max(1) as usize;
    let cell_width = span_continuous_width(ctx.col_widths, col, col_span);
    let padding_top = number_style(&cell.style, "paddingTop").unwrap_or(0.0);
    let padding_right = number_style(&cell.style, "paddingRight").unwrap_or(0.0);
    let padding_bottom = number_style(&cell.style, "paddingBottom").unwrap_or(0.0);
    let padding_left = number_style(&cell.style, "paddingLeft").unwrap_or(0.0);
    let inner_width = (cell_width - padding_left - padding_right).max(1.0);
    let children = layout_continuous_table_cell_content(
        cell,
        inner_width,
        ctx.content_height,
        ctx.image_sizes,
        ctx.text_layout,
    );
    let trailing = trailing_continuous_child_margin_bottom(cell, inner_width);
    let cell_height =
        compute_continuous_children_height(&children) + trailing + padding_top + padding_bottom;
    ContinuousTableCellResult {
        block: ContinuousBlock {
            x: column_continuous_x(ctx.col_widths, col),
            y: 0.0,
            width: cell_width,
            height: cell_height,
            semantic_tag: None,
            anchor_id: None,
            paint: None,
            border_box: None,
            page_break_before: false,
            page_break_after: false,
            orphans: None,
            widows: None,
            children: offset_continuous_children(children, padding_left, padding_top),
        },
        vertical_align: string_or_default(&cell.style, "verticalAlign", "baseline"),
        content_height: cell_height,
    }
}

fn layout_continuous_table_cell_content(
    cell: &StyledNode,
    width: f64,
    content_height: f64,
    image_sizes: &ImageSizeIndex,
    text_layout: ContinuousTextLayout<'_>,
) -> Vec<ContinuousChild> {
    let has_block_children = cell.children.iter().any(|child| {
        matches!(
            child.node_type,
            StyledNodeKind::Block | StyledNodeKind::Image
        )
    });
    if has_block_children {
        let mut list_ctx = None;
        return layout_continuous_nodes_at(
            &cell.children,
            width,
            content_height,
            0.0,
            image_sizes,
            text_layout,
            &mut list_ctx,
        )
        .into_iter()
        .map(|block| ContinuousChild::Block(Box::new(block)))
        .collect();
    }

    let segments = flatten_inline_content(&cell.children, SegmentContext::default());
    if segments.is_empty() {
        return Vec::new();
    }
    layout_lines_with_fonts(
        &segments,
        width,
        text_layout.line_breaking,
        text_layout.fonts,
    )
    .into_iter()
    .map(ContinuousChild::Line)
    .collect()
}

fn empty_continuous_cell_block(col_widths: &[f64], col: usize) -> ContinuousBlock {
    ContinuousBlock {
        x: column_continuous_x(col_widths, col),
        y: 0.0,
        width: col_widths.get(col).copied().unwrap_or(0.0),
        height: 0.0,
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

fn compute_continuous_cell_vertical_offset(
    vertical_align: &str,
    content_height: f64,
    row_height: f64,
) -> f64 {
    let gap = row_height - content_height;
    if gap <= 0.0 {
        return 0.0;
    }
    match vertical_align {
        "bottom" | "text-bottom" => gap,
        "middle" => gap / 2.0,
        _ => 0.0,
    }
}

pub(crate) fn offset_continuous_row_blocks(
    row_blocks: Vec<ContinuousBlock>,
    insets: &ContinuousTableInsets,
) -> Vec<ContinuousBlock> {
    let dx = insets.border_left + insets.padding_left;
    let dy = insets.border_top + insets.padding_top;
    if dx <= 0.0 && dy <= 0.0 {
        return row_blocks;
    }
    row_blocks
        .into_iter()
        .map(|mut block| {
            block.x += dx;
            block.y += dy;
            block
        })
        .collect()
}

fn offset_continuous_children(
    children: Vec<ContinuousChild>,
    dx: f64,
    dy: f64,
) -> Vec<ContinuousChild> {
    if dx == 0.0 && dy == 0.0 {
        return children;
    }
    children
        .into_iter()
        .map(|child| match child {
            ContinuousChild::Line(line) => ContinuousChild::Line(line.offset_with_runs(dx, dy)),
            ContinuousChild::Block(mut block) => {
                block.x += dx;
                block.y += dy;
                ContinuousChild::Block(block)
            }
            ContinuousChild::Image(mut image) => {
                image.x += dx;
                image.y += dy;
                ContinuousChild::Image(image)
            }
            ContinuousChild::Hr(mut hr) => {
                hr.x += dx;
                hr.y += dy;
                ContinuousChild::Hr(hr)
            }
        })
        .collect()
}

fn compute_continuous_children_height(children: &[ContinuousChild]) -> f64 {
    children
        .iter()
        .map(|child| match child {
            ContinuousChild::Line(line) => line.y + line.height,
            ContinuousChild::Block(block) => block.y + block.height,
            ContinuousChild::Image(image) => image.y + image.height,
            ContinuousChild::Hr(hr) => hr.y + hr.height,
        })
        .fold(0.0_f64, f64::max)
}

fn trailing_continuous_child_margin_bottom(cell: &StyledNode, content_width: f64) -> f64 {
    cell.children
        .iter()
        .rev()
        .find(|child| child.node_type == StyledNodeKind::Block)
        .map(|child| resolve_margin_bottom(&child.style, content_width).max(0.0))
        .unwrap_or(0.0)
}

fn column_continuous_x(col_widths: &[f64], col: usize) -> f64 {
    col_widths.iter().take(col).sum()
}

fn span_continuous_width(col_widths: &[f64], col: usize, span: usize) -> f64 {
    col_widths.iter().skip(col).take(span).sum()
}
