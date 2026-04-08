import { DISPLAY_VALUES, type StyledNode } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { applyPageBreakFlags, withPageBreaks } from './helpers';
import { addListMarker, createListContext, type ListContext } from './list';
import {
  applyRelativeOffset,
  applySizeConstraints,
  indentBlocks,
  layoutTextBlock,
} from './primitives';
import { collapseMargin, type LayoutState } from './state';
import type { ImageSizeMap } from './types';

/** Layout nodes at a given startY — imported by container/float to recurse. */
export type LayoutNodesAtFn = (
  nodes: readonly StyledNode[],
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  startY: number,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
) => readonly LayoutBlock[];

export function layoutContainerBlock(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): void {
  const childListCtx = createListContext(node);
  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node.style;
  const { startY, children: adjustedChildren } = collapseContainerMarginTop(
    node,
    state,
    paddingTop,
  );

  // Apply the container's own width/maxWidth constraint before subtracting padding
  const ml = node.style.marginLeft;
  const mr = node.style.marginRight;
  let effectiveWidth = ml + mr > 0 ? contentWidth - ml - mr : contentWidth;
  effectiveWidth = applySizeConstraints(effectiveWidth, node.style);
  const childWidth = effectiveWidth - paddingLeft - paddingRight;

  const childBlocks = layoutNodesAt(
    adjustedChildren,
    childWidth > 0 ? childWidth : contentWidth,
    contentHeight,
    layouter,
    startY,
    imageSizes,
    childListCtx ?? listCtx,
  );

  const xOffset = computeAutoMarginOffset(ml, mr, node.style, effectiveWidth, contentWidth);
  const totalIndent = paddingLeft + xOffset;
  const indented = totalIndent > 0 ? indentBlocks(childBlocks, totalIndent) : childBlocks;
  applyPageBreakFlags(indented, node.style);
  if (node.id && indented.length > 0) {
    const first = indented[0];
    if (first) Object.assign(first, { anchorId: node.id });
  }

  for (const child of indented) state.blocks.push(child);
  if (indented.length > 0) {
    const last = indented[indented.length - 1];
    if (last) state.y = last.bounds.y + last.bounds.height + paddingBottom;
  }
  state.prevMarginBottom = node.style.marginBottom;
}

/**
 * Parent-child margin collapsing (CSS §8.3.1): when no top border or padding
 * separates a parent from its first in-flow block child, their top margins
 * collapse recursively through nested separator-free containers.
 *
 * Returns startY for children and an adjusted children array with absorbed
 * margins zeroed out, so that floats preceding the first in-flow child are
 * positioned correctly at state.y (after the collapsed margin).
 */
function collapseContainerMarginTop(
  node: StyledNode,
  state: LayoutState,
  paddingTop: number,
): { startY: number; children: readonly StyledNode[] } {
  const hasTopSeparator = paddingTop > 0 || node.style.borderTop.width > 0;
  if (hasTopSeparator) {
    collapseMargin(state, node.style.marginTop);
    return { startY: state.y + paddingTop, children: node.children };
  }
  const margins = [node.style.marginTop];
  const children = collectAndZeroMarginChain(node.children, margins);
  collapseMargin(state, collapseMarginChain(margins));
  return { startY: state.y, children };
}

function computeAutoMarginOffset(
  ml: number,
  mr: number,
  style: StyledNode['style'],
  effectiveWidth: number,
  contentWidth: number,
): number {
  let xOffset = ml;
  if ((style.marginLeftAuto || style.marginRightAuto) && effectiveWidth < contentWidth) {
    const remaining = contentWidth - effectiveWidth;
    if (style.marginLeftAuto && style.marginRightAuto) {
      xOffset = remaining / 2;
    } else if (style.marginLeftAuto) {
      xOffset = remaining - mr;
    }
  }
  return xOffset;
}

function isFirstInFlow(c: StyledNode): boolean {
  return (
    c.type === 'block' && c.style.float === 'none' && c.style.display !== DISPLAY_VALUES.InlineBlock
  );
}

/**
 * Walk the first in-flow child chain, collecting each margin-top and zeroing
 * it out. Stops when a child has top border or padding (separator).
 */
function collectAndZeroMarginChain(
  children: readonly StyledNode[],
  margins: number[],
): readonly StyledNode[] {
  const idx = children.findIndex(isFirstInFlow);
  if (idx < 0) return children;
  const child = children[idx];
  if (!child) return children;
  margins.push(child.style.marginTop);
  let modified: StyledNode = { ...child, style: { ...child.style, marginTop: 0 } };
  if (child.style.paddingTop <= 0 && child.style.borderTop.width <= 0) {
    const nested = collectAndZeroMarginChain(modified.children, margins);
    if (nested !== modified.children) modified = { ...modified, children: nested };
  }
  const result = [...children];
  result[idx] = modified;
  return result;
}

/** Collapse a chain of margins: max of positives + min of negatives. */
function collapseMarginChain(margins: number[]): number {
  let maxPos = 0;
  let minNeg = 0;
  for (const m of margins) {
    if (m > maxPos) maxPos = m;
    if (m < minNeg) minNeg = m;
  }
  return maxPos + minNeg;
}

export function layoutLeafBlock(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): void {
  collapseMargin(state, node.style.marginTop);

  const ml = node.style.marginLeft;
  const mr = node.style.marginRight;
  const mlAuto = node.style.marginLeftAuto;
  const mrAuto = node.style.marginRightAuto;

  let width = ml + mr > 0 ? contentWidth - ml - mr : contentWidth;
  width = applySizeConstraints(width, node.style);
  width -= state.floats.getLeftWidth(state.y) + state.floats.getRightWidth(state.y);

  let block = layoutTextBlock(node, Math.max(width, 1), state.y, layouter, imageSizes);
  block = addListMarker(block, node, listCtx);

  let xOffset = ml + state.floats.getLeftWidth(state.y);
  if ((mlAuto || mrAuto) && block.bounds.width < contentWidth) {
    const remaining = contentWidth - block.bounds.width;
    if (mlAuto && mrAuto) {
      xOffset = remaining / 2;
    } else if (mlAuto) {
      xOffset = remaining - mr;
    }
  }

  if (xOffset > 0) {
    block = { ...block, bounds: { ...block.bounds, x: block.bounds.x + xOffset } };
  }
  if (node.id) block = { ...block, anchorId: node.id };
  block = applyRelativeOffset(block, node.style);
  state.blocks.push(withPageBreaks(block, node.style));
  state.y += block.bounds.height;
  state.prevMarginBottom = node.style.marginBottom;
}
