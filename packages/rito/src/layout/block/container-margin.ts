import type { StyledNode } from '../../style/core/types';
import { isFirstInFlow } from './container-wrapper';
import { resolveMarginTop } from './resolve-pct';
import { collapseMargin, type LayoutState } from './state';

/**
 * Parent-child margin collapsing: when no top border or padding separates a
 * parent from its first in-flow block child, their top margins collapse through
 * nested separator-free containers.
 */
export function collapseContainerMarginTop(
  node: StyledNode,
  state: LayoutState,
  paddingTop: number,
  containerWidth: number,
): { readonly startY: number; readonly children: readonly StyledNode[] } {
  const hasTopSeparator = paddingTop > 0 || node.style.borderTop.width > 0;
  if (hasTopSeparator) {
    collapseMargin(state, resolveMarginTop(node.style, containerWidth));
    return { startY: state.y + paddingTop, children: node.children };
  }
  const margins = [resolveMarginTop(node.style, containerWidth)];
  const children = collectAndZeroMarginChain(node.children, margins, containerWidth);
  collapseMargin(state, collapseMarginChain(margins));
  return { startY: state.y, children };
}

function collectAndZeroMarginChain(
  children: readonly StyledNode[],
  margins: number[],
  containerWidth: number,
): readonly StyledNode[] {
  const index = children.findIndex(isFirstInFlow);
  const child = index >= 0 ? children[index] : undefined;
  if (!child) return children;

  margins.push(resolveMarginTop(child.style, containerWidth));
  let modified = zeroTopMargin(child);
  if (child.style.paddingTop <= 0 && child.style.borderTop.width <= 0) {
    const nested = collectAndZeroMarginChain(modified.children, margins, containerWidth);
    if (nested !== modified.children) modified = { ...modified, children: nested };
  }
  const result = [...children];
  result[index] = modified;
  return result;
}

function zeroTopMargin(child: StyledNode): StyledNode {
  const { marginTopPct: _, ...styleWithoutPct } = child.style;
  return { ...child, style: { ...styleWithoutPct, marginTop: 0 } };
}

function collapseMarginChain(margins: readonly number[]): number {
  let maxPos = 0;
  let minNeg = 0;
  for (const margin of margins) {
    if (margin > maxPos) maxPos = margin;
    if (margin < minNeg) minNeg = margin;
  }
  return maxPos + minNeg;
}
