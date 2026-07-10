use super::{
    content::{RuntimeBlock, RuntimeChild},
    continuous_layout::ContinuousTextLayout,
    continuous_table_model::{
        build_continuous_table_model, compute_continuous_column_widths, has_explicit_width,
        resolve_continuous_table_insets,
    },
    continuous_table_rows::{layout_continuous_table_rows, offset_continuous_row_blocks},
    image_size::ImageSizeIndex,
    line::LineBox,
};
use crate::style::StyledNode;

type ContinuousBlock = RuntimeBlock<LineBox>;
type ContinuousChild = RuntimeChild<LineBox>;

pub(crate) fn layout_continuous_table(
    node: &StyledNode,
    content_width: f64,
    content_height: f64,
    y: f64,
    image_sizes: &ImageSizeIndex,
    text_layout: ContinuousTextLayout<'_>,
) -> ContinuousBlock {
    let Some(model) = build_continuous_table_model(node) else {
        return empty_continuous_table_block(content_width, y);
    };
    let insets = resolve_continuous_table_insets(node, content_width);
    let has_explicit_width = has_explicit_width(&node.style);
    let col_widths = compute_continuous_column_widths(
        &model.rows,
        model.col_count,
        if insets.inner_width > 0.0 {
            insets.inner_width
        } else {
            content_width
        },
        &model.occupied,
        has_explicit_width,
        text_layout.line_breaking,
        text_layout.fonts,
    );
    let rows = layout_continuous_table_rows(
        &model.rows,
        model.col_count,
        &col_widths,
        &model.occupied,
        content_height,
        image_sizes,
        text_layout,
    );
    let row_blocks = offset_continuous_row_blocks(rows.blocks, &insets);
    let col_total = col_widths.iter().sum::<f64>();
    let total_width = col_total
        + insets.padding_left
        + insets.padding_right
        + insets.border_left
        + insets.border_right;
    let total_height = rows.height
        + insets.padding_top
        + insets.padding_bottom
        + insets.border_top
        + insets.border_bottom;

    ContinuousBlock {
        x: 0.0,
        y,
        width: total_width,
        height: total_height,
        semantic_tag: None,
        anchor_id: None,
        paint: None,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: row_blocks
            .into_iter()
            .map(|block| ContinuousChild::Block(Box::new(block)))
            .collect(),
    }
}

fn empty_continuous_table_block(content_width: f64, y: f64) -> ContinuousBlock {
    ContinuousBlock {
        x: 0.0,
        y,
        width: content_width,
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
