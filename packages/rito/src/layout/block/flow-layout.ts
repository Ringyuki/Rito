import { DISPLAY_VALUES, type StyledNode } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { layoutAbsoluteChildren } from './absolute-layout';
import {
  resolveHorizontalBoxMetrics,
  resolveHorizontalOffset,
  type HorizontalBoxMetrics,
} from './box-metrics';
import { applyPageBreakFlags, extractBorders, withPageBreaks } from './helpers';
import { addListMarker, createListContext, type ListContext } from './list';
import { applyRelativeOffset, indentBlocks, layoutTextBlock } from './primitives';
import {
  resolveMarginBottom,
  resolveMarginTop,
  resolvePaddingBottom,
  resolvePaddingLeft,
  resolvePaddingRight,
  resolvePaddingTop,
} from './resolve-pct';
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
  const paddingTop = resolvePaddingTop(node.style, contentWidth);
  const paddingRight = resolvePaddingRight(node.style, contentWidth);
  const paddingBottom = resolvePaddingBottom(node.style, contentWidth);
  const paddingLeft = resolvePaddingLeft(node.style, contentWidth);
  const collapsed = collapseContainerMarginTop(node, state, paddingTop, contentWidth);
  // Capture the container's top edge (after margin collapse, before padding)
  const containerTop = collapsed.startY - paddingTop;

  // Apply the container's own width/maxWidth constraint before subtracting padding
  const metrics = resolveHorizontalBoxMetrics(contentWidth, node.style);
  const childWidth = metrics.targetWidth - paddingLeft - paddingRight;

  const childBlocks = layoutNodesAt(
    collapsed.children,
    childWidth > 0 ? childWidth : contentWidth,
    contentHeight,
    layouter,
    collapsed.startY,
    imageSizes,
    childListCtx ?? listCtx,
  );

  if (hasVisualDecorations(node)) {
    // Wrapper mode: children are laid out with absolute y coordinates starting at startY.
    // Convert to wrapper-relative coordinates: y relative to containerTop (includes paddingTop).
    const localized = childBlocks.map((b) => ({
      ...b,
      bounds: { ...b.bounds, x: b.bounds.x + paddingLeft, y: b.bounds.y - containerTop },
    }));
    const wrapper = buildContainerWrapper(
      node,
      localized,
      metrics,
      contentWidth,
      containerTop,
      paddingBottom,
    );
    state.blocks.push(withPageBreaks(wrapper, node.style));
    state.y = wrapper.bounds.y + wrapper.bounds.height;
  } else {
    // Flatten mode: indent children by padding + margin offset
    const xOffset = resolveHorizontalOffset(
      contentWidth,
      metrics.targetWidth,
      node.style,
      metrics.marginLeft,
      metrics.marginRight,
    );
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
  }
  state.prevMarginBottom = resolveMarginBottom(node.style, contentWidth);

  const wrapperX = resolveHorizontalOffset(
    contentWidth,
    metrics.targetWidth,
    node.style,
    metrics.marginLeft,
    metrics.marginRight,
  );
  const xIndent = paddingLeft + wrapperX;
  placeAbsoluteChildren(
    node,
    state,
    collapsed.startY,
    xIndent,
    childWidth > 0 ? childWidth : contentWidth,
    contentHeight,
    layouter,
    layoutNodesAt,
    imageSizes,
  );
}

/** Check if a container node has visual decorations that need a wrapper block. */
function hasVisualDecorations(node: StyledNode): boolean {
  const s = node.style;
  return !!(
    s.backgroundColor ||
    s.borderTop.width > 0 ||
    s.borderRight.width > 0 ||
    s.borderBottom.width > 0 ||
    s.borderLeft.width > 0 ||
    s.borderRadius > 0 ||
    s.opacity < 1 ||
    s.overflow === 'hidden' ||
    s.boxShadow.length > 0
  );
}

