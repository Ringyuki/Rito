//! Tables. Builds the cell grid from the row and cell nodes, sizes the
//! columns once over the whole table from the cells' intrinsic widths,
//! and lays the rows out either whole or one fragmentainer at a time,
//! breaking between rows and inside a tall cell.

use crate::*;

impl TableGridLayout {
    /// A cell's border-box width across its column span.
    fn cell_width(&self, cell: &TableGridCell) -> f64 {
        self.offsets[cell.column + cell.span] - self.offsets[cell.column] - self.spacing_x
    }
}

fn empty_table_fragment(table: FormattingNodeId) -> BoxFragment {
    BoxFragment {
        source: table,
        rect: FragmentRect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        },
        children: Vec::new(),
    }
}

impl<I: FormattingContext> BlockFormattingContext<I> {
    /// Lays a table out whole: CSS automatic column sizing over the
    /// cells' intrinsic widths (a spanning cell spreads its demand evenly),
    /// shrink-to-fit table width, each row as tall as its tallest cell.
    pub(crate) fn layout_table(
        &self,
        tree: &FormattingTree,
        table: FormattingNodeId,
        available_width: f64,
        fill_available: bool,
        cancel: &CancelFlag,
    ) -> Result<BoxFragment, LayoutError> {
        let Some(grid) = self.table_grid(tree, table, available_width, fill_available)? else {
            return Ok(empty_table_fragment(table));
        };
        let mut rows = Vec::with_capacity(grid.rows.len());
        let mut y = grid.spacing_y;
        for row_index in 0..grid.rows.len() {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            let mut row = self.layout_table_row(tree, &grid, row_index, cancel)?;
            let row_height = row.rect.height;
            row.rect.y = y;
            rows.push(Fragment::Box(row));
            y += row_height + grid.spacing_y;
        }
        Ok(BoxFragment {
            source: table,
            rect: FragmentRect {
                x: 0.0,
                y: 0.0,
                width: grid.table_width,
                height: y,
            },
            children: rows,
        })
    }

