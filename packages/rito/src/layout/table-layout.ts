import type { StyledNode } from '../style/types';
import type { LayoutBlock, LineBox } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import { flattenInlineContent } from './styled-segment';
import { layoutBlocks } from './block-layout';
import { computeColumnWidths } from './table-column-widths';

const CELL_PADDING = 4;

/**
 * Layout a <table> StyledNode with content-based auto column widths.
 *
 * Supports colspan and rowspan attributes on cells.
 */
export function layoutTable(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
): LayoutBlock {
  const rows = collectRows(node);
  const colCount = rows.length > 0 ? computeColumnCount(rows) : 0;
  if (colCount === 0) {
    return emptyBlock(contentWidth, y);
  }

  const occupied: boolean[][] = rows.map(() =>
    Array.from<boolean>({ length: colCount }).fill(false),
  );
  applyRowspanOccupancy(rows, occupied, colCount);

  const colWidths = computeColumnWidths(rows, colCount, contentWidth, layouter, occupied);

  const rowBlocks: LayoutBlock[] = [];
  let currentY = 0;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const { block, height } = layoutRowWithWidths(
      row,
      colCount,
      colWidths,
      currentY,
      layouter,
      occupied[r] ?? [],
    );
    rowBlocks.push(block);
    currentY += height;
  }

  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height: currentY },
    children: rowBlocks,
  };
}

function emptyBlock(width: number, y: number): LayoutBlock {
  return { type: 'layout-block', bounds: { x: 0, y, width, height: 0 }, children: [] };
}

/** Compute the effective column count from the widest row (accounting for colspan). */
function computeColumnCount(rows: readonly StyledNode[]): number {
  let max = 0;
  for (const row of rows) {
    let count = 0;
    for (const cell of row.children) {
      if (!isCellNode(cell)) continue;
      count += cell.colspan ?? 1;
    }
    if (count > max) max = count;
  }
  return max;
}

/** Check if a node is a table cell (td/th). */
function isCellNode(node: StyledNode): boolean {
  return node.type === 'block' && (node.tag === 'td' || node.tag === 'th');
}

/** Mark grid positions occupied by rowspan cells. */
function applyRowspanOccupancy(
  rows: readonly StyledNode[],
  occupied: boolean[][],
  colCount: number,
): void {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const cells = row.children.filter(isCellNode);
    let col = 0;
    let childIdx = 0;
    while (col < colCount && childIdx < cells.length) {
      while (col < colCount && occupied[r]?.[col]) col++;
      if (col >= colCount) break;

      const cell = cells[childIdx];
      childIdx++;
      if (!cell) continue;

      const cs = cell.colspan ?? 1;
      const rs = cell.rowspan ?? 1;

      if (rs > 1) {
        for (let dr = 1; dr < rs && r + dr < rows.length; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            const oRow = occupied[r + dr];
            if (oRow && col + dc < colCount) {
              oRow[col + dc] = true;
            }
          }
        }
      }

      col += cs;
    }
  }
}

