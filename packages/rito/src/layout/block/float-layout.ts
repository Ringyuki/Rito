import type { StyledNode } from '../../style/core/types';
import { DISPLAY_VALUES } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { normalizeChildPositions, shrinkToFitWidth } from './float-intrinsic';
import { resolveTrailingFloatMarginBottom } from './float-margin';
import { addListMarker, createListContext, type ListContext } from './list';
import { blockPaintFromStyle, borderBoxFromStyle } from './paint-from-style';
import {
  applyRelativeOffset,
  applySizeConstraints,
  indentBlocks,
  layoutTextBlock,
} from './primitives';
import type { FloatContext } from './float-context';
import type { LayoutNodesAtFn } from './flow-layout';
import {
  resolveMarginBottom,
  resolveMarginLeft,
  resolveMarginRight,
  resolveMarginTop,
  resolvePaddingBottom,
  resolvePaddingLeft,
  resolvePaddingRight,
  resolvePaddingTop,
} from './resolve-pct';
import type { LayoutState } from './state';
import type { ImageSizeMap } from './types';

interface FloatSizing {
  readonly marginTop: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly side: 'left' | 'right';
  readonly layoutWidth: number;
}

interface FloatContainerInsets {
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly borderTop: number;
  readonly borderRight: number;
  readonly borderBottom: number;
  readonly borderLeft: number;
  readonly childWidth: number;
  readonly childStartY: number;
}

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
  const sizing = resolveFloatSizing(node, contentWidth);
  const block = hasBlockChildren(node)
    ? layoutFloatedContainer(
        node,
        sizing.layoutWidth,
        contentHeight,
        layouter,
        layoutNodesAt,
        imageSizes,
        listCtx,
      )
    : layoutFloatedLeaf(node, sizing.layoutWidth, layouter, imageSizes, listCtx);

  placeFloatedBlock(state, decorateFloatBlock(block, node), sizing, contentWidth);
}

function resolveFloatSizing(node: StyledNode, contentWidth: number): FloatSizing {
  const marginLeft = resolveMarginLeft(node.style, contentWidth);
  const marginRight = resolveMarginRight(node.style, contentWidth);
  const availableWidth = contentWidth - marginLeft - marginRight;
  return {
    marginTop: resolveMarginTop(node.style, contentWidth),
    marginLeft,
    marginRight,
    marginBottom: resolveMarginBottom(node.style, contentWidth),
    side: node.style.float as 'left' | 'right',
    layoutWidth: applySizeConstraints(availableWidth, node.style),
  };
}

function decorateFloatBlock(block: LayoutBlock, node: StyledNode): LayoutBlock {
  let result = block;
  if (node.tag) result = { ...result, semanticTag: node.tag };
  if (node.id) result = { ...result, anchorId: node.id };
  return result;
}

function placeFloatedBlock(
  state: LayoutState,
  block: LayoutBlock,
  sizing: FloatSizing,
  contentWidth: number,
): void {
  const marginBoxStartY = state.y + state.prevMarginBottom;
  const marginBoxWidth = block.bounds.width + sizing.marginLeft + sizing.marginRight;
  const marginBoxHeight = Math.max(0, sizing.marginTop + block.bounds.height + sizing.marginBottom);
  const placeMarginBoxY = findFloatPlaceY(
    marginBoxStartY,
    state.floats,
    marginBoxWidth,
    contentWidth,
    marginBoxHeight,
  );
  const placeY = placeMarginBoxY + sizing.marginTop;
  const marginBoxBottomY = placeMarginBoxY + marginBoxHeight;
  const floatX =
    sizing.side === 'right'
      ? contentWidth -
        block.bounds.width -
        sizing.marginRight -
        state.floats.getMaxRightWidthInRange(placeMarginBoxY, marginBoxBottomY)
      : sizing.marginLeft + state.floats.getMaxLeftWidthInRange(placeMarginBoxY, marginBoxBottomY);

  const placed = { ...block, bounds: { ...block.bounds, x: floatX, y: placeY } };
  state.blocks.push(placed);
  state.floats.addFloat(sizing.side, marginBoxWidth, placeMarginBoxY, marginBoxBottomY);
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
  const insets = resolveFloatContainerInsets(node, layoutWidth);
  const childBlocks = layoutNodesAt(
    node.children,
    insets.childWidth > 0 ? insets.childWidth : layoutWidth,
    contentHeight,
    layouter,
    insets.childStartY,
    imageSizes,
    childListCtx ?? listCtx,
  );
  const childIndent = insets.borderLeft + insets.paddingLeft;
  const indented = childIndent > 0 ? indentBlocks(childBlocks, childIndent) : childBlocks;
  const height = resolveFloatedContainerHeight(node, indented, insets, layoutWidth);
  const hasExplicitWidth = node.style.width > 0 || node.style.widthPct !== undefined;
  const actualWidth = hasExplicitWidth
    ? layoutWidth
    : shrinkToFitWidth(indented, insets.paddingRight, layoutWidth);
  const finalChildren =
    !hasExplicitWidth && actualWidth < layoutWidth ? normalizeChildPositions(indented) : indented;
  return decorateFloatedContainer(node, {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: actualWidth, height },
    children: finalChildren,
  });
}

