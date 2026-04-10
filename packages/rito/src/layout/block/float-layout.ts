import type { StyledNode } from '../../style/core/types';
import { DISPLAY_VALUES } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { extractBorders } from './helpers';
import { addListMarker, createListContext, type ListContext } from './list';
import {
  applyRelativeOffset,
  applySizeConstraints,
  indentBlocks,
  layoutTextBlock,
} from './primitives';
import type { FloatContext } from './float-context';
import type { LayoutNodesAtFn } from './flow-layout';
import { resolveMarginLeft, resolveMarginRight, resolveMarginTop } from './resolve-pct';
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
  // Floats are out of normal flow — don't modify state.y or consume prevMarginBottom.
  // CSS §9.5.1: a float cannot appear above any earlier float.
  const mt = resolveMarginTop(node.style, contentWidth);
  const floatStartY = Math.max(state.y + mt, state.floats.getMaxStartY());
  const ml = resolveMarginLeft(node.style, contentWidth);
  const mr = resolveMarginRight(node.style, contentWidth);
  const side = node.style.float as 'left' | 'right';
  const availWidth = contentWidth - ml - mr;
  const layoutWidth = applySizeConstraints(availWidth, node.style);

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
  const placeY = findFloatPlaceY(floatStartY, state.floats, totalWidth, contentWidth);

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
  const hasExplicitWidth = node.style.width > 0 || node.style.widthPct !== undefined;
  const actualWidth = hasExplicitWidth
    ? layoutWidth
    : shrinkToFitWidth(indented, paddingRight, layoutWidth);
  // After shrink-to-fit, text-align offsets and image centering are based on the
  // original (larger) layout width and would be stale. Normalize to left-align.
  const finalChildren =
    !hasExplicitWidth && actualWidth < layoutWidth ? normalizeChildPositions(indented) : indented;
  let block: LayoutBlock = {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: actualWidth, height },
    children: finalChildren,
  };
  if (node.style.backgroundColor) block = { ...block, backgroundColor: node.style.backgroundColor };
  const borders = extractBorders(node.style);
  if (borders) block = { ...block, borders };
  if (node.style.borderRadius > 0) block = { ...block, borderRadius: node.style.borderRadius };
  if (node.style.opacity < 1) block = { ...block, opacity: node.style.opacity };
  if (node.style.overflow === 'hidden') block = { ...block, overflow: 'hidden' };
  return block;
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
 * Search downward from startY for a Y where the float fits alongside active floats.
 * Read-only queries only — does not mutate FloatContext.
 */
function findFloatPlaceY(
  startY: number,
  floats: FloatContext,
  totalWidth: number,
  contentWidth: number,
): number {
  let placeY = startY;
  for (;;) {
    const usedLeft = floats.getLeftWidth(placeY);
    const usedRight = floats.getRightWidth(placeY);
    if (usedLeft + usedRight + totalWidth <= contentWidth) break;
    const nextY = floats.getNextClearance(placeY);
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
      // Measure content span (maxRight – minLeft) to exclude text-align offsets.
      // Text-align shifts all runs by the same offset; the span gives intrinsic width.
      let minLeft = Infinity;
      let lineMaxRight = 0;
      for (const run of child.runs) {
        if (run.bounds.x < minLeft) minLeft = run.bounds.x;
        const right = run.bounds.x + run.bounds.width;
        if (right > lineMaxRight) lineMaxRight = right;
      }
      if (minLeft !== Infinity) {
        maxRight = Math.max(maxRight, lineMaxRight - minLeft);
      }
    } else if (child.type === 'layout-block') {
      const nested = measureContentRight(child.children);
      maxRight = Math.max(maxRight, child.bounds.x + nested);
    } else if (child.type === 'image') {
      maxRight = Math.max(maxRight, child.bounds.width);
    } else if ('bounds' in child) {
      maxRight = Math.max(maxRight, child.bounds.x + child.bounds.width);
    }
  }
  return maxRight;
}

/**
 * After shrink-to-fit, text-align offsets in line runs and image centering
 * offsets are based on the original (larger) layout width. Strip them so
 * content starts from x=0 within the shrunken container.
 */
function normalizeChildPositions(
  children: readonly LayoutBlock['children'][number][],
): readonly LayoutBlock['children'][number][] {
  return children.map((child) => {
    if (child.type === 'line-box') {
      let minX = Infinity;
      for (const run of child.runs) {
        if (run.bounds.x < minX) minX = run.bounds.x;
      }
      if (minX > 0 && minX !== Infinity) {
        return {
          ...child,
          runs: child.runs.map((r) => ({
            ...r,
            bounds: { ...r.bounds, x: r.bounds.x - minX },
          })),
        };
      }
      return child;
    }
    if (child.type === 'layout-block') {
      return { ...child, children: normalizeChildPositions(child.children) };
    }
    if (child.type === 'image' && child.bounds.x > 0) {
      return { ...child, bounds: { ...child.bounds, x: 0 } };
    }
    return child;
  });
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
