import type { StyledNode } from '../../style/core/types';
import { DISPLAY_VALUES } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { layoutTable } from '../table';
import { withPageBreaks } from './helpers';
import { layoutImageBlock } from './image';
import type { ListContext } from './list';
import { layoutHorizontalRule } from './primitives';
import { layoutContainerBlock, layoutLeafBlock, type LayoutNodesAtFn } from './flow-layout';
import { layoutFloatedBlock } from './float-layout';
import { resolveMarginBottom, resolveMarginTop } from './resolve-pct';
import { collapseMargin, type LayoutState } from './state';
import type { ImageSizeMap } from './types';

export function layoutFloatableImage(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  imageSizes?: ImageSizeMap,
): void {
  collapseMargin(state, resolveMarginTop(node.style, contentWidth));
  const src = node.src ?? '';
  const imgBlock = layoutImageBlock(
    src,
    contentWidth,
    contentHeight,
    state.y,
    imageSizes,
    node.style,
    node.alt,
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
      state.y,
      state.y + imgBlock.bounds.height,
    );
    state.prevMarginBottom = 0;
    return;
  }

  state.blocks.push(imgBlock);
  state.y += imgBlock.bounds.height;
  state.prevMarginBottom = resolveMarginBottom(node.style, contentWidth);
}

export function layoutBlockNode(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): void {
  if (node.tag === 'hr') {
    placeHr(state, node, contentWidth);
    return;
  }
  if (node.tag === 'table') {
    placeTable(state, node, contentWidth, layouter);
    return;
  }

  if (node.style.float !== 'none') {
    layoutFloatedBlock(
      state,
      node,
      contentWidth,
      contentHeight,
      layouter,
      layoutNodesAt,
      imageSizes,
      listCtx,
    );
    return;
  }

  if (hasBlockChildren(node)) {
    layoutContainerBlock(
      state,
      node,
      contentWidth,
      contentHeight,
      layouter,
      layoutNodesAt,
      imageSizes,
      listCtx,
    );
  } else {
    layoutLeafBlock(state, node, contentWidth, layouter, imageSizes, listCtx);
  }
}

function placeHr(state: LayoutState, node: StyledNode, contentWidth: number): void {
  collapseMargin(state, resolveMarginTop(node.style, contentWidth));
  state.blocks.push(layoutHorizontalRule(contentWidth, state.y, node.style.color));
  state.y += 1;
  state.prevMarginBottom = resolveMarginBottom(node.style, contentWidth);
}

function placeTable(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  layouter: ParagraphLayouter,
): void {
  collapseMargin(state, resolveMarginTop(node.style, contentWidth));
  let block: LayoutBlock = layoutTable(node, contentWidth, state.y, layouter);
  if (node.tag) block = { ...block, semanticTag: node.tag };
  if (node.id) block = { ...block, anchorId: node.id };
  state.blocks.push(withPageBreaks(block, node.style));
  state.y += block.bounds.height;
  state.prevMarginBottom = resolveMarginBottom(node.style, contentWidth);
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
    // Whitespace-only text nodes (indentation between tags) should not count as inline content.
    // Without this, <figure>\n  <image/>\n</figure> is misclassified as mixed inline.
    if (child.type === 'text' && child.content?.trim()) hasInline = true;
    else if (child.type === 'inline') hasInline = true;
    if (child.type === 'image') hasImage = true;
  }
  return hasInline && hasImage;
}
