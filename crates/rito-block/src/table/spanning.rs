//! Fragment a spanning grid while retaining independent cell line breaks.
//! Pure continuation data records inserted pagination gaps; resuming never
//! needs a shared in-memory layout or a common line boundary across columns.
use super::*;
use rito_fragment::{SpanningTableContinuation, TableCellInsertion};

const EPSILON: f64 = 1e-7;

impl<I: FormattingContext> BlockFormattingContext<I> {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn layout_spanning_table_in_fragmentainer(
        &self,
        tree: &FormattingTree,
        table: FormattingNodeId,
        grid: &TableGridLayout,
        budget: f64,
        fragmentainer_size: Option<f64>,
        token: Option<&BreakToken>,
        page_is_empty: bool,
        cancel: &CancelFlag,
    ) -> Result<TableFragmentainerPlacement, LayoutError> {
        let invalid = || LayoutError::Invalid("invalid spanning-table continuation".to_owned());
        let SpanningRows {
            mut rows,
            mut content_heights,
        } = self.layout_spanning_rows(tree, grid, cancel)?;
        let base_heights: Vec<_> = rows.iter().map(|row| row.rect.height).collect();
        let (start, mut state) = match token {
            None => (
                0.0,
                SpanningTableContinuation {
                    table,
                    row_growth: vec![0.0; rows.len()],
                    insertions: Vec::new(),
                },
            ),
            Some(token) if token.resume_path.is_empty() && token.pending_floats.is_empty() => {
                match token.stage {
                    BreakTokenStage::Inside {
                        consumed_block_size,
                    } if consumed_block_size.is_finite() && consumed_block_size > 0.0 => (
                        consumed_block_size,
                        token.spanning_table.clone().ok_or_else(invalid)?,
                    ),
                    BreakTokenStage::Before if token.spanning_table.is_none() => (
                        0.0,
                        SpanningTableContinuation {
                            table,
                            row_growth: vec![0.0; rows.len()],
                            insertions: Vec::new(),
                        },
                    ),
                    _ => return Err(invalid()),
                }
            }
            _ => return Err(invalid()),
        };
        if state.table != table
            || state.row_growth.len() != rows.len()
            || state.row_growth.iter().any(|v| !v.is_finite() || *v < 0.0)
        {
            return Err(invalid());
        }
        let mut cell_positions = std::collections::BTreeMap::new();
        for (row, cells) in grid.rows.iter().enumerate() {
            for (index, cell) in cells.iter().enumerate() {
                cell_positions.insert(cell.node.0, (row, index));
            }
        }
        for entry in &state.insertions {
            if !entry.at.is_finite() || entry.at < 0.0 || !entry.gap.is_finite() || entry.gap <= 0.0
            {
                return Err(invalid());
            }
            let &(row, index) = cell_positions.get(&entry.cell.0).ok_or_else(invalid)?;
            let Fragment::Box(cell) = &mut rows[row].children[index] else {
                return Err(invalid());
            };
            for child in &mut cell.children {
                insert_gap(child, 0.0, entry.at, entry.gap);
            }
            content_heights[row][index] += entry.gap;
        }
        let (offsets, mut height) =
            position_rows(&mut rows, grid, &base_heights, &state.row_growth);
        if !height.is_finite() || start >= height || !budget.is_finite() || budget < 0.0 {
            return Err(invalid());
        }
        let mut cut = (start + budget).min(height);
        let full_page = fragmentainer_size.unwrap_or(budget).max(budget);
        // A short connected header group moves intact when a fresh page
        // can hold it. Only oversized groups need independent cell breaks.
        let mut first = 0;
        while first < rows.len() {
            let end = grid.group_end(first);
            let top = offsets[first];
            let bottom = offsets[end] - grid.spacing_y;
            if top + EPSILON < cut
                && cut + EPSILON < bottom
                && top + EPSILON >= start
                && bottom - top <= full_page + EPSILON
            {
                if top > start + EPSILON {
                    cut = top;
                } else if !page_is_empty && start == 0.0 {
                    return Ok(TableFragmentainerPlacement::BreakBefore);
                }
                break;
            }
            first = end;
        }
        if cut + EPSILON < height {
            if let Some(edge) = offsets
                .iter()
                .rev()
                .copied()
                .find(|edge| *edge > start + EPSILON && *edge <= cut + EPSILON)
            {
                cut = edge;
            }
        }
        if cut <= start + EPSILON {
            if !page_is_empty {
                if let Some(token) = token {
                    return Ok(TableFragmentainerPlacement::Placed {
                        fragment: empty_table_fragment(table),
                        continuation: Some(token.clone()),
                    });
                }
                return Ok(TableFragmentainerPlacement::BreakBefore);
            }
            return Err(LayoutError::Invalid(
                "a spanning table has no room in the fragmentainer".to_owned(),
            ));
        }
        // Move a cut-crossing line and the rest of that cell to the next
        // page independently. Grow only the span's final row: already
        // emitted rows and text must never move retroactively.
        for (row_index, row) in rows.iter_mut().enumerate() {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            for (index, child) in row.children.iter_mut().enumerate() {
                let Fragment::Box(cell) = child else {
                    return Err(invalid());
                };
                let top = row.rect.y + cell.rect.y;
                let mut bands = Vec::new();
                for child in &cell.children {
                    atomic_bands(child, top, &mut bands);
                }
                if bands
                    .iter()
                    .any(|&(a, b)| a + EPSILON < start && start + EPSILON < b)
                {
                    return Err(invalid());
                }
                let crossing = bands
                    .iter()
                    .filter(|&&(a, b)| a + EPSILON < cut && cut + EPSILON < b);
                let mut at: Option<f64> = None;
                for &(a, b) in crossing {
                    if b - a > full_page + EPSILON {
                        return Err(LayoutError::Invalid("a spanning table contains an indivisible line or image taller than a fragmentainer".to_owned()));
                    }
                    at = Some(at.map_or(a, |earliest| earliest.min(a)));
                }
                let Some(at) = at else {
                    continue;
                };
                let gap = cut - at;
                let local = at - top;
                for child in &mut cell.children {
                    insert_gap(child, 0.0, local, gap);
                }
                state.insertions.push(TableCellInsertion {
                    cell: cell.source,
                    at: local,
                    gap,
                });
                content_heights[row_index][index] += gap;
                let end = row_index + grid.rows[row_index][index].row_span;
                let available: f64 = base_heights[row_index..end].iter().sum::<f64>()
                    + state.row_growth[row_index..end].iter().sum::<f64>()
                    + grid.spacing_y * (end - row_index - 1) as f64;
                state.row_growth[end - 1] +=
                    (content_heights[row_index][index] - available).max(0.0);
            }
        }
        (_, height) = position_rows(&mut rows, grid, &base_heights, &state.row_growth);
        let children = rows
            .into_iter()
            .filter_map(|row| slice(&Fragment::Box(row), 0.0, start, cut))
            .collect();
        let continuation = (cut + EPSILON < height).then(|| BreakToken {
            resume_path: Vec::new(),
            stage: BreakTokenStage::Inside {
                consumed_block_size: cut,
            },
            pending_floats: Vec::new(),
            spanning_table: Some(state),
        });
        Ok(TableFragmentainerPlacement::Placed {
            fragment: BoxFragment {
                source: table,
                rect: FragmentRect {
                    x: 0.0,
                    y: 0.0,
                    width: grid.table_width,
                    height: cut - start,
                },
                children,
            },
            continuation,
        })
    }
}