    /// Lays a table into the current fragmentainer the way a browser
    /// fragments one: rows fill the remaining space; a single-cell row
    /// that straddles the edge breaks INSIDE the cell, whose content
    /// fragments like any block container (a page-tall wrapper table's
    /// TOC splits between its paragraphs, measured on Blink); a
    /// multi-cell row breaks between rows, since parallel cell
    /// resumption is not modelled. Column sizing stays global over the
    /// whole table — fragmentation never re-sizes columns.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn layout_table_in_fragmentainer(
        &self,
        tree: &FormattingTree,
        table: FormattingNodeId,
        available_width: f64,
        fill_available: bool,
        budget: f64,
        fragmentainer_size: Option<f64>,
        token: Option<&BreakToken>,
        page_is_empty: bool,
        cancel: &CancelFlag,
    ) -> Result<TableFragmentainerPlacement, LayoutError> {
        let Some(grid) = self.table_grid(tree, table, available_width, fill_available)? else {
            return Ok(TableFragmentainerPlacement::Placed {
                fragment: empty_table_fragment(table),
                continuation: None,
            });
        };
        // Decode the resume point: the token names the interrupted row,
        // then the interrupted cell with its own inner path. Two levels
        // strip off; split floats ride down rebased the same two levels.
        let mut start_row = 0usize;
        let mut cell_token: Option<BreakToken> = None;
        if let Some(token) = token {
            let Some(row_id) = token.resume_path.first() else {
                return Err(LayoutError::Invalid(
                    "a table break token must name the interrupted row".to_owned(),
                ));
            };
            start_row = grid
                .row_ids
                .iter()
                .position(|id| id == row_id)
                .ok_or_else(|| {
                    LayoutError::Invalid("table break token names a foreign row".to_owned())
                })?;
            if token.resume_path.len() >= 2 {
                if grid.rows[start_row].len() != 1 {
                    return Err(LayoutError::Invalid(
                        "a table break token resumes inside a cell only in a single-cell row"
                            .to_owned(),
                    ));
                }
                cell_token = Some(BreakToken {
                    resume_path: token.resume_path[2..].to_vec(),
                    stage: token.stage,
                    pending_floats: token
                        .pending_floats
                        .iter()
                        .filter(|entry| entry.depth >= 2)
                        .map(|entry| FloatBreak {
                            child: entry.child,
                            token: entry.token.clone(),
                            depth: entry.depth - 2,
                        })
                        .collect(),
                });
            }
        }
        let mut y = if token.is_some() { 0.0 } else { grid.spacing_y };
        let mut rows_out: Vec<Fragment> = Vec::new();
        let mut continuation: Option<BreakToken> = None;
        for row_index in start_row..grid.rows.len() {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            let row_id = grid.row_ids[row_index];
            let row = &grid.rows[row_index];
            let resuming_cell = row_index == start_row && cell_token.is_some();
            if !resuming_cell {
                let mut row_fragment = self.layout_table_row(tree, &grid, row_index, cancel)?;
                let row_height = row_fragment.rect.height;
                if y + row_height <= budget {
                    row_fragment.rect.y = y;
                    rows_out.push(Fragment::Box(row_fragment));
                    y += row_height + grid.spacing_y;
                    continue;
                }
                if row.len() != 1 {
                    if rows_out.is_empty() && !page_is_empty {
                        return Ok(TableFragmentainerPlacement::BreakBefore);
                    }
                    if rows_out.is_empty() {
                        // A multi-cell row taller than an empty page
                        // places whole so pagination always progresses.
                        row_fragment.rect.y = y;
                        rows_out.push(Fragment::Box(row_fragment));
                        y += row_height + grid.spacing_y;
                        continue;
                    }
                    continuation = Some(BreakToken {
                        resume_path: vec![row_id],
                        stage: BreakTokenStage::Before,
                        pending_floats: Vec::new(),
                    });
                    break;
                }
            }
            // A single-cell row at the fragmentainer edge, or resuming
            // across one: the cell's content fragments in place.
            let cell = &row[0];
            let cell_width = grid.cell_width(cell);
            let cell_budget = (budget - y).max(0.0);
            let inner_token = if resuming_cell {
                cell_token.take()
            } else {
                None
            };
            // A cell opening a fresh page owns it outright — its interior
            // sees a fresh fragmentainer, so the force-placement that
            // guarantees pagination progress applies inside it too.
            let cell_fragmentainer_size = if resuming_cell || (page_is_empty && rows_out.is_empty())
            {
                Some(cell_budget)
            } else {
                fragmentainer_size
            };
            let outcome = self.layout_container(
                tree,
                cell.node,
                &ConstraintSpace {
                    inline_size: cell_width,
                    fragmentainer_remaining: Some(cell_budget),
                    fragmentainer_size: cell_fragmentainer_size,
                    float_band: None,
                    containing_block_size: None,
                },
                inner_token.as_ref(),
                cancel,
                false,
                false,
            )?;
            let Fragment::Box(mut cell_root) = outcome.fragments.root else {
                return Err(LayoutError::Invalid(
                    "cell layout must produce a box fragment".to_owned(),
                ));
            };
            let nothing_fit = !resuming_cell
                && cell_root.children.is_empty()
                && cell_root.rect.height <= 0.0
                && outcome.continuation.is_some();
            if nothing_fit {
                if rows_out.is_empty() {
                    return Ok(TableFragmentainerPlacement::BreakBefore);
                }
                continuation = Some(BreakToken {
                    resume_path: vec![row_id],
                    stage: BreakTokenStage::Before,
                    pending_floats: Vec::new(),
                });
                break;
            }
            cell_root.source = cell.node;
            cell_root.rect.x = grid.offsets[cell.column] - grid.spacing_x;
            cell_root.rect.width = cell_width;
            cell_root.rect.y = 0.0;
            let fragment_height = cell_root.rect.height;
            rows_out.push(Fragment::Box(BoxFragment {
                source: row_id,
                rect: FragmentRect {
                    x: grid.spacing_x,
                    y,
                    width: (grid.table_width - 2.0 * grid.spacing_x).max(0.0),
                    height: fragment_height,
                },
                children: vec![Fragment::Box(cell_root)],
            }));
            y += fragment_height;
            match outcome.continuation {
                Some(inner) => {
                    let mut resume_path = Vec::with_capacity(inner.resume_path.len() + 2);
                    resume_path.push(row_id);
                    resume_path.push(cell.node);
                    resume_path.extend(inner.resume_path);
                    continuation = Some(BreakToken {
                        resume_path,
                        stage: inner.stage,
                        pending_floats: inner
                            .pending_floats
                            .into_iter()
                            .map(|entry| FloatBreak {
                                depth: entry.depth + 2,
                                ..entry
                            })
                            .collect(),
                    });
                    break;
                }
                None => {
                    y += grid.spacing_y;
                }
            }
        }
        Ok(TableFragmentainerPlacement::Placed {
            fragment: BoxFragment {
                source: table,
                rect: FragmentRect {
                    x: 0.0,
                    y: 0.0,
                    width: grid.table_width,
                    height: y,
                },
                children: rows_out,
            },
            continuation,
        })
    }

    /// Builds the table's grid and sizes its columns: CSS automatic
    /// column sizing over the cells' intrinsic widths (a spanning cell
    /// spreads its demand evenly), shrink-to-fit table width. `None`
    /// when the table has no columns at all.
    fn table_grid(
        &self,
        tree: &FormattingTree,
        table: FormattingNodeId,
        available_width: f64,
        fill_available: bool,
    ) -> Result<Option<TableGridLayout>, LayoutError> {
        let mut rows: Vec<Vec<TableGridCell>> = Vec::new();
        let mut row_ids: Vec<FormattingNodeId> = Vec::new();
        let mut column_count = 0usize;
        for row_id in &tree.node(table).children {
            let FormattingNodeContent::TableRow = tree.node(*row_id).content else {
                return Err(LayoutError::Invalid(
                    "table children must be rows".to_owned(),
                ));
            };
            let mut cells = Vec::new();
            let mut column = 0usize;
            for cell_id in &tree.node(*row_id).children {
                let FormattingNodeContent::TableCell { col_span } = tree.node(*cell_id).content
                else {
                    return Err(LayoutError::Invalid(
                        "table-row children must be cells".to_owned(),
                    ));
                };
                let span = (col_span as usize).max(1);
                cells.push(TableGridCell {
                    node: *cell_id,
                    column,
                    span,
                });
                column += span;
            }
            column_count = column_count.max(column);
            rows.push(cells);
            row_ids.push(*row_id);
        }
        if column_count == 0 {
            return Ok(None);
        }
        let mut min_widths = vec![0.0_f64; column_count];
        let mut max_widths = vec![0.0_f64; column_count];
        // A column whose cells specify a width takes that width as its
        // preferred size; the other cells in the column wrap to it rather
        // than widening the column with their own content maximum.
        let mut specified_widths = vec![None::<f64>; column_count];
        let mut column_percentages = vec![None::<f64>; column_count];
        for row in &rows {
            for cell in row {
                let sizes = self.cell_intrinsic_sizes(tree, cell.node)?;
                let share = cell.span as f64;
                for offset in 0..cell.span {
                    let column = cell.column + offset;
                    min_widths[column] = min_widths[column].max(sizes.min_content / share);
                    max_widths[column] = max_widths[column].max(sizes.max_content / share);
                    if let Some(specified) = sizes.specified {
                        let share = specified / share;
                        specified_widths[column] = Some(
                            specified_widths[column].map_or(share, |best: f64| best.max(share)),
                        );
                    }
                    if let Some(percentage) = sizes.percentage {
                        column_percentages[column] = Some(
                            column_percentages[column]
                                .map_or(percentage, |best: f64| best.max(percentage)),
                        );
                    }
                }
            }
        }
        for column in 0..column_count {
            if let Some(specified) = specified_widths[column] {
                max_widths[column] = specified.max(min_widths[column]);
            }
        }
        let table_style = container_layout_style(tree, table)?;
        let (spacing_x, spacing_y) = (
            f64::from(table_style.border_spacing.0.get()),
            f64::from(table_style.border_spacing.1.get()),
        );
        let spacing_total = spacing_x * (column_count as f64 + 1.0);
        let content_available = (available_width - spacing_total).max(0.0);
        // Column sizing follows the CSS tables algorithm: an assignable
        // width from the grid's constraints, then distribution through
        // the four guesses.
        let constraints: Vec<ColumnConstraint> = (0..column_count)
            .map(|column| ColumnConstraint {
                min: min_widths[column],
                max: max_widths[column].max(min_widths[column]),
                specified: specified_widths[column],
                percentage: column_percentages[column],
            })
            .collect();
        // A table with an AUTHORED width fills it: the surplus beyond the
        // columns' own demands distributes over the columns (measured:
        // Blink widens every 8em cell of a width:25.5em table; the
        // shrink-to-fit cap left the grid at the specified column sum and
        // every later column sat left of the browser's).
        let assignable = if fill_available {
            let grid_min: f64 = constraints.iter().map(|column| column.min).sum();
            grid_min.max(content_available)
        } else {
            assignable_table_width(&constraints, content_available)
        };
        let mut columns = distribute_columns(&constraints, assignable);
        // The used column widths live on the LayoutUnit grid: every
        // column truncates to 1/64 and the accumulated remainder lands
        // in the LAST column (measured on an over-constrained 7-column
        // 229.5px table: 45.734375 / 13.6875 / ... / 51.1875 repeat to
        // the 1/64, and the last column takes 229.5 - Σ = 45.78125 —
        // the float distribution leaked dust into every gap column and
        // a non-square portrait in the last column scaled 3/64 short,
        // shifting every later block on the page across a device row).
        if let Some((last, head)) = columns.split_last_mut() {
            let mut spent = 0.0_f64;
            for width in head.iter_mut() {
                *width = (*width * 64.0).floor() / 64.0;
                spent += *width;
            }
            *last = (((assignable - spent) * 64.0).floor() / 64.0).max(0.0);
        }
        // Separate-borders spacing sits between every pair of cells and
        // around the grid, so a column's offset carries one gap per
        // preceding column plus the leading edge.
        let mut offsets = vec![0.0_f64; column_count + 1];
        offsets[0] = spacing_x;
        for index in 0..column_count {
            offsets[index + 1] = offsets[index] + columns[index] + spacing_x;
        }
        let table_width = offsets[column_count];
        Ok(Some(TableGridLayout {
            rows,
            row_ids,
            offsets,
            table_width,
            spacing_x,
            spacing_y,
        }))
    }

    /// Lays one row out whole in continuous flow: each cell a block
    /// container at its column width, the row as tall as its tallest
    /// cell. The fragment sits at the row's x offset with y left at
    /// zero for the caller to place.
    fn layout_table_row(
        &self,
        tree: &FormattingTree,
        grid: &TableGridLayout,
        row_index: usize,
        cancel: &CancelFlag,
    ) -> Result<BoxFragment, LayoutError> {
        let row_id = grid.row_ids[row_index];
        let row = &grid.rows[row_index];
        let mut cell_fragments = Vec::with_capacity(row.len());
        let mut cell_heights = Vec::with_capacity(row.len());
        let mut row_height = 0.0_f64;
        for cell in row {
            let cell_width = grid.cell_width(cell);
            let outcome = self.layout_container(
                tree,
                cell.node,
                &ConstraintSpace::continuous(cell_width),
                None,
                cancel,
                false,
                false,
            )?;
            let Fragment::Box(mut cell_root) = outcome.fragments.root else {
                return Err(LayoutError::Invalid(
                    "cell layout must produce a box fragment".to_owned(),
                ));
            };
            cell_root.source = cell.node;
            cell_root.rect.x = grid.offsets[cell.column] - grid.spacing_x;
            cell_root.rect.width = cell_width;
            row_height = row_height.max(cell_root.rect.height);
            cell_heights.push(cell_root.rect.height);
            cell_fragments.push(cell_root);
        }
        // Cells stretch to the row height, matching the separate-border
        // table model's uniform row boxes, and align their content
        // inside that box per `vertical-align`. Baseline alignment
        // falls back to the top edge until cell baselines are tracked.
        for (cell_root, content_height) in cell_fragments.iter_mut().zip(&cell_heights) {
            let free = (row_height - content_height).max(0.0);
            let shift = match container_layout_style(tree, cell_root.source)?.vertical_align {
                rito_style_contract::CellVerticalAlign::Middle => free / 2.0,
                rito_style_contract::CellVerticalAlign::Bottom => free,
                rito_style_contract::CellVerticalAlign::Top
                | rito_style_contract::CellVerticalAlign::Baseline => 0.0,
            };
            if shift > 0.0 {
                for child in &mut cell_root.children {
                    translate_fragment(child, 0.0, shift);
                }
            }
            cell_root.rect.height = row_height;
            cell_root.rect.y = 0.0;
        }
        Ok(BoxFragment {
            source: row_id,
            rect: FragmentRect {
                x: grid.spacing_x,
                y: 0.0,
                width: (grid.table_width - 2.0 * grid.spacing_x).max(0.0),
                height: row_height,
            },
            children: cell_fragments.into_iter().map(Fragment::Box).collect(),
        })
    }

    /// A cell's intrinsic inline bounds including its own horizontal
    /// padding (borders are absorbed as padding upstream).
    ///
    /// A cell with a definite `width` contributes that width rather than
    /// its content's maximum: CSS's automatic table layout treats a
    /// specified cell width as the column's preferred width, floored by
    /// the content minimum.
    fn cell_intrinsic_sizes(
        &self,
        tree: &FormattingTree,
        cell: FormattingNodeId,
    ) -> Result<CellIntrinsicSizes, LayoutError> {
        let mut sizes = self.intrinsic_inline_sizes(tree, cell)?;
        let style = container_layout_style(tree, cell)?;
        let pad = |side: rito_style_contract::NonNegativeLengthPercentage| match side.value() {
            // Used paddings sit on the LayoutUnit grid (truncation).
            LengthPercentage::Length(px) => (f64::from(px.get()) * 64.0).trunc() / 64.0,
            _ => 0.0,
        };
        let padding = pad(style.padding.left) + pad(style.padding.right);
        // Percentages resolve against the table width, which the column
        // algorithm has not established yet; only definite lengths take
        // part here, and content sizing covers the rest.
        let mut specified = None;
        let mut percentage = None;
        if let rito_style_contract::PreferredSize::Value(width) = style.width {
            match width.value() {
                LengthPercentage::Length(px) => specified = Some(f64::from(px.get()) + padding),
                LengthPercentage::Percentage(ratio) => {
                    let ratio = f64::from(ratio.ratio());
                    if ratio > 0.0 {
                        percentage = Some(ratio);
                    }
                }
                LengthPercentage::Linear { .. } => {}
            }
        }
        sizes.min_content += padding;
        sizes.max_content += padding;
        Ok(CellIntrinsicSizes {
            min_content: sizes.min_content,
            max_content: sizes.max_content,
            specified,
            percentage,
        })
    }
}