/** Build a wrapper LayoutBlock for a container with visual decorations. */
function buildContainerWrapper(
  node: StyledNode,
  children: readonly LayoutBlock[],
  metrics: HorizontalBoxMetrics,
  containerWidth: number,
  startY: number,
  paddingBottom: number,
): LayoutBlock {
  // Children are already in wrapper-local coordinates (y starts at 0).
  const lastChild = children[children.length - 1];
  let height = lastChild
    ? lastChild.bounds.y + lastChild.bounds.height + paddingBottom
    : paddingBottom;
  // Apply explicit CSS height if set (e.g. height: 12em)
  if (node.style.height > 0) height = Math.max(height, node.style.height);
  if (node.style.minHeight !== undefined && node.style.minHeight > 0) {
    height = Math.max(height, node.style.minHeight);
  }

  const x = resolveHorizontalOffset(
    containerWidth,
    metrics.targetWidth,
    node.style,
    metrics.marginLeft,
    metrics.marginRight,
  );
  let wrapper: LayoutBlock = {
    type: 'layout-block',
    bounds: { x, y: startY, width: metrics.targetWidth, height },
    children,
  };

  if (node.tag) wrapper = { ...wrapper, semanticTag: node.tag };
  if (node.id) wrapper = { ...wrapper, anchorId: node.id };
  if (node.style.backgroundColor) {
    wrapper = { ...wrapper, backgroundColor: node.style.backgroundColor };
  }
  const borders = extractBorders(node.style);
  if (borders) wrapper = { ...wrapper, borders };
  if (node.style.borderRadius > 0) {
    wrapper = { ...wrapper, borderRadius: node.style.borderRadius };
  }
  if (node.style.opacity < 1) wrapper = { ...wrapper, opacity: node.style.opacity };
  if (node.style.overflow === 'hidden') wrapper = { ...wrapper, overflow: 'hidden' };
  if (node.style.boxShadow.length > 0) {
    wrapper = { ...wrapper, boxShadow: node.style.boxShadow };
  }
  return wrapper;
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
  containerWidth: number,
): { startY: number; children: readonly StyledNode[] } {
  const hasTopSeparator = paddingTop > 0 || node.style.borderTop.width > 0;
  if (hasTopSeparator) {
    collapseMargin(state, resolveMarginTop(node.style, containerWidth));
    return { startY: state.y + paddingTop, children: node.children };
  }
  const margins = [resolveMarginTop(node.style, containerWidth)];
  const children = collectAndZeroMarginChain(node.children, margins, containerWidth);
  collapseMargin(state, collapseMarginChain(margins));
  return { startY: state.y, children };
}

function isFirstInFlow(c: StyledNode): boolean {
  return (
    c.type === 'block' &&
    c.style.float === 'none' &&
    c.style.position !== 'absolute' &&
    c.style.display !== DISPLAY_VALUES.InlineBlock
  );
}

function isAbsolute(c: StyledNode): boolean {
  return c.type === 'block' && c.style.position === 'absolute';
}

/** Layout absolutely positioned children after in-flow layout is complete. */
function placeAbsoluteChildren(
  node: StyledNode,
  state: LayoutState,
  startY: number,
  xOffset: number,
  childWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes?: ImageSizeMap,
): void {
  const absoluteNodes = node.children.filter(isAbsolute);
  if (absoluteNodes.length === 0) return;
  const containingBox = {
    x: xOffset,
    y: startY,
    width: childWidth,
    height: state.y - startY,
  };
  const absBlocks = layoutAbsoluteChildren(
    absoluteNodes,
    containingBox,
    contentHeight,
    layouter,
    layoutNodesAt,
    imageSizes,
  );
  for (const ab of absBlocks) state.blocks.push(ab);
}

/**
 * Walk the first in-flow child chain, collecting each margin-top and zeroing
 * it out. Stops when a child has top border or padding (separator).
 */
function collectAndZeroMarginChain(
  children: readonly StyledNode[],
  margins: number[],
  containerWidth: number,
): readonly StyledNode[] {
  const idx = children.findIndex(isFirstInFlow);
  if (idx < 0) return children;
  const child = children[idx];
  if (!child) return children;
  margins.push(resolveMarginTop(child.style, containerWidth));
  const { marginTopPct: _, ...styleWithoutPct } = child.style;
  let modified: StyledNode = {
    ...child,
    style: { ...styleWithoutPct, marginTop: 0 },
  };
  if (child.style.paddingTop <= 0 && child.style.borderTop.width <= 0) {
    const nested = collectAndZeroMarginChain(modified.children, margins, containerWidth);
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
  collapseMargin(state, resolveMarginTop(node.style, contentWidth));

  const metrics = resolveHorizontalBoxMetrics(contentWidth, node.style);
  const floatIndent = state.floats.getLeftWidth(state.y) + state.floats.getRightWidth(state.y);
  const width = Math.max(metrics.targetWidth - floatIndent, 1);

  let block = layoutTextBlock(node, width, state.y, layouter, imageSizes);
  block = addListMarker(block, node, listCtx);

  const xOffset = resolveHorizontalOffset(
    contentWidth,
    block.bounds.width,
    node.style,
    metrics.marginLeft,
    metrics.marginRight,
    state.floats.getLeftWidth(state.y),
  );

  if (xOffset > 0) {
    block = { ...block, bounds: { ...block.bounds, x: block.bounds.x + xOffset } };
  }
  if (node.id) block = { ...block, anchorId: node.id };
  block = applyRelativeOffset(block, node.style);
  state.blocks.push(withPageBreaks(block, node.style));
  state.y += block.bounds.height;
  state.prevMarginBottom = resolveMarginBottom(node.style, contentWidth);
}
