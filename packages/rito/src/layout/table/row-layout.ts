import type { StyledNode } from '../../style/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { layoutTableCellContent } from './cell-layout';
import { CELL_PADDING, columnX, computeChildrenHeight, offsetChildren, spanWidth } from './shared';

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
      children: cellBlocks.map((cellBlock) => ({
        ...cellBlock,
        bounds: { ...cellBlock.bounds, height: maxCellHeight },
      })),
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
): { cellBlocks: LayoutBlock[]; maxCellHeight: number } {
  const cells = row.children.filter((child) => child.type === 'block');
  const cellBlocks: LayoutBlock[] = [];
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
      cellBlocks.push(createEmptyCellBlock(colWidths, col));
      col++;
      continue;
    }

    const colSpan = cell.colspan ?? 1;
    const cellWidth = spanWidth(colWidths, col, colSpan);
    const contentWidth = Math.max(cellWidth - CELL_PADDING * 2, 1);
    const children = layoutTableCellContent(cell, contentWidth, layouter);
    const cellHeight = computeChildrenHeight(children) + CELL_PADDING * 2;

    maxCellHeight = Math.max(maxCellHeight, cellHeight);
    cellBlocks.push({
      type: 'layout-block',
      bounds: { x: columnX(colWidths, col), y: 0, width: cellWidth, height: cellHeight },
      children: offsetChildren(children, CELL_PADDING, CELL_PADDING),
    });
    col += colSpan;
  }

  return { cellBlocks, maxCellHeight };
}

function createEmptyCellBlock(colWidths: readonly number[], col: number): LayoutBlock {
  return {
    type: 'layout-block',
    bounds: { x: columnX(colWidths, col), y: 0, width: colWidths[col] ?? 0, height: 0 },
    children: [],
  };
}
