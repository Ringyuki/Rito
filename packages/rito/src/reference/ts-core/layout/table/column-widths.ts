import type { StyledNode } from '../../style/core/types';
import type { LineBox } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import type { InlineSegment, StyledSegment } from '../text/styled-segment';
import { flattenInlineContent, isInlineAtom } from '../text/styled-segment';
import { isCellNode } from './shared';

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
  hasExplicitWidth = false,
): readonly number[] {
  const colMin = new Array<number>(colCount).fill(0);
  const colPref = new Array<number>(colCount).fill(0);

  gatherColumnConstraints(rows, colCount, layouter, occupied, colMin, colPref);

  // For auto-width tables (no explicit CSS width), use the preferred content
  // width capped at the container width, instead of stretching to fill.
  const effectiveWidth = hasExplicitWidth
    ? tableWidth
    : Math.min(
        colPref.reduce((sum, w) => sum + w, 0),
        tableWidth,
      );
  return distributeWidths(colMin, colPref, effectiveWidth);
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
  const hPad = cell.style.paddingLeft + cell.style.paddingRight;

  // Respect CSS width on the cell (e.g. .w50 { width: 5em })
  const cssWidth = cell.style.width > 0 ? cell.style.width + hPad : 0;

  // When the cell contains block-level children (e.g. <p>, <div> inside <td>),
  // flattenInlineContent skips them and returns empty segments, resulting in
  // a near-zero preferred width.  Recursively measure block children instead.
  const hasBlockChildren = cell.children.some((c) => c.type === 'block' || c.type === 'image');

  if (hasBlockChildren) {
    let maxMin = 0;
    let maxPref = 0;
    for (const child of cell.children) {
      const info = measureNodeWidths(child, layouter);
      maxMin = Math.max(maxMin, info.minWidth);
      maxPref = Math.max(maxPref, info.prefWidth);
    }
    const contentMin = maxMin + hPad;
    const contentPref = maxPref + hPad;
    // When CSS width is set, use it as the preferred width. Content that
    // overflows will wrap within the constrained column. The minimum is
    // capped at cssWidth so that the table doesn't expand beyond its
    // container just because of content intrinsic width.
    if (cssWidth > 0) {
      return { minWidth: Math.min(contentMin, cssWidth), prefWidth: cssWidth };
    }
    return { minWidth: contentMin, prefWidth: contentPref };
  }

  const segments = flattenInlineContent(cell.children);

  if (segments.length === 0)
    return { minWidth: Math.max(hPad, cssWidth), prefWidth: Math.max(hPad, cssWidth) };

  const contentMin = measureMinimumWidth(segments, layouter) + hPad;
  const contentPref = measurePreferredWidth(segments, layouter) + hPad;
  if (cssWidth > 0) {
    return { minWidth: Math.min(contentMin, cssWidth), prefWidth: cssWidth };
  }
  return { minWidth: contentMin, prefWidth: contentPref };
}

/**
 * Recursively measure a node's intrinsic min/preferred width.
 * For block nodes with nested block children, returns the max across children.
 * For leaf blocks (inline content only), measures via the paragraph layouter.
 */
function measureNodeWidths(node: StyledNode, layouter: ParagraphLayouter): CellWidthInfo {
  // Bare text/inline nodes inside a block-level cell are ignored here, matching
  // layoutTableCellContent which routes hasBlockChildren cells through layoutBlocks
  // (which also skips bare inline siblings of block children).
  if (node.type === 'text' || node.type === 'inline') {
    return { minWidth: 0, prefWidth: 0 };
  }

  if (node.type === 'image') {
    const w = node.style.width > 0 ? node.style.width : node.style.fontSize;
    return { minWidth: w, prefWidth: w };
  }

  // Block node
  const hPad = node.style.paddingLeft + node.style.paddingRight;
  const hBorder = node.style.borderLeft.width + node.style.borderRight.width;
  const extra = hPad + hBorder;

  // Explicit CSS width takes precedence
  if (node.style.width > 0) {
    const boxWidth =
      node.style.boxSizing === 'border-box' ? node.style.width : node.style.width + extra;
    return { minWidth: boxWidth, prefWidth: boxWidth };
  }

  // Recurse into nested block children
  const hasBlockChildren = node.children.some((c) => c.type === 'block' || c.type === 'image');

  if (hasBlockChildren) {
    let maxMin = 0;
    let maxPref = 0;
    for (const child of node.children) {
      const info = measureNodeWidths(child, layouter);
      maxMin = Math.max(maxMin, info.minWidth);
      maxPref = Math.max(maxPref, info.prefWidth);
    }
    return { minWidth: maxMin + extra, prefWidth: maxPref + extra };
  }

  // Leaf block: measure inline content
  const segments = flattenInlineContent(node.children);
  if (segments.length === 0) return { minWidth: extra, prefWidth: extra };

  return {
    minWidth: measureMinimumWidth(segments, layouter) + extra,
    prefWidth: measurePreferredWidth(segments, layouter) + extra,
  };
}

function measurePreferredWidth(
  segments: readonly InlineSegment[],
  layouter: ParagraphLayouter,
): number {
  const lines = layouter.layoutParagraph(segments, LARGE_WIDTH, 0);
  return maxLineContentWidth(lines);
}

/**
 * CJK Unified Ideographs and related ranges where line breaks are allowed
 * between any two characters (CSS `word-break: normal` behavior).
 */
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2FA1F}]/u;

function measureMinimumWidth(
  segments: readonly InlineSegment[],
  layouter: ParagraphLayouter,
): number {
  let maxWordWidth = 0;

  for (const segment of segments) {
    if (isInlineAtom(segment)) {
      if (segment.width > maxWordWidth) maxWordWidth = segment.width;
      continue;
    }
    const textSeg: StyledSegment = segment;
    const chunks = splitIntoBreakableChunks(textSeg.text);
    for (const chunk of chunks) {
      const chunkSegment: StyledSegment = { text: chunk, style: textSeg.style };
      const lines = layouter.layoutParagraph([chunkSegment], LARGE_WIDTH, 0);
      const width = maxLineContentWidth(lines);
      if (width > maxWordWidth) maxWordWidth = width;
    }
  }

  return maxWordWidth;
}

/**
 * Split text into minimum breakable chunks. Latin text breaks on whitespace;
 * CJK characters are individually breakable (each character is its own chunk).
 */
function splitIntoBreakableChunks(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const ch of text) {
    if (/\s/.test(ch)) {
      if (current) {
        chunks.push(current);
        current = '';
      }
    } else if (CJK_RE.test(ch)) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(ch);
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function maxLineContentWidth(lines: readonly LineBox[]): number {
  let max = 0;
  for (const line of lines) {
    if (line.runs.length === 0) continue;
    let minX = Infinity;
    let maxRight = 0;
    for (const run of line.runs) {
      minX = Math.min(minX, run.bounds.x);
      maxRight = Math.max(maxRight, run.bounds.x + run.bounds.width);
    }
    // Use span (maxRight - minX) instead of absolute maxRight so that
    // center/right text-align offsets within LARGE_WIDTH don't inflate
    // the measured content width.
    max = Math.max(max, maxRight - minX);
  }
  return max;
}