/** Collect all <tr> nodes from the table, unwrapping thead/tbody/tfoot. */
function collectRows(table: StyledNode): StyledNode[] {
  const rows: StyledNode[] = [];
  for (const child of table.children) {
    if (child.type !== 'block') continue;
    if (child.tag === 'tr') {
      rows.push(child);
    } else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
      for (const grandchild of child.children) {
        if (grandchild.type === 'block' && grandchild.tag === 'tr') {
          rows.push(grandchild);
        }
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Row layout (using per-column widths)
// ---------------------------------------------------------------------------

/** Compute the x-offset for column `col` given variable-width columns. */
function columnX(colWidths: readonly number[], col: number): number {
  let x = 0;
  for (let i = 0; i < col; i++) x += colWidths[i] ?? 0;
  return x;
}

/** Sum widths from `col` over `span` columns. */
function spanWidth(colWidths: readonly number[], col: number, span: number): number {
  let w = 0;
  for (let i = col; i < col + span; i++) w += colWidths[i] ?? 0;
  return w;
}

/** Layout a single table row with variable column widths. */
function layoutRowWithWidths(
  row: StyledNode,
  colCount: number,
  colWidths: readonly number[],
  y: number,
  layouter: ParagraphLayouter,
  rowOccupied: readonly boolean[],
): { block: LayoutBlock; height: number } {
  const cells = row.children.filter(isCellNode);
  const { cellBlocks, maxCellHeight } = layoutRowCellsWithWidths(
    cells,
    colCount,
    colWidths,
    layouter,
    rowOccupied,
  );

  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const normalizedCells = cellBlocks.map((c) => ({
    ...c,
    bounds: { ...c.bounds, height: maxCellHeight },
  }));

  return {
    block: {
      type: 'layout-block',
      bounds: { x: 0, y, width: totalWidth, height: maxCellHeight },
      children: normalizedCells,
    },
    height: maxCellHeight,
  };
}

function layoutRowCellsWithWidths(
  cells: readonly StyledNode[],
  colCount: number,
  colWidths: readonly number[],
  layouter: ParagraphLayouter,
  rowOccupied: readonly boolean[],
): { cellBlocks: LayoutBlock[]; maxCellHeight: number } {
  const cellBlocks: LayoutBlock[] = [];
  let maxCellHeight = 0;
  let col = 0;
  let childIdx = 0;

  while (col < colCount) {
    if (rowOccupied[col]) {
      col++;
      continue;
    }

    const cell = cells[childIdx];
    childIdx++;

    if (!cell) {
      const w = colWidths[col] ?? 0;
      cellBlocks.push({
        type: 'layout-block',
        bounds: { x: columnX(colWidths, col), y: 0, width: w, height: 0 },
        children: [],
      });
      col++;
      continue;
    }

    const cs = cell.colspan ?? 1;
    const cellW = spanWidth(colWidths, col, cs);
    const cellContentWidth = Math.max(cellW - CELL_PADDING * 2, 1);
    const cellChildren = layoutCellContent(cell, cellContentWidth, layouter);
    const cellHeight = computeBlockChildrenHeight(cellChildren) + CELL_PADDING * 2;
    if (cellHeight > maxCellHeight) maxCellHeight = cellHeight;

    cellBlocks.push({
      type: 'layout-block',
      bounds: { x: columnX(colWidths, col), y: 0, width: cellW, height: cellHeight },
      children: offsetChildren(cellChildren, CELL_PADDING, CELL_PADDING),
    });
    col += cs;
  }

  return { cellBlocks, maxCellHeight };
}

/** Layout a cell's content. Supports block and inline children. */
function layoutCellContent(
  cell: StyledNode,
  width: number,
  layouter: ParagraphLayouter,
): readonly (LineBox | LayoutBlock)[] {
  const hasBlockChildren = cell.children.some((c) => c.type === 'block' || c.type === 'image');

  if (hasBlockChildren) {
    return layoutBlocks(cell.children, width, layouter);
  }

  const segments = flattenInlineContent(cell.children);
  if (segments.length === 0) return [];
  return layouter.layoutParagraph(segments, width, 0);
}

function computeBlockChildrenHeight(children: readonly (LineBox | LayoutBlock)[]): number {
  if (children.length === 0) return 0;
  const last = children[children.length - 1];
  if (!last) return 0;
  return last.bounds.y + last.bounds.height;
}

function offsetChildren(
  children: readonly (LineBox | LayoutBlock)[],
  dx: number,
  dy: number,
): (LineBox | LayoutBlock)[] {
  return children.map((child) => {
    if (child.type === 'line-box') {
      return {
        ...child,
        bounds: { ...child.bounds, x: child.bounds.x + dx, y: child.bounds.y + dy },
        runs: child.runs.map((r) => ({
          ...r,
          bounds: { ...r.bounds, x: r.bounds.x + dx, y: r.bounds.y + dy },
        })),
      };
    }
    return {
      ...child,
      bounds: { ...child.bounds, x: child.bounds.x + dx, y: child.bounds.y + dy },
    };
  });
}
