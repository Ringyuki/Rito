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

  // Table padding and border insets — rows are laid out inside these
  const paddingTop = node.style.paddingTop;
  const paddingRight = node.style.paddingRight;
  const paddingBottom = node.style.paddingBottom;
  const paddingLeft = node.style.paddingLeft;
  const borderTop = node.style.borderTop.width;
  const borderRight = node.style.borderRight.width;
  const borderBottom = node.style.borderBottom.width;
  const borderLeft = node.style.borderLeft.width;
  const innerWidth = contentWidth - paddingLeft - paddingRight - borderLeft - borderRight;

  const hasExplicitWidth = node.style.width > 0 || node.style.widthPct !== undefined;
  const colWidths = computeColumnWidths(
    model.rows,
    model.colCount,
    innerWidth > 0 ? innerWidth : contentWidth,
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

  // Offset rows by table border + padding so content sits inside the box
  const dx = borderLeft + paddingLeft;
  const dy = borderTop + paddingTop;
  const children =
    dx > 0 || dy > 0
      ? rowBlocks.map((b) => ({
          ...b,
          bounds: { ...b.bounds, x: b.bounds.x + dx, y: b.bounds.y + dy },
        }))
      : rowBlocks;

  const colTotal = colWidths.reduce((sum, w) => sum + w, 0);
  const totalWidth = colTotal + paddingLeft + paddingRight + borderLeft + borderRight;
  const totalHeight = currentY + paddingTop + paddingBottom + borderTop + borderBottom;
  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: totalWidth, height: totalHeight },
    children,
  };
}
