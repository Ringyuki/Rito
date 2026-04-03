import type { ComputedStyle } from '../style/types';
import { PAGE_BREAKS } from '../style/types';
import type { BlockBorders, LayoutBlock, LineBox } from './types';

export function extractBorders(style: ComputedStyle): BlockBorders | undefined {
  const { borderTop, borderRight, borderBottom, borderLeft } = style;
  const hasAny =
    (borderTop.style === 'solid' && borderTop.width > 0) ||
    (borderRight.style === 'solid' && borderRight.width > 0) ||
    (borderBottom.style === 'solid' && borderBottom.width > 0) ||
    (borderLeft.style === 'solid' && borderLeft.width > 0);
  if (!hasAny) return undefined;
  return {
    top: { width: borderTop.width, color: borderTop.color },
    right: { width: borderRight.width, color: borderRight.color },
    bottom: { width: borderBottom.width, color: borderBottom.color },
    left: { width: borderLeft.width, color: borderLeft.color },
  };
}

export function computeChildrenHeight(lineBoxes: readonly LineBox[]): number {
  if (lineBoxes.length === 0) return 0;
  const last = lineBoxes[lineBoxes.length - 1];
  if (!last) return 0;
  return last.bounds.y + last.bounds.height;
}

export function withPageBreaks(block: LayoutBlock, style: ComputedStyle): LayoutBlock {
  const before = style.pageBreakBefore === PAGE_BREAKS.Always;
  const after = style.pageBreakAfter === PAGE_BREAKS.Always;
  if (!before && !after) return block;
  const result = { ...block };
  if (before) (result as { pageBreakBefore?: boolean }).pageBreakBefore = true;
  if (after) (result as { pageBreakAfter?: boolean }).pageBreakAfter = true;
  return result;
}

export function applyPageBreakFlags(blocks: readonly LayoutBlock[], style: ComputedStyle): void {
  if (blocks.length === 0) return;
  if (style.pageBreakBefore === PAGE_BREAKS.Always) {
    const first = blocks[0];
    if (first) Object.assign(first, { pageBreakBefore: true });
  }
  if (style.pageBreakAfter === PAGE_BREAKS.Always) {
    const last = blocks[blocks.length - 1];
    if (last) Object.assign(last, { pageBreakAfter: true });
  }
}
