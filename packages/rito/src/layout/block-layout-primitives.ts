import type { ComputedStyle, StyledNode } from '../style/types';
import type { HorizontalRule, LayoutBlock, RelativeOffset } from './types';
import { computeChildrenHeight, extractBorders } from './block-helpers';
import type { ParagraphLayouter } from './paragraph-layouter';
import { flattenInlineContent } from './styled-segment';

export function layoutTextBlock(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
): LayoutBlock {
  const { paddingTop, paddingBottom, paddingRight, backgroundColor } = node.style;
  const innerWidth = contentWidth - paddingRight - node.style.paddingLeft;
  const segments = flattenInlineContent(node.children);
  const lineBoxes = layouter.layoutParagraph(
    segments,
    innerWidth > 0 ? innerWidth : contentWidth,
    0,
  );
  const children =
    paddingTop > 0
      ? lineBoxes.map((lineBox) => ({
          ...lineBox,
          bounds: { ...lineBox.bounds, y: lineBox.bounds.y + paddingTop },
          runs: lineBox.runs.map((run) => ({
            ...run,
            bounds: { ...run.bounds, y: run.bounds.y + paddingTop },
          })),
        }))
      : lineBoxes;

  let block: LayoutBlock = {
    type: 'layout-block',
    bounds: {
      x: 0,
      y,
      width: contentWidth,
      height: applyHeightConstraints(
        paddingTop + computeChildrenHeight(lineBoxes) + paddingBottom,
        node.style,
      ),
    },
    children,
  };
  if (backgroundColor) block = { ...block, backgroundColor };
  const borders = extractBorders(node.style);
  if (borders) block = { ...block, borders };
  if (node.style.borderRadius > 0) block = { ...block, borderRadius: node.style.borderRadius };
  if (node.style.opacity < 1) block = { ...block, opacity: node.style.opacity };
  if (node.style.overflow === 'hidden') block = { ...block, overflow: 'hidden' };
  return block;
}

export function applyRelativeOffset(block: LayoutBlock, style: ComputedStyle): LayoutBlock {
  const offset = computeRelativeOffset(style);
  if (!offset) return block;
  return { ...block, relativeOffset: offset };
}

export function applySizeConstraints(availableWidth: number, style: ComputedStyle): number {
  let width = availableWidth;
  if (style.width > 0) width = Math.min(toBorderBox(style.width, style), availableWidth);
  if (style.maxWidth > 0) width = Math.min(width, toBorderBox(style.maxWidth, style));
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

export function layoutHorizontalRule(contentWidth: number, y: number, color: string): LayoutBlock {
  const hr: HorizontalRule = {
    type: 'hr',
    bounds: { x: 0, y: 0, width: contentWidth, height: HR_THICKNESS },
    color,
  };
  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height: HR_THICKNESS },
    children: [hr],
  };
}

function computeRelativeOffset(style: ComputedStyle): RelativeOffset | undefined {
  if (style.position !== 'relative') return undefined;
  const dy = style.top !== 0 ? style.top : style.bottom !== 0 ? -style.bottom : 0;
  const dx = style.left !== 0 ? style.left : style.right !== 0 ? -style.right : 0;
  if (dx === 0 && dy === 0) return undefined;
  return { dx, dy };
}

function toBorderBox(value: number, style: ComputedStyle): number {
  if (style.boxSizing !== 'border-box') return value;
  const deduction =
    style.paddingLeft + style.paddingRight + style.borderLeft.width + style.borderRight.width;
  return Math.max(value - deduction, 0);
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

const HR_THICKNESS = 1;
