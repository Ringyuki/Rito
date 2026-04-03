import type { StyledNode } from '../style/types';
import type { LineBox } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import type { StyledSegment } from './styled-segment';
import { flattenInlineContent } from './styled-segment';

const CELL_PADDING = 4;
const LARGE_WIDTH = 1e6;

/** Minimum and preferred content width for a cell. */
interface CellWidthInfo {
  readonly minWidth: number;
  readonly prefWidth: number;
}

/** Check if a node is a table cell (td/th). */
function isCellNode(node: StyledNode): boolean {
  return node.type === 'block' && (node.tag === 'td' || node.tag === 'th');
}

/**
 * Compute column widths based on cell content measurement.
 *
 * 1. Measure min/pref width for every cell (single-column cells only).
 * 2. Per column, take the max min-width and max pref-width across rows.
 * 3. Distribute available table width proportionally.
 */
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

/** Walk every row/cell, measure content, and update min/pref arrays. */
function gatherColumnConstraints(
  rows: readonly StyledNode[],
  colCount: number,
  layouter: ParagraphLayouter,
  occupied: readonly (readonly boolean[])[],
  colMin: number[],
  colPref: number[],
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
      if (!cell) {
        col++;
        continue;
      }

      const cs = cell.colspan ?? 1;
      if (cs === 1) {
        const info = measureCellWidths(cell, layouter);
        const curMin = colMin[col] ?? 0;
        const curPref = colPref[col] ?? 0;
        if (info.minWidth > curMin) colMin[col] = info.minWidth;
        if (info.prefWidth > curPref) colPref[col] = info.prefWidth;
      }
      col += cs;
    }
  }
}

/**
 * Distribute `tableWidth` among columns using their min/pref constraints.
 *
 * Each column gets at least its minimum width. Remaining space is distributed
 * proportionally to (prefWidth - minWidth). If total minimums exceed the
 * table width, columns keep their minimum widths (table overflows).
 */
function distributeWidths(
  colMin: readonly number[],
  colPref: readonly number[],
  tableWidth: number,
): number[] {
  const colCount = colMin.length;
  const widths = colMin.map((m) => m);
  const totalMin = colMin.reduce((a, b) => a + b, 0);

  if (totalMin >= tableWidth) return widths;

  const remaining = tableWidth - totalMin;
  const flexTotal = colPref.reduce((sum, p, i) => sum + Math.max(p - (colMin[i] ?? 0), 0), 0);

  if (flexTotal <= 0) {
    const extra = remaining / colCount;
    return widths.map((w) => w + extra);
  }

  for (let i = 0; i < colCount; i++) {
    const flex = Math.max((colPref[i] ?? 0) - (colMin[i] ?? 0), 0);
    widths[i] = (widths[i] ?? 0) + (remaining * flex) / flexTotal;
  }
  return widths;
}

// ---------------------------------------------------------------------------
// Cell content measurement helpers
// ---------------------------------------------------------------------------

/** Measure the minimum and preferred width of a cell's content. */
function measureCellWidths(cell: StyledNode, layouter: ParagraphLayouter): CellWidthInfo {
  const padding = CELL_PADDING * 2;
  const segments = flattenInlineContent(cell.children);
  if (segments.length === 0) return { minWidth: padding, prefWidth: padding };

  const prefWidth = measurePreferredWidth(segments, layouter) + padding;
  const minWidth = measureMinimumWidth(segments, layouter) + padding;
  return { minWidth, prefWidth };
}

/** Preferred width = width if content does not wrap (single line). */
function measurePreferredWidth(
  segments: readonly StyledSegment[],
  layouter: ParagraphLayouter,
): number {
  const lines = layouter.layoutParagraph(segments, LARGE_WIDTH, 0);
  if (lines.length === 0) return 0;
  return maxLineContentWidth(lines);
}

/** Minimum width = width of the longest single word across all segments. */
function measureMinimumWidth(
  segments: readonly StyledSegment[],
  layouter: ParagraphLayouter,
): number {
  let maxWordWidth = 0;

  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter((w) => w.length > 0);
    for (const word of words) {
      const wordSeg: StyledSegment = { text: word, style: seg.style };
      const lines = layouter.layoutParagraph([wordSeg], LARGE_WIDTH, 0);
      const w = maxLineContentWidth(lines);
      if (w > maxWordWidth) maxWordWidth = w;
    }
  }

  return maxWordWidth;
}

/** Return the maximum content width across line boxes (from runs, not container). */
function maxLineContentWidth(lines: readonly LineBox[]): number {
  let max = 0;
  for (const line of lines) {
    let lineW = 0;
    for (const run of line.runs) {
      const runEnd = run.bounds.x + run.bounds.width;
      if (runEnd > lineW) lineW = runEnd;
    }
    if (lineW > max) max = lineW;
  }
  return max;
}
