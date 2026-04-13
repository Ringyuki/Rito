import type { StyledNode } from '../../style/core/types';
import type { VerticalAlign } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { resolveMarginBottom } from '../block/resolve-pct';
import { layoutTableCellContent } from './cell-layout';
import { columnX, computeChildrenHeight, offsetChildren, spanWidth } from './shared';

interface CellResult {
  block: LayoutBlock;
  verticalAlign: VerticalAlign;
  contentHeight: number;
}

export function layoutTableRow(
  row: StyledNode,
  colCount: number,
  colWidths: readonly number[],
  y: number,
  layouter: ParagraphLayouter,
  rowOccupied: readonly boolean[],
): { block: LayoutBlock; height: number } {
  const { cellBlocks, maxCellHeight } = layoutRowCells(
    row,
    colCount,
    colWidths,
    layouter,
    rowOccupied,
  );
  const totalWidth = colWidths.reduce((sum, width) => sum + width, 0);

  return {
    block: {
      type: 'layout-block',
      bounds: { x: 0, y, width: totalWidth, height: maxCellHeight },
      children: cellBlocks.map(({ block: cellBlock, verticalAlign, contentHeight }) => {
        const dy = computeCellVerticalOffset(verticalAlign, contentHeight, maxCellHeight);
        const stretched = {
          ...cellBlock,
          bounds: { ...cellBlock.bounds, height: maxCellHeight },
        };
        if (dy > 0) {
          return { ...stretched, children: offsetChildren(stretched.children, 0, dy) };
        }
        return stretched;
      }),
    },
    height: maxCellHeight,
  };
}

function layoutRowCells(
  row: StyledNode,
  colCount: number,
  colWidths: readonly number[],
  layouter: ParagraphLayouter,
  rowOccupied: readonly boolean[],
): { cellBlocks: CellResult[]; maxCellHeight: number } {
  const cells = row.children.filter((child) => child.type === 'block');
  const cellBlocks: CellResult[] = [];
  let maxCellHeight = 0;
  let col = 0;
  let cellIndex = 0;

  while (col < colCount) {
    if (rowOccupied[col]) {
      col++;
      continue;
    }

    const cell = cells[cellIndex];
    cellIndex++;
    if (!cell) {
      cellBlocks.push({
        block: createEmptyCellBlock(colWidths, col),
        verticalAlign: 'baseline',
        contentHeight: 0,
      });
      col++;
      continue;
    }

    const result = layoutSingleCell(cell, colWidths, col, layouter);
    maxCellHeight = Math.max(maxCellHeight, result.contentHeight);
    cellBlocks.push(result);
    col += cell.colspan ?? 1;
  }

  return { cellBlocks, maxCellHeight };
}

function layoutSingleCell(
  cell: StyledNode,
  colWidths: readonly number[],
  col: number,
  layouter: ParagraphLayouter,
): CellResult {
  const colSpan = cell.colspan ?? 1;
  const cellWidth = spanWidth(colWidths, col, colSpan);
  const pt = cell.style.paddingTop;
  const pr = cell.style.paddingRight;
  const pb = cell.style.paddingBottom;
  const pl = cell.style.paddingLeft;
  const contentWidth = Math.max(cellWidth - pl - pr, 1);
  const children = layoutTableCellContent(cell, contentWidth, layouter);
  // Include trailing bottom margin of the last block child — layoutBlocks
  // tracks it in state.prevMarginBottom but it's never materialized in the
  // block bounds.  Inside a table cell this margin contributes to cell height.
  const trailing = trailingChildMarginBottom(cell, contentWidth);
  const cellHeight = computeChildrenHeight(children) + trailing + pt + pb;

  return {
    block: {
      type: 'layout-block',
      bounds: { x: columnX(colWidths, col), y: 0, width: cellWidth, height: cellHeight },
      children: offsetChildren(children, pl, pt),
    },
    verticalAlign: cell.style.verticalAlign,
    contentHeight: cellHeight,
  };
}

function computeCellVerticalOffset(
  verticalAlign: VerticalAlign,
  contentHeight: number,
  rowHeight: number,
): number {
  const gap = rowHeight - contentHeight;
  if (gap <= 0) return 0;
  switch (verticalAlign) {
    case 'bottom':
    case 'text-bottom':
      return gap;
    case 'middle':
      return gap / 2;
    case 'baseline':
    case 'top':
    case 'text-top':
    case 'super':
    case 'sub':
      return 0;
  }
}

/** Resolve the bottom margin of a cell's last in-flow block child. */
function trailingChildMarginBottom(cell: StyledNode, contentWidth: number): number {
  for (let i = cell.children.length - 1; i >= 0; i--) {
    const child = cell.children[i];
    if (child?.type === 'block') {
      // Clamp to 0: negative bottom margins should not shrink cell height.
      return Math.max(0, resolveMarginBottom(child.style, contentWidth));
    }
  }
  return 0;
}

function createEmptyCellBlock(colWidths: readonly number[], col: number): LayoutBlock {
  return {
    type: 'layout-block',
    bounds: { x: columnX(colWidths, col), y: 0, width: colWidths[col] ?? 0, height: 0 },
    children: [],
  };
}
