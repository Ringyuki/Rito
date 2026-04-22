import type { StyledNode } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import type { ListContext } from './list';
import { FloatContext } from './float-context';
import { layoutBlockNode, layoutFloatableImage } from './dispatch';
import { collapseMargin, type LayoutState } from './state';
import type { ImageSizeMap } from './types';

export type { ImageSizeMap } from './types';

export function layoutBlocks(
  nodes: readonly StyledNode[],
  contentWidth: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
  contentHeight = Infinity,
): readonly LayoutBlock[] {
  return layoutNodesAt(nodes, contentWidth, contentHeight, layouter, 0, imageSizes);
}

export function layoutNodesAt(
  nodes: readonly StyledNode[],
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  startY: number,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): readonly LayoutBlock[] {
  const state: LayoutState = {
    blocks: [],
    floats: new FloatContext(),
    y: startY,
    prevMarginBottom: 0,
  };

  for (const node of nodes) {
    applyClearance(state, node);
    layoutTopLevelNode(state, node, contentWidth, contentHeight, layouter, imageSizes, listCtx);
  }

  return state.blocks;
}

function applyClearance(state: LayoutState, node: StyledNode): void {
  // clearExpired is intentionally scoped to explicit CSS clear. Negative
  // margins can otherwise pull later blocks back into an active float range.
  if (node.style.clear === 'none') return;
  const clearY = state.floats.getClearY(node.style.clear);
  if (clearY > state.y) state.y = clearY;
  state.floats.clearExpired(state.y);
}

function layoutTopLevelNode(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  imageSizes: ImageSizeMap | undefined,
  listCtx: ListContext | undefined,
): void {
  if (node.type === 'text' && node.content === '\n') {
    layoutBareLineBreak(state, node);
  } else if (node.type === 'image' && node.src) {
    layoutFloatableImage(state, node, contentWidth, contentHeight, imageSizes);
  } else if (node.type === 'block' && node.style.position !== 'absolute') {
    layoutBlockNode(
      state,
      node,
      contentWidth,
      contentHeight,
      layouter,
      layoutNodesAt,
      imageSizes,
      listCtx,
    );
  }
}

function layoutBareLineBreak(state: LayoutState, node: StyledNode): void {
  collapseMargin(state, 0);
  state.y += node.style.lineHeightPx ?? node.style.fontSize * node.style.lineHeight;
  state.prevMarginBottom = 0;
}
