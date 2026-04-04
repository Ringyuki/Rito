import type { StyledNode } from '../../style/types';
import type { LineBox } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import type { StyledSegment } from '../text/styled-segment';
import { flattenInlineContent } from '../text/styled-segment';
import { CELL_PADDING, isCellNode } from './shared';

const LARGE_WIDTH = 1e6;

interface CellWidthInfo {
  readonly minWidth: number;
  readonly prefWidth: number;
}

export function computeColumnWidths(
  rows: readonly StyledNode[],
  colCount: number,
  tableWidth: number,
  layouter: ParagraphLayouter,
  occupied: readonly (readonly boolean[])[],
): readonly number[] {
  const colMin = new Array<number>(colCount).fill(0);
  const colPref = new Array<number>(colCount).fill(0);

  gatherColumnConstraints(rows, colCount, layouter, occupied, colMin, colPref);
  return distributeWidths(colMin, colPref, tableWidth);
}

function gatherColumnConstraints(
  rows: readonly StyledNode[],
  colCount: number,
  layouter: ParagraphLayouter,
  occupied: readonly (readonly boolean[])[],
  colMin: number[],
  colPref: number[],
): void {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!row) continue;

    const cells = row.children.filter(isCellNode);
    let col = 0;
    let cellIndex = 0;
    while (col < colCount && cellIndex < cells.length) {
      while (col < colCount && occupied[rowIndex]?.[col]) col++;
      if (col >= colCount) break;

      const cell = cells[cellIndex];
      cellIndex++;
      if (!cell) {
        col++;
        continue;
      }

      const colSpan = cell.colspan ?? 1;
      if (colSpan === 1) updateColumnConstraints(cell, layouter, col, colMin, colPref);
      col += colSpan;
    }
  }
}

function updateColumnConstraints(
  cell: StyledNode,
  layouter: ParagraphLayouter,
  col: number,
  colMin: number[],
  colPref: number[],
): void {
  const info = measureCellWidths(cell, layouter);
  colMin[col] = Math.max(colMin[col] ?? 0, info.minWidth);
  colPref[col] = Math.max(colPref[col] ?? 0, info.prefWidth);
}

function distributeWidths(
  colMin: readonly number[],
  colPref: readonly number[],
  tableWidth: number,
): number[] {
  const widths = colMin.map((minWidth) => minWidth);
  const totalMin = colMin.reduce((sum, minWidth) => sum + minWidth, 0);
  if (totalMin >= tableWidth) return widths;

  const remaining = tableWidth - totalMin;
  const flexTotal = colPref.reduce((sum, prefWidth, index) => {
    return sum + Math.max(prefWidth - (colMin[index] ?? 0), 0);
  }, 0);

  if (flexTotal <= 0) {
    const extra = remaining / colMin.length;
    return widths.map((width) => width + extra);
  }

  for (let index = 0; index < colMin.length; index++) {
    const flex = Math.max((colPref[index] ?? 0) - (colMin[index] ?? 0), 0);
    widths[index] = (widths[index] ?? 0) + (remaining * flex) / flexTotal;
  }
  return widths;
}

function measureCellWidths(cell: StyledNode, layouter: ParagraphLayouter): CellWidthInfo {
  const padding = CELL_PADDING * 2;
  const segments = flattenInlineContent(cell.children);
  if (segments.length === 0) return { minWidth: padding, prefWidth: padding };

  return {
    minWidth: measureMinimumWidth(segments, layouter) + padding,
    prefWidth: measurePreferredWidth(segments, layouter) + padding,
  };
}

function measurePreferredWidth(
  segments: readonly StyledSegment[],
  layouter: ParagraphLayouter,
): number {
  const lines = layouter.layoutParagraph(segments, LARGE_WIDTH, 0);
  return maxLineContentWidth(lines);
}

function measureMinimumWidth(
  segments: readonly StyledSegment[],
  layouter: ParagraphLayouter,
): number {
  let maxWordWidth = 0;

  for (const segment of segments) {
    const words = segment.text.split(/\s+/).filter((word) => word.length > 0);
    for (const word of words) {
      const wordSegment: StyledSegment = { text: word, style: segment.style };
      const lines = layouter.layoutParagraph([wordSegment], LARGE_WIDTH, 0);
      const width = maxLineContentWidth(lines);
      if (width > maxWordWidth) maxWordWidth = width;
    }
  }

  return maxWordWidth;
}

function maxLineContentWidth(lines: readonly LineBox[]): number {
  let max = 0;
  for (const line of lines) {
    let lineWidth = 0;
    for (const run of line.runs) {
      lineWidth = Math.max(lineWidth, run.bounds.x + run.bounds.width);
    }
    max = Math.max(max, lineWidth);
  }
  return max;
}