function resolveFloatContainerInsets(node: StyledNode, layoutWidth: number): FloatContainerInsets {
  const paddingTop = resolvePaddingTop(node.style, layoutWidth);
  const paddingRight = resolvePaddingRight(node.style, layoutWidth);
  const paddingBottom = resolvePaddingBottom(node.style, layoutWidth);
  const paddingLeft = resolvePaddingLeft(node.style, layoutWidth);
  const borderTop = node.style.borderTop.width;
  const borderRight = node.style.borderRight.width;
  const borderLeft = node.style.borderLeft.width;
  return {
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    borderTop,
    borderRight,
    borderBottom: node.style.borderBottom.width,
    borderLeft,
    childWidth: layoutWidth - paddingLeft - paddingRight - borderLeft - borderRight,
    childStartY: borderTop + paddingTop,
  };
}

function resolveFloatedContainerHeight(
  node: StyledNode,
  children: readonly LayoutBlock[],
  insets: FloatContainerInsets,
  layoutWidth: number,
): number {
  const last = children[children.length - 1];
  const trailingMarginBottom =
    insets.paddingBottom > 0 || insets.borderBottom > 0
      ? 0
      : resolveTrailingFloatMarginBottom(node.children, layoutWidth);
  let height = last
    ? last.bounds.y +
      last.bounds.height +
      trailingMarginBottom +
      insets.paddingBottom +
      insets.borderBottom
    : 0;
  if (node.style.height > 0) {
    const borderV = insets.borderTop + insets.borderBottom;
    height =
      node.style.boxSizing === 'border-box'
        ? node.style.height
        : node.style.height + insets.paddingTop + insets.paddingBottom + borderV;
  }
  if (node.style.minHeight !== undefined && node.style.minHeight > 0) {
    height = Math.max(height, node.style.minHeight);
  }
  return height;
}

function decorateFloatedContainer(node: StyledNode, block: LayoutBlock): LayoutBlock {
  let result = block;
  const borderBox = borderBoxFromStyle(node.style);
  if (borderBox) result = { ...result, borderBox };
  const paint = blockPaintFromStyle(node.style);
  if (paint) result = { ...result, paint };
  return result;
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
  if (node.style.width <= 0 && node.style.widthPct === undefined) {
    const fitWidth = shrinkToFitWidth(raw.children, node.style.paddingRight, layoutWidth);
    const finalChildren =
      fitWidth < layoutWidth ? normalizeChildPositions(raw.children) : raw.children;
    raw = { ...raw, bounds: { ...raw.bounds, width: fitWidth }, children: finalChildren };
  }
  return raw;
}

/**
 * Search downward from startY for a Y where the float margin box fits alongside
 * active float margin boxes across its entire range [placeY, placeY + height).
 * Read-only queries only — does not mutate FloatContext.
 */
function findFloatPlaceY(
  startY: number,
  floats: FloatContext,
  totalWidth: number,
  contentWidth: number,
  height: number,
): number {
  let placeY = startY;
  for (;;) {
    const bottomY = placeY + height;
    const usedLeft = floats.getMaxLeftWidthInRange(placeY, bottomY);
    const usedRight = floats.getMaxRightWidthInRange(placeY, bottomY);
    if (usedLeft + usedRight + totalWidth <= contentWidth) break;
    const nextY = floats.getNextClearance(placeY);
    if (nextY <= placeY) break;
    placeY = nextY;
  }
  return placeY;
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
