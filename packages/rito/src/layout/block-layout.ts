import type { StyledNode } from '../style/types';
import type { LayoutBlock } from './types';
import { applyPageBreakFlags, withPageBreaks } from './block-helpers';
import type { ParagraphLayouter } from './paragraph-layouter';
import { layoutImageBlock } from './image-layout';
import { layoutTable } from './table-layout';
import { type ListContext, addListMarker, createListContext } from './list-layout';
import { FloatContext } from './float-context';
import {
  applyRelativeOffset,
  applySizeConstraints,
  indentBlocks,
  layoutHorizontalRule,
  layoutTextBlock,
} from './block-layout-primitives';

/** Intrinsic image dimensions for correct aspect ratio. */
export interface ImageSizeMap {
  getSize(src: string): { width: number; height: number } | undefined;
}

export function layoutBlocks(
  nodes: readonly StyledNode[],
  contentWidth: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
  contentHeight = Infinity,
): readonly LayoutBlock[] {
  return layoutNodesAt(nodes, contentWidth, contentHeight, layouter, 0, imageSizes);
}

interface LayoutState {
  blocks: LayoutBlock[];
  floats: FloatContext;
  y: number;
  prevMarginBottom: number;
}

function layoutNodesAt(
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
    if (node.type === 'image' && node.src) {
      layoutFloatableImage(state, node, contentWidth, contentHeight, imageSizes);
    } else if (node.type === 'block') {
      layoutBlockNode(state, node, contentWidth, contentHeight, layouter, imageSizes, listCtx);
    }
  }

  return state.blocks;
}

function collapseMargin(state: LayoutState, marginTop: number): void {
  state.y += Math.max(state.prevMarginBottom, marginTop);
}

function layoutFloatableImage(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  imageSizes?: ImageSizeMap,
): void {
  collapseMargin(state, node.style.marginTop);
  const src = node.src ?? '';
  const imgBlock = layoutImageBlock(
    src,
    contentWidth,
    contentHeight,
    state.y,
    imageSizes,
    node.style,
  );

  if (node.style.float === 'left' || node.style.float === 'right') {
    const floatedBlock =
      node.style.float === 'right'
        ? { ...imgBlock, bounds: { ...imgBlock.bounds, x: contentWidth - imgBlock.bounds.width } }
        : imgBlock;
    state.blocks.push(floatedBlock);
    state.floats.addFloat(
      node.style.float,
      imgBlock.bounds.width,
      state.y + imgBlock.bounds.height,
    );
    state.prevMarginBottom = 0;
  } else {
    state.blocks.push(imgBlock);
    state.y += imgBlock.bounds.height;
    state.prevMarginBottom = node.style.marginBottom;
  }
}

function layoutBlockNode(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): void {
  if (node.tag === 'hr') {
    collapseMargin(state, node.style.marginTop);
    state.blocks.push(layoutHorizontalRule(contentWidth, state.y, node.style.color));
    state.y += 1;
    state.prevMarginBottom = node.style.marginBottom;
    return;
  }
  if (node.tag === 'table') {
    collapseMargin(state, node.style.marginTop);
    let block = layoutTable(node, contentWidth, state.y, layouter);
    if (node.id) block = { ...block, anchorId: node.id };
    state.blocks.push(withPageBreaks(block, node.style));
    state.y += block.bounds.height;
    state.prevMarginBottom = node.style.marginBottom;
    return;
  }

  const hasBlockChildren = node.children.some((c) => c.type === 'block' || c.type === 'image');
  if (hasBlockChildren) {
    layoutContainerBlock(state, node, contentWidth, contentHeight, layouter, imageSizes, listCtx);
  } else {
    layoutLeafBlock(state, node, contentWidth, layouter, listCtx);
  }
}

function layoutContainerBlock(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): void {
  collapseMargin(state, node.style.marginTop);
  const childListCtx = createListContext(node);
  const indent = node.style.paddingLeft;
  const childWidth = indent > 0 ? contentWidth - indent : contentWidth;

  const childBlocks = layoutNodesAt(
    node.children,
    childWidth,
    contentHeight,
    layouter,
    state.y,
    imageSizes,
    childListCtx ?? listCtx,
  );

  const indented = indent > 0 ? indentBlocks(childBlocks, indent) : childBlocks;
  applyPageBreakFlags(indented, node.style);
  if (node.id && indented.length > 0) {
    const first = indented[0];
    if (first) Object.assign(first, { anchorId: node.id });
  }

  for (const child of indented) state.blocks.push(child);
  if (indented.length > 0) {
    const last = indented[indented.length - 1];
    if (last) state.y = last.bounds.y + last.bounds.height;
  }
  state.prevMarginBottom = node.style.marginBottom;
}

function layoutLeafBlock(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  layouter: ParagraphLayouter,
  listCtx?: ListContext,
): void {
  collapseMargin(state, node.style.marginTop);

  const ml = node.style.marginLeft;
  const mr = node.style.marginRight;
  const mlAuto = node.style.marginLeftAuto;
  const mrAuto = node.style.marginRightAuto;

  let w = ml + mr > 0 ? contentWidth - ml - mr : contentWidth;
  w = applySizeConstraints(w, node.style);
  w -= state.floats.getLeftWidth(state.y) + state.floats.getRightWidth(state.y);

  let block = layoutTextBlock(node, Math.max(w, 1), state.y, layouter);
  block = addListMarker(block, node, listCtx);

  // Resolve margin:auto centering
  let xOffset = ml + state.floats.getLeftWidth(state.y);
  if ((mlAuto || mrAuto) && block.bounds.width < contentWidth) {
    const remaining = contentWidth - block.bounds.width;
    if (mlAuto && mrAuto) {
      xOffset = remaining / 2;
    } else if (mlAuto) {
      xOffset = remaining - mr;
    }
    // If only mrAuto, xOffset stays as ml (no change needed)
  }

  if (xOffset > 0) block = { ...block, bounds: { ...block.bounds, x: block.bounds.x + xOffset } };
  if (node.id) block = { ...block, anchorId: node.id };
  block = applyRelativeOffset(block, node.style);
  state.blocks.push(withPageBreaks(block, node.style));
  state.y += block.bounds.height;
  state.prevMarginBottom = node.style.marginBottom;
}
