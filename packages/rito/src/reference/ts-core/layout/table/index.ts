import type { StyledNode } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import type { ImageSizeMap } from '../block/types';
import { computeColumnWidths } from './column-widths';
import { buildTableModel } from './model';
import { layoutTableRow } from './row-layout';

interface TableInsets {
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly borderTop: number;
  readonly borderRight: number;
  readonly borderBottom: number;
  readonly borderLeft: number;
  readonly innerWidth: number;
}

interface TableRowsLayout {
  readonly blocks: readonly LayoutBlock[];
  readonly height: number;
}

export function layoutTable(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
): LayoutBlock {
  const model = buildTableModel(node);
  if (!model) return buildEmptyTableBlock(contentWidth, y);

  const insets = resolveTableInsets(node, contentWidth);

  const hasExplicitWidth = node.style.width > 0 || node.style.widthPct !== undefined;
  const colWidths = computeColumnWidths(
    model.rows,
    model.colCount,
    insets.innerWidth > 0 ? insets.innerWidth : contentWidth,
    layouter,
    model.occupied,
    hasExplicitWidth,
  );

  const rows = layoutRows(
    model.rows,
    model.colCount,
    colWidths,
    layouter,
    model.occupied,
    imageSizes,
  );
  const children = offsetRows(rows.blocks, insets);
  const colTotal = colWidths.reduce((sum, w) => sum + w, 0);
  const totalWidth =
    colTotal + insets.paddingLeft + insets.paddingRight + insets.borderLeft + insets.borderRight;
  const totalHeight =
    rows.height + insets.paddingTop + insets.paddingBottom + insets.borderTop + insets.borderBottom;

  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: totalWidth, height: totalHeight },
    children,
  };
}

function buildEmptyTableBlock(contentWidth: number, y: number): LayoutBlock {
  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height: 0 },
    children: [],
  };
}

function resolveTableInsets(node: StyledNode, contentWidth: number): TableInsets {
  const paddingTop = node.style.paddingTop;
  const paddingRight = node.style.paddingRight;
  const paddingBottom = node.style.paddingBottom;
  const paddingLeft = node.style.paddingLeft;
  const borderTop = node.style.borderTop.width;
  const borderRight = node.style.borderRight.width;
  const borderBottom = node.style.borderBottom.width;
  const borderLeft = node.style.borderLeft.width;
  return {
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    borderTop,
    borderRight,
    borderBottom,
    borderLeft,
    innerWidth: contentWidth - paddingLeft - paddingRight - borderLeft - borderRight,
  };
}

function layoutRows(
  rows: readonly StyledNode[],
  colCount: number,
  colWidths: readonly number[],
  layouter: ParagraphLayouter,
  occupied: readonly (readonly boolean[])[],
  imageSizes: ImageSizeMap | undefined,
): TableRowsLayout {
  const rowBlocks: LayoutBlock[] = [];
  let currentY = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!row) continue;

    const { block, height } = layoutTableRow(
      row,
      colCount,
      colWidths,
      currentY,
      layouter,
      occupied[rowIndex] ?? [],
      imageSizes,
    );
    rowBlocks.push(block);
    currentY += height;
  }
  return { blocks: rowBlocks, height: currentY };
}

function offsetRows(
  rowBlocks: readonly LayoutBlock[],
  insets: TableInsets,
): readonly LayoutBlock[] {
  const dx = insets.borderLeft + insets.paddingLeft;
  const dy = insets.borderTop + insets.paddingTop;
  if (dx <= 0 && dy <= 0) return rowBlocks;
  return rowBlocks.map((block) => ({
    ...block,
    bounds: { ...block.bounds, x: block.bounds.x + dx, y: block.bounds.y + dy },
  }));
}
