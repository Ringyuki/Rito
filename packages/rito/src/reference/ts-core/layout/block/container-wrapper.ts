import { DISPLAY_VALUES, type StyledNode } from '../../style/core/types';
import type { LayoutBlock } from '../core/types';
import { resolveHorizontalOffset, type HorizontalBoxMetrics } from './box-metrics';
import { blockPaintFromStyle, borderBoxFromStyle } from './paint-from-style';

/** Check if a container node has visual decorations that need a wrapper block. */
export function hasVisualDecorations(node: StyledNode): boolean {
  const style = node.style;
  return !!(
    style.backgroundColor ||
    style.borderTop.width > 0 ||
    style.borderRight.width > 0 ||
    style.borderBottom.width > 0 ||
    style.borderLeft.width > 0 ||
    style.borderRadius > 0 ||
    style.borderRadiusPct !== undefined ||
    style.opacity < 1 ||
    style.overflow === 'hidden' ||
    style.boxShadow.length > 0 ||
    style.transform.length > 0 ||
    style.backgroundImage
  );
}

/** Build a wrapper LayoutBlock for a container with visual decorations. */
export function buildContainerWrapper(
  node: StyledNode,
  children: readonly LayoutBlock[],
  metrics: HorizontalBoxMetrics,
  containerWidth: number,
  startY: number,
  paddingTop: number,
  paddingBottom: number,
): LayoutBlock {
  let wrapper: LayoutBlock = {
    type: 'layout-block',
    bounds: {
      x: resolveWrapperX(node, metrics, containerWidth),
      y: startY,
      width: metrics.targetWidth,
      height: resolveWrapperHeight(node, children, paddingTop, paddingBottom),
    },
    children,
  };
  if (node.tag) wrapper = { ...wrapper, semanticTag: node.tag };
  if (node.id) wrapper = { ...wrapper, anchorId: node.id };
  const borderBox = borderBoxFromStyle(node.style);
  if (borderBox) wrapper = { ...wrapper, borderBox };
  const paint = blockPaintFromStyle(node.style);
  if (paint) wrapper = { ...wrapper, paint };
  return wrapper;
}

function resolveWrapperX(
  node: StyledNode,
  metrics: HorizontalBoxMetrics,
  containerWidth: number,
): number {
  return resolveHorizontalOffset(
    containerWidth,
    metrics.targetWidth,
    node.style,
    metrics.marginLeft,
    metrics.marginRight,
  );
}

function resolveWrapperHeight(
  node: StyledNode,
  children: readonly LayoutBlock[],
  paddingTop: number,
  paddingBottom: number,
): number {
  const borderTop = node.style.borderTop.width;
  const borderBottom = node.style.borderBottom.width;
  const lastChild = children[children.length - 1];
  let height = lastChild
    ? lastChild.bounds.y + lastChild.bounds.height + paddingBottom + borderBottom
    : paddingBottom + borderTop + borderBottom;
  if (node.style.height > 0) {
    height = resolveExplicitHeight(node, paddingTop, paddingBottom, borderTop + borderBottom);
  }
  if (node.style.minHeight !== undefined && node.style.minHeight > 0) {
    height = Math.max(height, node.style.minHeight);
  }
  return height;
}

function resolveExplicitHeight(
  node: StyledNode,
  paddingTop: number,
  paddingBottom: number,
  borderV: number,
): number {
  return node.style.boxSizing === 'border-box'
    ? node.style.height
    : node.style.height + paddingTop + paddingBottom + borderV;
}

export function isFirstInFlow(child: StyledNode): boolean {
  return (
    child.type === 'block' &&
    child.style.float === 'none' &&
    child.style.position !== 'absolute' &&
    child.style.display !== DISPLAY_VALUES.InlineBlock
  );
}
