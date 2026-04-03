import type { ComputedStyle, StyledNode } from '../style/types';
import { PAGE_BREAKS } from '../style/types';
import type { BlockBorders, HorizontalRule, LayoutBlock, LineBox } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import { flattenInlineContent } from './styled-segment';
import { layoutImageBlock } from './image-layout';
import { layoutTable } from './table-layout';
import { type ListContext, addListMarker, createListContext } from './list-layout';
import { FloatContext } from './float-context';

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
  const state: LayoutState = { blocks: [], floats: new FloatContext(), y: startY, prevMarginBottom: 0 };

  for (const node of nodes) {
    state.floats.clearExpired(state.y);
    if (node.type === 'image' && node.src) {
      layoutFloatableImage(state, node, contentWidth, contentHeight, imageSizes);
    } else if (node.type === 'block') {
      layoutBlockNode(state, node, contentWidth, contentHeight, layouter, imageSizes, listCtx);
    }
  }

  return state.blocks;
}

function layoutFloatableImage(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  imageSizes?: ImageSizeMap,
): void {
  state.y += Math.max(state.prevMarginBottom, node.style.marginTop);
  const src = node.src ?? '';
  const imgBlock = layoutImageBlock(src, contentWidth, contentHeight, state.y, imageSizes, node.style);

  if (node.style.float === 'left' || node.style.float === 'right') {
    const floatedBlock =
      node.style.float === 'right'
        ? { ...imgBlock, bounds: { ...imgBlock.bounds, x: contentWidth - imgBlock.bounds.width } }
        : imgBlock;
    state.blocks.push(floatedBlock);
    state.floats.addFloat(node.style.float, imgBlock.bounds.width, state.y + imgBlock.bounds.height);
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
    state.y += Math.max(state.prevMarginBottom, node.style.marginTop);
    state.blocks.push(layoutHorizontalRule(contentWidth, state.y, node.style.color));
    state.y += 1;
    state.prevMarginBottom = node.style.marginBottom;
    return;
  }

  if (node.tag === 'table') {
    state.y += Math.max(state.prevMarginBottom, node.style.marginTop);
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
  state.y += Math.max(state.prevMarginBottom, node.style.marginTop);
  const childListCtx = createListContext(node);
  const indent = node.style.paddingLeft;
  const childWidth = indent > 0 ? contentWidth - indent : contentWidth;

  const childBlocks = layoutNodesAt(
    node.children, childWidth, contentHeight, layouter, state.y, imageSizes, childListCtx ?? listCtx,
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
  state.y += Math.max(state.prevMarginBottom, node.style.marginTop);

  const ml = node.style.marginLeft;
  const mr = node.style.marginRight;
  let w = ml + mr > 0 ? contentWidth - ml - mr : contentWidth;
  w = applySizeConstraints(w, node.style);
  w -= state.floats.getLeftWidth(state.y) + state.floats.getRightWidth(state.y);

  let block = layoutTextBlock(node, Math.max(w, 1), state.y, layouter);
  block = addListMarker(block, node, listCtx);

  const xOffset = ml + state.floats.getLeftWidth(state.y);
  if (xOffset > 0) block = { ...block, bounds: { ...block.bounds, x: block.bounds.x + xOffset } };
  if (node.id) block = { ...block, anchorId: node.id };
  state.blocks.push(withPageBreaks(block, node.style));
  state.y += block.bounds.height;
  state.prevMarginBottom = node.style.marginBottom;
}

// ── Internal helpers ───────────────────────────────────────────────

function layoutTextBlock(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
): LayoutBlock {
  const { paddingTop, paddingBottom, paddingRight, backgroundColor } = node.style;
  const innerWidth = contentWidth - paddingRight - node.style.paddingLeft;
  const segments = flattenInlineContent(node.children);
  const lineBoxes = layouter.layoutParagraph(segments, innerWidth > 0 ? innerWidth : contentWidth, 0);
  const ch = computeChildrenHeight(lineBoxes);
  const height = paddingTop + ch + paddingBottom;

  const children =
    paddingTop > 0
      ? lineBoxes.map((lb) => ({
          ...lb,
          bounds: { ...lb.bounds, y: lb.bounds.y + paddingTop },
          runs: lb.runs.map((r) => ({ ...r, bounds: { ...r.bounds, y: r.bounds.y + paddingTop } })),
        }))
      : lineBoxes;

  let block: LayoutBlock = { type: 'layout-block', bounds: { x: 0, y, width: contentWidth, height }, children };
  if (backgroundColor) block = { ...block, backgroundColor };
  const borders = extractBorders(node.style);
  if (borders) block = { ...block, borders };
  return block;
}

function applySizeConstraints(availableWidth: number, style: ComputedStyle): number {
  let w = availableWidth;
  if (style.width > 0) w = Math.min(style.width, availableWidth);
  if (style.maxWidth > 0) w = Math.min(w, style.maxWidth);
  return w;
}

function extractBorders(style: ComputedStyle): BlockBorders | undefined {
  const { borderTop, borderRight, borderBottom, borderLeft } = style;
  const hasAny =
    (borderTop.style === 'solid' && borderTop.width > 0) ||
    (borderRight.style === 'solid' && borderRight.width > 0) ||
    (borderBottom.style === 'solid' && borderBottom.width > 0) ||
    (borderLeft.style === 'solid' && borderLeft.width > 0);
  if (!hasAny) return undefined;
  return {
    top: { width: borderTop.width, color: borderTop.color },
    right: { width: borderRight.width, color: borderRight.color },
    bottom: { width: borderBottom.width, color: borderBottom.color },
    left: { width: borderLeft.width, color: borderLeft.color },
  };
}

function computeChildrenHeight(lineBoxes: readonly LineBox[]): number {
  if (lineBoxes.length === 0) return 0;
  const last = lineBoxes[lineBoxes.length - 1];
  if (!last) return 0;
  return last.bounds.y + last.bounds.height;
}

function withPageBreaks(block: LayoutBlock, style: ComputedStyle): LayoutBlock {
  const before = style.pageBreakBefore === PAGE_BREAKS.Always;
  const after = style.pageBreakAfter === PAGE_BREAKS.Always;
  if (!before && !after) return block;
  const result = { ...block };
  if (before) (result as { pageBreakBefore?: boolean }).pageBreakBefore = true;
  if (after) (result as { pageBreakAfter?: boolean }).pageBreakAfter = true;
  return result;
}

function applyPageBreakFlags(blocks: readonly LayoutBlock[], style: ComputedStyle): void {
  if (blocks.length === 0) return;
  if (style.pageBreakBefore === PAGE_BREAKS.Always) {
    const first = blocks[0];
    if (first) Object.assign(first, { pageBreakBefore: true });
  }
  if (style.pageBreakAfter === PAGE_BREAKS.Always) {
    const last = blocks[blocks.length - 1];
    if (last) Object.assign(last, { pageBreakAfter: true });
  }
}

function indentBlocks(blocks: readonly LayoutBlock[], indent: number): readonly LayoutBlock[] {
  return blocks.map((b) => ({ ...b, bounds: { ...b.bounds, x: b.bounds.x + indent } }));
}

const HR_THICKNESS = 1;

function layoutHorizontalRule(contentWidth: number, y: number, color: string): LayoutBlock {
  const hr: HorizontalRule = { type: 'hr', bounds: { x: 0, y: 0, width: contentWidth, height: HR_THICKNESS }, color };
  return { type: 'layout-block', bounds: { x: 0, y, width: contentWidth, height: HR_THICKNESS }, children: [hr] };
}
