import type { ComputedStyle, StyledNode } from '../../style/core/types';
import type { HorizontalRule, LayoutBlock, LineBox } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import { flattenInlineContent } from '../text/styled-segment';
import { computeChildrenHeight } from './helpers';
import { blockPaintFromStyle, borderBoxFromStyle } from './paint-from-style';
import {
  resolvePaddingBottom,
  resolvePaddingLeft,
  resolvePaddingRight,
  resolvePaddingTop,
} from './resolve-pct';
import type { ImageSizeMap } from './types';

const HR_THICKNESS = 1;

interface TextBlockMetrics {
  readonly paddingTop: number;
  readonly paddingBottom: number;
  readonly paddingRight: number;
  readonly paddingLeft: number;
  readonly borderTop: number;
  readonly borderBottom: number;
  readonly borderLeft: number;
  readonly borderRight: number;
  readonly innerWidth: number;
}

export function layoutTextBlock(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
): LayoutBlock {
  const metrics = resolveTextBlockMetrics(node, contentWidth);
  const segments = flattenInlineContent(node.children, imageSizes, node.href);
  const lineBoxes = layouter.layoutParagraph(
    segments,
    metrics.innerWidth > 0 ? metrics.innerWidth : contentWidth,
    0,
  );
  const children = offsetTextChildren(lineBoxes, metrics);
  const height = resolveTextBlockHeight(node.style, lineBoxes, metrics);

  const block: LayoutBlock = {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children,
  };
  return applyBlockDecorations(block, node);
}

function resolveTextBlockMetrics(node: StyledNode, contentWidth: number): TextBlockMetrics {
  const paddingTop = resolvePaddingTop(node.style, contentWidth);
  const paddingBottom = resolvePaddingBottom(node.style, contentWidth);
  const paddingRight = resolvePaddingRight(node.style, contentWidth);
  const paddingLeft = resolvePaddingLeft(node.style, contentWidth);
  const borderTop = node.style.borderTop.width;
  const borderBottom = node.style.borderBottom.width;
  const borderLeft = node.style.borderLeft.width;
  const borderRight = node.style.borderRight.width;
  return {
    paddingTop,
    paddingBottom,
    paddingRight,
    paddingLeft,
    borderTop,
    borderBottom,
    borderLeft,
    borderRight,
    innerWidth: contentWidth - paddingRight - paddingLeft - borderLeft - borderRight,
  };
}

function offsetTextChildren(
  lineBoxes: readonly LineBox[],
  metrics: TextBlockMetrics,
): readonly LineBox[] {
  const dx = metrics.borderLeft + metrics.paddingLeft;
  const dy = metrics.borderTop + metrics.paddingTop;
  if (dy <= 0 && dx <= 0) return lineBoxes;
  return lineBoxes.map((lineBox) => ({
    ...lineBox,
    bounds: {
      ...lineBox.bounds,
      x: lineBox.bounds.x + dx,
      y: lineBox.bounds.y + dy,
    },
  }));
}

function resolveTextBlockHeight(
  style: ComputedStyle,
  lineBoxes: readonly LineBox[],
  metrics: TextBlockMetrics,
): number {
  let height =
    metrics.borderTop +
    metrics.paddingTop +
    computeChildrenHeight(lineBoxes) +
    metrics.paddingBottom +
    metrics.borderBottom;
  if (style.height > 0) {
    const borderV = metrics.borderTop + metrics.borderBottom;
    height =
      style.boxSizing === 'border-box'
        ? style.height
        : style.height + metrics.paddingTop + metrics.paddingBottom + borderV;
  }
  return applyHeightConstraints(height, style);
}

function applyBlockDecorations(block: LayoutBlock, node: StyledNode): LayoutBlock {
  let result = block;
  if (node.tag) result = { ...result, semanticTag: node.tag };
  const borderBox = borderBoxFromStyle(node.style);
  if (borderBox) result = { ...result, borderBox };
  if (node.style.orphans !== 2) result = { ...result, orphans: node.style.orphans };
  if (node.style.widows !== 2) result = { ...result, widows: node.style.widows };
  const paint = blockPaintFromStyle(node.style);
  if (paint) result = { ...result, paint };
  return result;
}

export function applyRelativeOffset(block: LayoutBlock, style: ComputedStyle): LayoutBlock {
  const offset = computeRelativeOffset(style);
  if (!offset) return block;
  const prevPaint = block.paint;
  return {
    ...block,
    paint: { ...(prevPaint ?? {}), visualOffset: offset },
  };
}

/**
 * Apply CSS width/maxWidth constraints and return the total box width.
 *
 * @param availableWidth - Maximum width the element can occupy (post-margin space).
 * @param style - Computed style with width/maxWidth/widthPct/maxWidthPct.
 * @param containerWidth - Containing block width for resolving percentages.
 *   Defaults to availableWidth for backward compatibility.
 */
export function applySizeConstraints(
  availableWidth: number,
  style: ComputedStyle,
  containerWidth: number = availableWidth,
): number {
  let width = availableWidth;
  const resolvedWidth =
    style.width > 0
      ? style.width
      : style.widthPct !== undefined
        ? (style.widthPct / 100) * containerWidth
        : 0;
  if (resolvedWidth > 0) width = Math.min(toTotalBox(resolvedWidth, style), availableWidth);

  const resolvedMaxWidth =
    style.maxWidth > 0
      ? style.maxWidth
      : style.maxWidthPct !== undefined
        ? (style.maxWidthPct / 100) * containerWidth
        : 0;
  if (resolvedMaxWidth > 0) width = Math.min(width, toTotalBox(resolvedMaxWidth, style));
  return width;
}

export function indentBlocks(
  blocks: readonly LayoutBlock[],
  indent: number,
): readonly LayoutBlock[] {
  return blocks.map((block) => ({
    ...block,
    bounds: { ...block.bounds, x: block.bounds.x + indent },
  }));
}

export function layoutHorizontalRule(
  contentWidth: number,
  y: number,
  color: string,
  height: number = HR_THICKNESS,
  borderStyle: 'solid' | 'dotted' | 'dashed' = 'solid',
): LayoutBlock {
  const hr: HorizontalRule = {
    type: 'hr',
    bounds: { x: 0, y: 0, width: contentWidth, height },
    paint: { color, style: borderStyle },
  };
  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children: [hr],
  };
}

function computeRelativeOffset(style: ComputedStyle): { dx: number; dy: number } | undefined {
  if (style.position !== 'relative') return undefined;
  const dy = style.top !== 0 ? style.top : style.bottom !== 0 ? -style.bottom : 0;
  const dx = style.left !== 0 ? style.left : style.right !== 0 ? -style.right : 0;
  if (dx === 0 && dy === 0) return undefined;
  return { dx, dy };
}

/**
 * Convert a CSS width/maxWidth value to total box width (content + padding + border).
 * - content-box: CSS value is content width → add padding + border
 * - border-box: CSS value IS the total box → return as-is
 */
function toTotalBox(value: number, style: ComputedStyle): number {
  if (style.boxSizing === 'border-box') return value;
  return (
    value +
    style.paddingLeft +
    style.paddingRight +
    style.borderLeft.width +
    style.borderRight.width
  );
}

function applyHeightConstraints(height: number, style: ComputedStyle): number {
  let constrained = height;
  if (style.minHeight !== undefined && constrained < style.minHeight) {
    constrained = style.minHeight;
  }
  if (style.maxHeight !== undefined && constrained > style.maxHeight) {
    constrained = style.maxHeight;
  }
  return constrained;
}
