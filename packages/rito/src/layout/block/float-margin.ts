import type { StyledNode } from '../../style/core/types';
import { DISPLAY_VALUES } from '../../style/core/types';
import { resolveMarginBottom } from './resolve-pct';

export function resolveTrailingFloatMarginBottom(
  children: readonly StyledNode[],
  layoutWidth: number,
): number {
  const child = findLastInFlowBlock(children);
  if (!child) return 0;

  const margins = [resolveMarginBottom(child.style, layoutWidth)];
  if (child.style.paddingBottom <= 0 && child.style.borderBottom.width <= 0) {
    margins.push(resolveTrailingFloatMarginBottom(child.children, layoutWidth));
  }
  return collapseFloatMargins(margins);
}

function collapseFloatMargins(margins: readonly number[]): number {
  let maxPos = 0;
  let minNeg = 0;
  for (const margin of margins) {
    if (margin > maxPos) maxPos = margin;
    if (margin < minNeg) minNeg = margin;
  }
  return maxPos + minNeg;
}

function findLastInFlowBlock(children: readonly StyledNode[]): StyledNode | undefined {
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index];
    if (
      child?.type === 'block' &&
      child.style.float === 'none' &&
      child.style.position !== 'absolute' &&
      child.style.display !== DISPLAY_VALUES.InlineBlock
    ) {
      return child;
    }
  }
  return undefined;
}
