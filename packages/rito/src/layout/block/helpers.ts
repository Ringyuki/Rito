import type { ComputedStyle } from '../../style/core/types';
import { PAGE_BREAKS } from '../../style/core/types';
import type { BlockBorders, LayoutBlock, LineBox } from '../core/types';

/**
 * Build border-radius fields for a LayoutBlock from a computed style.
 * Percentage values are passed through as `borderRadiusPct` for the renderer
 * to resolve per-axis (producing correct elliptical corners). Absolute values
 * are returned as `borderRadius` in px.
 */
export function resolveBorderRadius(
  style: ComputedStyle,
  _width: number,
  _height: number,
): { borderRadius?: number; borderRadiusPct?: number } {
  if (style.borderRadiusPct !== undefined) {
    return { borderRadiusPct: style.borderRadiusPct };
  }
  if (style.borderRadius > 0) {
    return { borderRadius: style.borderRadius };
  }
  return {};
}

export function extractBorders(style: ComputedStyle): BlockBorders | undefined {
  const { borderTop, borderRight, borderBottom, borderLeft } = style;
  const hasAny =
    (borderTop.style !== 'none' && borderTop.width > 0) ||
    (borderRight.style !== 'none' && borderRight.width > 0) ||
    (borderBottom.style !== 'none' && borderBottom.width > 0) ||
    (borderLeft.style !== 'none' && borderLeft.width > 0);
  if (!hasAny) return undefined;

  return {
    top: {
      width: borderTop.width,
      color: borderTop.color,
      style: borderTop.style === 'none' ? 'solid' : borderTop.style,
    },
    right: {
      width: borderRight.width,
      color: borderRight.color,
      style: borderRight.style === 'none' ? 'solid' : borderRight.style,
    },
    bottom: {
      width: borderBottom.width,
      color: borderBottom.color,
      style: borderBottom.style === 'none' ? 'solid' : borderBottom.style,
    },
    left: {
      width: borderLeft.width,
      color: borderLeft.color,
      style: borderLeft.style === 'none' ? 'solid' : borderLeft.style,
    },
  };
}

export function computeChildrenHeight(lineBoxes: readonly LineBox[]): number {
  if (lineBoxes.length === 0) return 0;
  const last = lineBoxes[lineBoxes.length - 1];
  return last ? last.bounds.y + last.bounds.height : 0;
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

/** Apply background-image properties from ComputedStyle to a LayoutBlock. */
export function applyBackgroundImage(block: LayoutBlock, style: ComputedStyle): LayoutBlock {
  if (!style.backgroundImage) return block;
  let result: LayoutBlock = { ...block, backgroundImage: style.backgroundImage };
  if (style.backgroundSize) result = { ...result, backgroundSize: style.backgroundSize };
  if (style.backgroundRepeat) result = { ...result, backgroundRepeat: style.backgroundRepeat };
  if (style.backgroundPosition)
    result = { ...result, backgroundPosition: style.backgroundPosition };
  return result;
}