/// The width a table's columns divide between them. Beyond fitting its
/// own content, a percentage column constrains the table twice: its own
/// content must fit inside its share, and everything else must fit in
/// what the shares leave. Whichever demand is largest wins, bounded by
/// the space available — CSS sizes an `auto` table to fit, not to fill.
fn assignable_table_width(constraints: &[ColumnConstraint], available: f64) -> f64 {
    let grid_min: f64 = constraints.iter().map(|column| column.min).sum();
    let grid_max: f64 = constraints.iter().map(|column| column.max).sum();
    let percentage_sum: f64 = constraints
        .iter()
        .filter_map(|column| column.percentage)
        .sum::<f64>()
        .min(1.0);
    let mut demand = grid_max;
    for column in constraints {
        if let Some(share) = column.percentage {
            if share > 0.0 {
                demand = demand.max(column.max / share);
            }
        }
    }
    if percentage_sum > 0.0 && percentage_sum < 1.0 {
        let plain_max: f64 = constraints
            .iter()
            .filter(|column| column.percentage.is_none())
            .map(|column| column.max)
            .sum();
        demand = demand.max(plain_max / (1.0 - percentage_sum));
    }
    grid_min.max(demand.min(available))
}

/// Distributes the assignable width over the columns through the four
/// guesses of the CSS tables algorithm — every column at its minimum,
/// then percentage columns at their share, then authored widths, then
/// content maxima — settling between the two guesses that bracket the
/// assignable width, and spreading anything beyond the last guess.
fn distribute_columns(constraints: &[ColumnConstraint], assignable: f64) -> Vec<f64> {
    let count = constraints.len();
    let minimum: Vec<f64> = constraints.iter().map(|column| column.min).collect();
    let percentage: Vec<f64> = constraints
        .iter()
        .map(|column| match column.percentage {
            Some(share) => (share * assignable).max(column.min),
            None => column.min,
        })
        .collect();
    let specified: Vec<f64> = constraints
        .iter()
        .enumerate()
        .map(
            |(index, column)| match (column.percentage, column.specified) {
                (Some(_), _) => percentage[index],
                (None, Some(width)) => width.max(column.min),
                (None, None) => column.min,
            },
        )
        .collect();
    let maximum: Vec<f64> = constraints
        .iter()
        .enumerate()
        .map(
            |(index, column)| match (column.percentage, column.specified) {
                (Some(_), _) => percentage[index].max(column.max),
                (None, Some(_)) => specified[index].max(column.max),
                (None, None) => column.max,
            },
        )
        .collect();

    let total = |guess: &[f64]| guess.iter().sum::<f64>();
    for (lower, upper) in [
        (&minimum, &percentage),
        (&percentage, &specified),
        (&specified, &maximum),
    ] {
        let lower_total = total(lower);
        let upper_total = total(upper);
        if assignable <= lower_total {
            return lower.clone();
        }
        if assignable <= upper_total {
            let span = upper_total - lower_total;
            if span <= f64::EPSILON {
                return upper.clone();
            }
            let ratio = (assignable - lower_total) / span;
            return (0..count)
                .map(|index| lower[index] + (upper[index] - lower[index]) * ratio)
                .collect();
        }
    }

    // Beyond every guess: the surplus goes to the columns sized by their
    // content, then to authored widths, then to percentage columns.
    let mut widths = maximum;
    let surplus = assignable - total(&widths);
    if surplus <= 0.0 {
        return widths;
    }
    let pick = |filter: &dyn Fn(&ColumnConstraint) -> bool| -> Vec<usize> {
        (0..count)
            .filter(|index| filter(&constraints[*index]))
            .collect()
    };
    let auto = pick(&|column| column.percentage.is_none() && column.specified.is_none());
    let fixed = pick(&|column| column.percentage.is_none() && column.specified.is_some());
    let shares: Vec<(usize, f64)> = if !auto.is_empty() {
        auto.iter()
            .map(|index| (*index, constraints[*index].max.max(1.0)))
            .collect()
    } else if !fixed.is_empty() {
        fixed
            .iter()
            .map(|index| (*index, widths[*index].max(1.0)))
            .collect()
    } else {
        (0..count)
            .map(|index| {
                (
                    index,
                    constraints[index]
                        .percentage
                        .unwrap_or(0.0)
                        .max(f64::EPSILON),
                )
            })
            .collect()
    };
    let share_total: f64 = shares.iter().map(|(_, share)| share).sum();
    if share_total > 0.0 {
        for (index, share) in shares {
            widths[index] += surplus * (share / share_total);
        }
    }
    widths
}
