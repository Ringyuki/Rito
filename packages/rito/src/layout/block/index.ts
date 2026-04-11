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
    state.floats.clearExpired(state.y);
    if (node.style.clear !== 'none') {
      const clearY = state.floats.getClearY(node.style.clear);
      if (clearY > state.y) state.y = clearY;
    }

    if (node.type === 'text' && node.content === '\n') {
      // Bare <br> between blocks: treat as a zero-margin anonymous block with one line of height.
      // First settle the previous block's deferred bottom margin, then add the line gap.
      collapseMargin(state, 0);
      state.y += node.style.lineHeightPx ?? node.style.fontSize * node.style.lineHeight;
      state.prevMarginBottom = 0;
    } else if (node.type === 'image' && node.src) {
      layoutFloatableImage(state, node, contentWidth, contentHeight, imageSizes);
    } else if (node.type === 'block' && node.style.position === 'absolute') {
      // Skip: absolute children are positioned by their containing block
      // (layoutContainerBlock handles them when the parent is position:relative)
      continue;
    } else if (node.type === 'block') {
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

  return state.blocks;
}
