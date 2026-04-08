import type { StyledNode } from '../../style/core/types';
import { DISPLAY_VALUES } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { addListMarker, createListContext, type ListContext } from './list';
import {
  applyRelativeOffset,
  applySizeConstraints,
  indentBlocks,
  layoutTextBlock,
} from './primitives';
import type { LayoutNodesAtFn } from './flow-layout';
import type { LayoutState } from './state';
import type { ImageSizeMap } from './types';

export function layoutFloatedBlock(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): void {
  // Float margins don't collapse — advance by both margins directly
  state.y += state.prevMarginBottom + node.style.marginTop;
  state.prevMarginBottom = 0;

  const { marginLeft: ml, marginRight: mr } = node.style;
  const side = node.style.float as 'left' | 'right';
  const availWidth = contentWidth - ml - mr;
  const layoutWidth =
    node.style.width > 0
      ? Math.min(applySizeConstraints(node.style.width, node.style), availWidth)
      : availWidth;

  let block = hasBlockChildren(node)
    ? layoutFloatedContainer(
        node,
        layoutWidth,
        contentHeight,
        layouter,
        layoutNodesAt,
        imageSizes,
        listCtx,
      )
    : layoutFloatedLeaf(node, layoutWidth, layouter, imageSizes, listCtx);

  if (node.tag) block = { ...block, semanticTag: node.tag };
  if (node.id) block = { ...block, anchorId: node.id };

  const totalWidth = block.bounds.width + ml + mr;
  const placeY = findFloatPlaceY(state, totalWidth, contentWidth);

  const floatX =
    side === 'right'
      ? contentWidth - block.bounds.width - mr - state.floats.getRightWidth(placeY)
      : ml + state.floats.getLeftWidth(placeY);

  block = { ...block, bounds: { ...block.bounds, x: floatX, y: placeY } };
  state.blocks.push(block);
  state.floats.addFloat(side, totalWidth, placeY, placeY + block.bounds.height);
}

function layoutFloatedContainer(
  node: StyledNode,
  layoutWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): LayoutBlock {
  const childListCtx = createListContext(node);
  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node.style;
  const childWidth = layoutWidth - paddingLeft - paddingRight;
  const childBlocks = layoutNodesAt(
    node.children,
    childWidth > 0 ? childWidth : layoutWidth,
    contentHeight,
    layouter,
    paddingTop,
    imageSizes,
    childListCtx ?? listCtx,
  );
  const indented = paddingLeft > 0 ? indentBlocks(childBlocks, paddingLeft) : childBlocks;
  const last = indented[indented.length - 1];
  const height = last ? last.bounds.y + last.bounds.height + paddingBottom : 0;
  const actualWidth =
    node.style.width > 0 ? layoutWidth : shrinkToFitWidth(indented, paddingRight, layoutWidth);
  return {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: actualWidth, height },
    children: indented,
  };
}

function layoutFloatedLeaf(
  node: StyledNode,
  layoutWidth: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): LayoutBlock {
  let raw = layoutTextBlock(node, Math.max(layoutWidth, 1), 0, layouter, imageSizes);
  raw = addListMarker(raw, node, listCtx);
  raw = applyRelativeOffset(raw, node.style);
  if (node.style.width <= 0) {
    const fitWidth = shrinkToFitWidth(raw.children, node.style.paddingRight, layoutWidth);
    raw = { ...raw, bounds: { ...raw.bounds, width: fitWidth } };
  }
  return raw;
}

/**
 * Search downward for a Y where the float fits alongside active floats.
 * Read-only queries only — does not mutate FloatContext.
 */
function findFloatPlaceY(state: LayoutState, totalWidth: number, contentWidth: number): number {
  let placeY = state.y;
  for (;;) {
    const usedLeft = state.floats.getLeftWidth(placeY);
    const usedRight = state.floats.getRightWidth(placeY);
    if (usedLeft + usedRight + totalWidth <= contentWidth) break;
    const nextY = state.floats.getNextClearance(placeY);
    if (nextY <= placeY) break;
    placeY = nextY;
  }
  return placeY;
}

function shrinkToFitWidth(
  children: readonly LayoutBlock['children'][number][],
  paddingRight: number,
  maxWidth: number,
): number {
  const maxRight = measureContentRight(children);
  return Math.min(maxRight + paddingRight, maxWidth);
}

function measureContentRight(children: readonly LayoutBlock['children'][number][]): number {
  let maxRight = 0;
  for (const child of children) {
    if (child.type === 'line-box') {
      for (const run of child.runs) {
        maxRight = Math.max(maxRight, child.bounds.x + run.bounds.x + run.bounds.width);
      }
    } else if (child.type === 'layout-block') {
      const nested = measureContentRight(child.children);
      maxRight = Math.max(maxRight, child.bounds.x + nested);
    } else if (child.type === 'image') {
      // Image centering offset (bounds.x) is cosmetic — use intrinsic width only
      maxRight = Math.max(maxRight, child.bounds.width);
    } else if ('bounds' in child) {
      maxRight = Math.max(maxRight, child.bounds.x + child.bounds.width);
    }
  }
  return maxRight;
}

function hasBlockChildren(node: StyledNode): boolean {
  return node.children.some((child) => {
    if (child.type === 'block') return child.style.display !== DISPLAY_VALUES.InlineBlock;
    if (child.type === 'image') return !hasMixedInlineContent(node.children);
    return false;
  });
}

function hasMixedInlineContent(children: readonly StyledNode[]): boolean {
  let hasInline = false;
  let hasImage = false;
  for (const child of children) {
    if (child.type === 'text' || child.type === 'inline') hasInline = true;
    if (child.type === 'image') hasImage = true;
  }
  return hasInline && hasImage;
}
