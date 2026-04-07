import type { StyledNode } from '../../style/core/types';
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
  collapseMargin(state, node.style.marginTop);
  const childListCtx = createListContext(node);
  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node.style;
  const childWidth = contentWidth - paddingLeft - paddingRight;

  const childBlocks = layoutNodesAt(
    node.children,
    childWidth > 0 ? childWidth : contentWidth,
    contentHeight,
    layouter,
    state.y + paddingTop,
    imageSizes,
    childListCtx ?? listCtx,
  );

  const indented = paddingLeft > 0 ? indentBlocks(childBlocks, paddingLeft) : childBlocks;
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
