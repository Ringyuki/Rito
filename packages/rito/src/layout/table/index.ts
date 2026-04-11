import type { StyledNode } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { computeColumnWidths } from './column-widths';
import { buildTableModel } from './model';
import { layoutTableRow } from './row-layout';

export function layoutTable(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
): LayoutBlock {
  const model = buildTableModel(node);
  if (!model) {
    return {
      type: 'layout-block',
      bounds: { x: 0, y, width: contentWidth, height: 0 },
      children: [],
    };
  }

  const hasExplicitWidth = node.style.width > 0 || node.style.widthPct !== undefined;
  const colWidths = computeColumnWidths(
    model.rows,
    model.colCount,
    contentWidth,
    layouter,
    model.occupied,
    hasExplicitWidth,
  );

  const rowBlocks: LayoutBlock[] = [];
  let currentY = 0;
  for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex++) {
    const row = model.rows[rowIndex];
    if (!row) continue;

    const { block, height } = layoutTableRow(
      row,
      model.colCount,
      colWidths,
      currentY,
      layouter,
      model.occupied[rowIndex] ?? [],
    );
    rowBlocks.push(block);
    currentY += height;
  }

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: totalWidth, height: currentY },
    children: rowBlocks,
  };
}
