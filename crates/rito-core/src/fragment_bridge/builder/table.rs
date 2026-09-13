//! `TreeBuilder`'s table pass. A `display: table` element becomes the block
//! engine's table grid: row groups flatten, rows collect cells, a cell's
//! content builds like a block container, `colspan` spans grid columns, and
//! table and cell borders are absorbed as padding with their paint recorded
//! (a collapsed table marks its horizontal edges for per-cell segmentation).

use rito_fragment::{FormattingNode, FormattingNodeContent, FormattingNodeId};
use rito_style_contract::{LayoutDisplayInside, LayoutStyleId};

use super::element_source_index;
use crate::epub::EpubResult;
use crate::fragment_bridge::{NodePaint, TreeBuilder};
use crate::xhtml::{DocumentNode, ElementNode};

impl TreeBuilder<'_> {
    /// Builds a `display: table` element into the table grid the block
    /// engine lays out: row groups flatten, rows collect cells, a cell's
    /// content builds like a block container, and `colspan` spans grid
    /// columns. Structure the CSS table model would wrap in anonymous
    /// boxes degrades to plain rows/cells with a note.
    pub(super) fn build_table(
        &mut self,
        element: &ElementNode,
        source_index: usize,
        style: LayoutStyleId,
    ) -> EpubResult<Option<FormattingNodeId>> {
        let tag = element.tag.clone();
        let collapsed = self
            .layout
            .style(style)
            .map(|resolved| resolved.border_collapse)
            .unwrap_or(false);
        let plan = self.block_box_paint_plan(source_index, &tag)?;
        let (style, decoration) = match plan {
            Some((paint, widths)) if widths.iter().any(|width| *width > 0.0) => (
                self.style_with_border_padding(style, widths, &tag)?,
                Some(paint),
            ),
            Some((paint, _)) => (style, Some(paint)),
            None => (style, None),
        };
        let mut rows = Vec::new();
        self.collect_table_rows(&element.children, &mut rows)?;
        let row_ids = rows
            .into_iter()
            .map(|row| self.build_table_row(row))
            .collect::<EpubResult<Vec<_>>>()?;
        let id = self.push_node(
            FormattingNode {
                style,
                content: FormattingNodeContent::Table,
                children: row_ids,
            },
            Some(source_index),
        );
        if let Some(anchor) = element
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.id.clone())
        {
            self.node_anchors.insert(id.0, anchor);
        }
        self.node_tags.insert(id.0, tag);
        if let Some(mut paint) = decoration {
            if let NodePaint::Box {
                segment_horizontal_edges,
                ..
            } = &mut paint
            {
                *segment_horizontal_edges = collapsed;
            }
            self.node_paints.insert(id.0, paint);
        }
        Ok(Some(id))
    }

    /// Flattens row groups and collects row elements in document order.
    fn collect_table_rows<'n>(
        &mut self,
        children: &'n [DocumentNode],
        rows: &mut Vec<&'n ElementNode>,
    ) -> EpubResult<()> {
        for child in children {
            let DocumentNode::Block(inner) = child else {
                continue;
            };
            let inner_index = element_source_index(inner)?;
            if self.is_display_none(inner_index, &inner.tag) {
                continue;
            }
            let inside = {
                let style_id = self.layout_style_id(inner_index, &inner.tag);
                self.layout
                    .style(style_id)
                    .map(|resolved| resolved.display.inside)
                    .unwrap_or(LayoutDisplayInside::Flow)
            };
            match inside {
                LayoutDisplayInside::TableRow => rows.push(inner),
                LayoutDisplayInside::TableRowGroup
                | LayoutDisplayInside::TableHeaderGroup
                | LayoutDisplayInside::TableFooterGroup => {
                    self.collect_table_rows(&inner.children, rows)?;
                }
                LayoutDisplayInside::TableColumn | LayoutDisplayInside::TableColumnGroup => {}
                _ => {
                    self.degrade(format!(
                        "<{}> inside a table is not a row; skipped",
                        inner.tag
                    ));
                }
            }
        }
        Ok(())
    }

    fn build_table_row(&mut self, row: &ElementNode) -> EpubResult<FormattingNodeId> {
        let source_index = element_source_index(row)?;
        let style = self.layout_style_id(source_index, &row.tag);
        let mut cells = Vec::new();
        for child in &row.children {
            let DocumentNode::Block(cell) = child else {
                continue;
            };
            let cell_index = element_source_index(cell)?;
            if self.is_display_none(cell_index, &cell.tag) {
                continue;
            }
            let cell_style = self.layout_style_id(cell_index, &cell.tag);
            let cell_tag = cell.tag.clone();
            let plan = self.block_box_paint_plan(cell_index, &cell_tag)?;
            let (cell_style, decoration) = match plan {
                Some((paint, widths)) if widths.iter().any(|width| *width > 0.0) => (
                    self.style_with_border_padding(cell_style, widths, &cell_tag)?,
                    Some(paint),
                ),
                Some((paint, _)) => (cell_style, Some(paint)),
                None => (cell_style, None),
            };
            let col_span = cell
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.colspan)
                .unwrap_or(1)
                .max(1);
            if cell
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.rowspan)
                .is_some_and(|span| span > 1)
            {
                self.degrade("table rowspan laid out as a single row".to_owned());
            }
            let inline_style = self.inline_style_id(cell_index, &cell.tag);
            let children = self.build_children(&cell.children, inline_style)?;
            let id = self.push_node(
                FormattingNode {
                    style: cell_style,
                    content: FormattingNodeContent::TableCell { col_span },
                    children,
                },
                Some(cell_index),
            );
            self.node_tags.insert(id.0, cell_tag);
            if let Some(anchor) = cell
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.id.clone())
            {
                self.node_anchors.insert(id.0, anchor);
            }
            if let Some(paint) = decoration {
                self.node_paints.insert(id.0, paint);
            }
            cells.push(id);
        }
        let row_id = self.push_node(
            FormattingNode {
                style,
                content: FormattingNodeContent::TableRow,
                children: cells,
            },
            Some(source_index),
        );
        self.node_tags.insert(row_id.0, row.tag.clone());
        if let Some(anchor) = row
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.id.clone())
        {
            self.node_anchors.insert(row_id.0, anchor);
        }
        Ok(row_id)
    }
}
