import type { StyledNode } from '../../style/types';
import type { ParagraphLayouter } from '../paragraph-layouter';
import type { LayoutBlock } from '../types';
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

  const colWidths = computeColumnWidths(
    model.rows,
    model.colCount,
    contentWidth,
    layouter,
    model.occupied,
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

  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height: currentY },
    children: rowBlocks,
  };
}