fn position_rows(
    rows: &mut [BoxFragment],
    grid: &TableGridLayout,
    base: &[f64],
    growth: &[f64],
) -> (Vec<f64>, f64) {
    let mut offsets = Vec::with_capacity(rows.len() + 1);
    let mut y = grid.spacing_y;
    for (index, row) in rows.iter_mut().enumerate() {
        offsets.push(y);
        row.rect.y = y;
        row.rect.height = base[index] + growth[index];
        for (cell, fragment) in grid.rows[index].iter().zip(&mut row.children) {
            let Fragment::Box(fragment) = fragment else {
                unreachable!("cell boxes were validated");
            };
            let end = index + cell.row_span;
            fragment.rect.height = base[index..end].iter().sum::<f64>()
                + growth[index..end].iter().sum::<f64>()
                + grid.spacing_y * (cell.row_span - 1) as f64;
        }
        y += row.rect.height + grid.spacing_y;
    }
    offsets.push(y);
    (offsets, y)
}

/// Insert vertical space into a cell's content, retaining relative child
/// coordinates. Events are replayed in order against the same source layout.
fn insert_gap(fragment: &mut Fragment, parent_y: f64, at: f64, gap: f64) {
    let rect = fragment.rect();
    let top = parent_y + rect.y;
    if top + EPSILON >= at {
        translate_fragment(fragment, 0.0, gap);
        return;
    }
    if let Fragment::Box(root) = fragment {
        for child in &mut root.children {
            insert_gap(child, top, at, gap);
        }
        if top + root.rect.height > at + EPSILON {
            root.rect.height += gap;
        }
    }
}

