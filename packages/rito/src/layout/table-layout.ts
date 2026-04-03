import type { StyledNode } from '../style/types';
import type { LayoutBlock, LineBox } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import { flattenInlineContent } from './styled-segment';
import { layoutBlocks } from './block-layout';

const CELL_PADDING = 4;

/**
 * Layout a <table> StyledNode as a grid of equal-width columns.
 *
 * Walks the table's children (thead/tbody/tfoot/tr) to find rows,
 * determines column count from the widest row, and lays out each
 * cell's content within its column width.
 */
export function layoutTable(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
): LayoutBlock {
  const rows = collectRows(node);
  if (rows.length === 0) {
    return {
      type: 'layout-block',
      bounds: { x: 0, y, width: contentWidth, height: 0 },
      children: [],
    };
  }

  const colCount = Math.max(...rows.map((r) => r.children.length), 1);
  const colWidth = contentWidth / colCount;
  const cellContentWidth = Math.max(colWidth - CELL_PADDING * 2, 1);

  const rowBlocks: LayoutBlock[] = [];
  let currentY = 0;

  for (const row of rows) {
    const { block, height } = layoutRow(
      row,
      colCount,
      colWidth,
      cellContentWidth,
      currentY,
      layouter,
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

/** Layout a single table row. Returns the row block and its height. */
function layoutRow(
  row: StyledNode,
  colCount: number,
  colWidth: number,
  cellContentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
): { block: LayoutBlock; height: number } {
  const cellBlocks: LayoutBlock[] = [];
  let maxCellHeight = 0;

  for (let col = 0; col < colCount; col++) {
    const cell = row.children[col];
    const x = col * colWidth;

    if (!cell || (cell.type !== 'block' && cell.type !== 'inline')) {
      cellBlocks.push({
        type: 'layout-block',
        bounds: { x, y: 0, width: colWidth, height: 0 },
        children: [],
      });
      continue;
    }

    const cellChildren = layoutCellContent(cell, cellContentWidth, layouter);
    const contentHeight = computeBlockChildrenHeight(cellChildren);
    const cellHeight = contentHeight + CELL_PADDING * 2;

    if (cellHeight > maxCellHeight) maxCellHeight = cellHeight;

    // Offset children by cell padding
    const paddedChildren = offsetChildren(cellChildren, CELL_PADDING, CELL_PADDING);

    cellBlocks.push({
      type: 'layout-block',
      bounds: { x, y: 0, width: colWidth, height: cellHeight },
      children: paddedChildren,
    });
  }

  const normalizedCells = cellBlocks.map((cell) => ({
    ...cell,
    bounds: { ...cell.bounds, height: maxCellHeight },
  }));

  return {
    block: {
      type: 'layout-block',
      bounds: { x: 0, y, width: colCount * colWidth, height: maxCellHeight },
      children: normalizedCells,
    },
    height: maxCellHeight,
  };
}

/**
 * Layout a cell's content. Supports both inline-only cells and cells
 * containing block elements (e.g. <p>, <div>).
 */
function layoutCellContent(
  cell: StyledNode,
  width: number,
  layouter: ParagraphLayouter,
): readonly (LineBox | LayoutBlock)[] {
  const hasBlockChildren = cell.children.some((c) => c.type === 'block' || c.type === 'image');

  if (hasBlockChildren) {
    // Cell contains block elements — use the full block layout pipeline
    return layoutBlocks(cell.children, width, layouter);
  }

  // Cell contains only inline/text content
  const segments = flattenInlineContent(cell.children);
  if (segments.length === 0) return [];
  return layouter.layoutParagraph(segments, width, 0);
}

/** Compute total height of a mix of LineBox and LayoutBlock children. */
function computeBlockChildrenHeight(
  children: readonly (LineBox | LayoutBlock)[],
): number {
  if (children.length === 0) return 0;
  const last = children[children.length - 1];
  if (!last) return 0;
  return last.bounds.y + last.bounds.height;
}

/** Offset all children (LineBox or LayoutBlock) by dx/dy. */
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
    // LayoutBlock
    return {
      ...child,
      bounds: { ...child.bounds, x: child.bounds.x + dx, y: child.bounds.y + dy },
    };
  });
}
