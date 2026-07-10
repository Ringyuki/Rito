import type { ComputedStyle, StyledNode } from '../../style/core/types';
import type { LayoutBlock, Rect } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { applySizeConstraints, layoutTextBlock } from './primitives';
import type { LayoutNodesAtFn } from './flow-layout';
import { createListContext } from './list';
import type { ImageSizeMap } from './types';

interface ContainingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Layout absolutely positioned children within a containing block.
 * Each child is positioned via top/left/bottom/right relative to the
 * containing box. Out-of-flow: does not affect normal flow state.
 */
export function layoutAbsoluteChildren(
  absoluteNodes: readonly StyledNode[],
  containingBox: ContainingBox,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes?: ImageSizeMap,
): readonly LayoutBlock[] {
  const result: LayoutBlock[] = [];
  for (const node of absoluteNodes) {
    const block = layoutAbsoluteNode(
      node,
      containingBox,
      contentHeight,
      layouter,
      layoutNodesAt,
      imageSizes,
    );
    if (block) result.push(block);
  }
  return result;
}

function layoutAbsoluteNode(
  node: StyledNode,
  cb: ContainingBox,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes?: ImageSizeMap,
): LayoutBlock | undefined {
  const layoutWidth = resolveAbsoluteWidth(node.style, cb.width);
  const raw = layoutContent(node, layoutWidth, contentHeight, layouter, layoutNodesAt, imageSizes);

  const blockHeight = node.style.height > 0 ? node.style.height : raw.bounds.height;
  const blockWidth = raw.bounds.width;
  const bounds = resolveAbsoluteBounds(node.style, cb, blockWidth, blockHeight);

  let block: LayoutBlock = { ...raw, bounds };
  if (node.tag) block = { ...block, semanticTag: node.tag };
  if (node.id) block = { ...block, anchorId: node.id };
  return block;
}

function resolveAbsoluteWidth(style: ComputedStyle, containingWidth: number): number {
  return applySizeConstraints(containingWidth, style);
}

function resolveAbsoluteBounds(
  style: ComputedStyle,
  cb: ContainingBox,
  blockWidth: number,
  blockHeight: number,
): Rect {
  let x = cb.x;
  if (style.left !== 0) x = cb.x + style.left;
  else if (style.right !== 0) x = cb.x + cb.width - blockWidth - style.right;

  let y = cb.y;
  if (style.top !== 0) y = cb.y + style.top;
  else if (style.bottom !== 0) y = cb.y + cb.height - blockHeight - style.bottom;

  return { x, y, width: blockWidth, height: blockHeight };
}

function layoutContent(
  node: StyledNode,
  layoutWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes?: ImageSizeMap,
): LayoutBlock {
  if (hasBlockChildren(node)) {
    return layoutAbsoluteContainer(
      node,
      layoutWidth,
      contentHeight,
      layouter,
      layoutNodesAt,
      imageSizes,
    );
  }
  return layoutTextBlock(node, Math.max(layoutWidth, 1), 0, layouter, imageSizes);
}

function layoutAbsoluteContainer(
  node: StyledNode,
  layoutWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes?: ImageSizeMap,
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
    childListCtx,
  );
  const last = childBlocks[childBlocks.length - 1];
  const height = last ? last.bounds.y + last.bounds.height + paddingBottom : 0;
  return {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: layoutWidth, height },
    children: childBlocks,
  };
}

function hasBlockChildren(node: StyledNode): boolean {
  return node.children.some((c) => c.type === 'block' && c.style.display !== 'inline-block');
}