/// Line boxes include their ruby/images. Do not split or repeat one on two pages.
fn atomic_bands(fragment: &Fragment, parent_y: f64, bands: &mut Vec<(f64, f64)>) {
    match fragment {
        Fragment::Box(root) => {
            for child in &root.children {
                atomic_bands(child, parent_y + root.rect.y, bands);
            }
        }
        Fragment::Line(line) => bands.push((
            parent_y + line.rect.y,
            parent_y + line.rect.y + line.rect.height,
        )),
        Fragment::Image(image) => bands.push((
            parent_y + image.rect.y,
            parent_y + image.rect.y + image.rect.height,
        )),
        Fragment::Text(text) => bands.push((
            parent_y + text.rect.y,
            parent_y + text.rect.y + text.rect.height,
        )),
    }
}

/// Return a fragment in band-local coordinates. A row's own box can end
/// before its spanning child's box: recurse even when that row has no
/// remaining height, preserving the continued cell border and its content.
fn slice(fragment: &Fragment, parent_y: f64, start: f64, end: f64) -> Option<Fragment> {
    match fragment {
        Fragment::Box(root) => {
            let top = parent_y + root.rect.y;
            let clipped_top = top.clamp(start, end);
            let clipped_bottom = (top + root.rect.height).clamp(start, end);
            let mut children: Vec<_> = root
                .children
                .iter()
                .filter_map(|child| slice(child, top, start, end))
                .collect();
            if children.is_empty() && clipped_bottom <= clipped_top + EPSILON {
                return None;
            }
            let y = clipped_top - start;
            for child in &mut children {
                translate_fragment(child, 0.0, -y);
            }
            Some(Fragment::Box(BoxFragment {
                source: root.source,
                rect: FragmentRect {
                    y,
                    height: (clipped_bottom - clipped_top).max(0.0),
                    ..root.rect
                },
                children,
            }))
        }
        Fragment::Line(line) => {
            let top = parent_y + line.rect.y;
            if top < start - EPSILON || top + line.rect.height > end + EPSILON {
                return None;
            }
            let mut line = line.clone();
            line.rect.y = top - start;
            Some(Fragment::Line(line))
        }
        Fragment::Image(image) => {
            let top = parent_y + image.rect.y;
            if top < start - EPSILON || top + image.rect.height > end + EPSILON {
                return None;
            }
            let mut image = image.clone();
            image.rect.y = top - start;
            Some(Fragment::Image(image))
        }
        Fragment::Text(text) => {
            let top = parent_y + text.rect.y;
            if top < start - EPSILON || top + text.rect.height > end + EPSILON {
                return None;
            }
            let mut text = text.clone();
            text.rect.y = top - start;
            Some(Fragment::Text(text))
        }
    }
}
