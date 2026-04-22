import type { StyledNode } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { layoutAbsoluteChildren } from './absolute-layout';
import {
  resolveHorizontalBoxMetrics,
  resolveHorizontalOffset,
  type HorizontalBoxMetrics,
} from './box-metrics';
import { buildContainerWrapper, hasVisualDecorations } from './container-wrapper';
import { applyPageBreakFlags, withPageBreaks } from './helpers';
import { addListMarker, createListContext, type ListContext } from './list';
import { applyRelativeOffset, indentBlocks, layoutTextBlock } from './primitives';
import { collapseContainerMarginTop } from './container-margin';
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
  const plan = buildContainerLayoutPlan(
    state,
    node,
    contentWidth,
    contentHeight,
    layouter,
    layoutNodesAt,
    imageSizes,
    listCtx,
  );

  if (hasVisualDecorations(node)) {
    appendWrappedContainer(state, node, plan, contentWidth);
  } else {
    appendFlattenedContainer(state, node, plan, contentWidth);
  }
  state.prevMarginBottom = resolveMarginBottom(node.style, contentWidth);

  placeAbsoluteChildren(
    node,
    state,
    plan.collapsedStartY,
    plan.paddingLeft + resolveContainerXOffset(contentWidth, plan.metrics, node),
    plan.childWidth > 0 ? plan.childWidth : contentWidth,
    contentHeight,
    layouter,
    layoutNodesAt,
    imageSizes,
  );
}

interface ContainerLayoutPlan {
  readonly paddingTop: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly collapsedStartY: number;
  readonly containerTop: number;
  readonly metrics: HorizontalBoxMetrics;
  readonly childWidth: number;
  readonly childBlocks: readonly LayoutBlock[];
}

function buildContainerLayoutPlan(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  layoutNodesAt: LayoutNodesAtFn,
  imageSizes: ImageSizeMap | undefined,
  listCtx: ListContext | undefined,
): ContainerLayoutPlan {
  const childListCtx = createListContext(node);
  const paddingTop = resolvePaddingTop(node.style, contentWidth);
  const paddingRight = resolvePaddingRight(node.style, contentWidth);
  const paddingBottom = resolvePaddingBottom(node.style, contentWidth);
  const paddingLeft = resolvePaddingLeft(node.style, contentWidth);
  const collapsed = collapseContainerMarginTop(node, state, paddingTop, contentWidth);
  const containerTop = collapsed.startY - paddingTop;

  const metrics = resolveHorizontalBoxMetrics(contentWidth, node.style);
  const borderH = node.style.borderLeft.width + node.style.borderRight.width;
  const childWidth = metrics.targetWidth - paddingLeft - paddingRight - borderH;

  const childBlocks = layoutNodesAt(
    collapsed.children,
    childWidth > 0 ? childWidth : contentWidth,
    contentHeight,
    layouter,
    collapsed.startY,
    imageSizes,
    childListCtx ?? listCtx,
  );

  return {
    paddingTop,
    paddingBottom,
    paddingLeft,
    collapsedStartY: collapsed.startY,
    containerTop,
    metrics,
    childWidth,
    childBlocks,
  };
}

function appendWrappedContainer(
  state: LayoutState,
  node: StyledNode,
  plan: ContainerLayoutPlan,
  contentWidth: number,
): void {
  const localized = localizeWrapperChildren(node, plan);
  const wrapper = buildContainerWrapper(
    node,
    localized,
    plan.metrics,
    contentWidth,
    plan.containerTop,
    plan.paddingTop,
    plan.paddingBottom,
  );
  state.blocks.push(withPageBreaks(wrapper, node.style));
  state.y = wrapper.bounds.y + wrapper.bounds.height;
}

function localizeWrapperChildren(
  node: StyledNode,
  plan: ContainerLayoutPlan,
): readonly LayoutBlock[] {
  const borderTop = node.style.borderTop.width;
  const borderLeft = node.style.borderLeft.width;
  return plan.childBlocks.map((block) => ({
    ...block,
    bounds: {
      ...block.bounds,
      x: block.bounds.x + borderLeft + plan.paddingLeft,
      y: block.bounds.y - plan.containerTop + borderTop,
    },
  }));
}

function appendFlattenedContainer(
  state: LayoutState,
  node: StyledNode,
  plan: ContainerLayoutPlan,
  contentWidth: number,
): void {
  const totalIndent = plan.paddingLeft + resolveContainerXOffset(contentWidth, plan.metrics, node);
  const indented = totalIndent > 0 ? indentBlocks(plan.childBlocks, totalIndent) : plan.childBlocks;
  applyPageBreakFlags(indented, node.style);
  attachContainerAnchor(node, indented);
  for (const child of indented) state.blocks.push(child);
  updateFlattenedStateY(state, indented, plan.paddingBottom);
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

function isAbsolute(child: StyledNode): boolean {
  return child.type === 'block' && child.style.position === 'absolute';
}

function resolveContainerXOffset(
  contentWidth: number,
  metrics: HorizontalBoxMetrics,
  node: StyledNode,
): number {
  return resolveHorizontalOffset(
    contentWidth,
    metrics.targetWidth,
    node.style,
    metrics.marginLeft,
    metrics.marginRight,
  );
}

function attachContainerAnchor(node: StyledNode, blocks: readonly LayoutBlock[]): void {
  if (!node.id || blocks.length === 0) return;
  const first = blocks[0];
  if (first) Object.assign(first, { anchorId: node.id });
}

function updateFlattenedStateY(
  state: LayoutState,
  blocks: readonly LayoutBlock[],
  paddingBottom: number,
): void {
  const last = blocks[blocks.length - 1];
  if (last) state.y = last.bounds.y + last.bounds.height + paddingBottom;
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
  // CSS line boxes avoid float margin boxes. When a positive margin and a
  // float reserve space on the same side, they don't stack — use the larger.
  // Negative margins expand the block beyond the container and must not be
  // clamped against float reservations (extraLeft/Right stay 0 when no float).
  const leftFloat = state.floats.getLeftWidth(state.y);
  const rightFloat = state.floats.getRightWidth(state.y);
  const extraLeft = leftFloat > 0 ? Math.max(0, leftFloat - metrics.marginLeft) : 0;
  const extraRight = rightFloat > 0 ? Math.max(0, rightFloat - metrics.marginRight) : 0;
  const width = Math.max(metrics.targetWidth - extraLeft - extraRight, 1);

  let block = layoutTextBlock(node, width, state.y, layouter, imageSizes);
  block = addListMarker(block, node, listCtx);

  const xOffset = resolveHorizontalOffset(
    contentWidth,
    block.bounds.width,
    node.style,
    metrics.marginLeft,
    metrics.marginRight,
    extraLeft,
  );

  if (xOffset !== 0) {
    block = { ...block, bounds: { ...block.bounds, x: block.bounds.x + xOffset } };
  }
  if (node.id) block = { ...block, anchorId: node.id };
  block = applyRelativeOffset(block, node.style);
  state.blocks.push(withPageBreaks(block, node.style));
  state.y += block.bounds.height;
  state.prevMarginBottom = resolveMarginBottom(node.style, contentWidth);
}
