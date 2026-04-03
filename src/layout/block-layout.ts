import type { ComputedStyle, ListStyleType, StyledNode } from '../style/types';
import { LIST_STYLE_TYPES, PAGE_BREAKS } from '../style/types';
import type { HorizontalRule, ImageElement, LayoutBlock, LineBox } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import { flattenInlineContent } from './styled-segment';
import { createMarkerRun } from './list-marker';

/** Default image height when intrinsic dimensions are unknown. */
const DEFAULT_IMAGE_ASPECT = 0.75;

/**
 * Lay out block-level styled nodes into a continuous vertical flow.
 * Container blocks are flattened for pagination.
 */
/** Intrinsic image dimensions for correct aspect ratio. */
export interface ImageSizeMap {
  getSize(src: string): { width: number; height: number } | undefined;
}

interface ListContext {
  listStyleType: ListStyleType;
  counter: number;
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

function layoutNodesAt(
  nodes: readonly StyledNode[],
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  startY: number,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): readonly LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  let y = startY;
  let prevMarginBottom = 0;

  for (const node of nodes) {
    if (node.type === 'image' && node.src) {
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;
      const imgBlock = layoutImageBlock(node.src, contentWidth, contentHeight, y, imageSizes);
      blocks.push(imgBlock);
      y += imgBlock.bounds.height;
      prevMarginBottom = node.style.marginBottom;
      continue;
    }

    if (node.type !== 'block') continue;

    if (node.tag === 'hr') {
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;
      const hrBlock = layoutHorizontalRule(contentWidth, y, node.style.color);
      blocks.push(hrBlock);
      y += hrBlock.bounds.height;
      prevMarginBottom = node.style.marginBottom;
      continue;
    }

    const hasBlockChildren = node.children.some((c) => c.type === 'block' || c.type === 'image');

    if (hasBlockChildren) {
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;

      // Determine list context and indentation for ul/ol
      const childListCtx = createListContext(node);
      const indent = node.style.paddingLeft;
      const childWidth = indent > 0 ? contentWidth - indent : contentWidth;

      const childBlocks = layoutNodesAt(
        node.children,
        childWidth,
        contentHeight,
        layouter,
        y,
        imageSizes,
        childListCtx ?? listCtx,
      );

      // Offset children by paddingLeft if present
      const indentedBlocks = indent > 0 ? indentBlocks(childBlocks, indent) : childBlocks;

      applyPageBreakFlags(indentedBlocks, node.style);
      if (node.id && indentedBlocks.length > 0) {
        const first = indentedBlocks[0];
        if (first) Object.assign(first, { anchorId: node.id });
      }
      for (const child of indentedBlocks) blocks.push(child);
      if (indentedBlocks.length > 0) {
        const last = indentedBlocks[indentedBlocks.length - 1];
        if (last) y = last.bounds.y + last.bounds.height;
      }
      prevMarginBottom = node.style.marginBottom;
    } else {
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;

      let block = layoutListItemOrTextBlock(node, contentWidth, y, layouter, listCtx);
      if (node.id) block = { ...block, anchorId: node.id };
      blocks.push(withPageBreaks(block, node.style));
      y += block.bounds.height;
      prevMarginBottom = node.style.marginBottom;
    }
  }

  return blocks;
}

/** Layout an image as a block. Fits within content area, preserving aspect ratio. */
function layoutImageBlock(
  src: string,
  contentWidth: number,
  contentHeight: number,
  y: number,
  imageSizes?: ImageSizeMap,
): LayoutBlock {
  const intrinsic = imageSizes?.getSize(src);
  const aspect = intrinsic ? intrinsic.height / intrinsic.width : DEFAULT_IMAGE_ASPECT;
  let width = contentWidth;
  let height = width * aspect;
  // Cap height at content area height
  if (height > contentHeight) {
    height = contentHeight;
    width = height / aspect;
  }
  // Center horizontally if width was reduced
  const x = width < contentWidth ? (contentWidth - width) / 2 : 0;
  const imageElement: ImageElement = {
    type: 'image',
    src,
    bounds: { x, y: 0, width, height },
  };
  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children: [imageElement],
  };
}

/** Layout a block that contains only inline/text children. */
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
  const contentHeight = computeChildrenHeight(lineBoxes);
  const height = paddingTop + contentHeight + paddingBottom;

  // Offset line boxes by paddingTop if present
  const children =
    paddingTop > 0
      ? lineBoxes.map((lb) => ({
          ...lb,
          bounds: { ...lb.bounds, y: lb.bounds.y + paddingTop },
          runs: lb.runs.map((r) => ({
            ...r,
            bounds: { ...r.bounds, y: r.bounds.y + paddingTop },
          })),
        }))
      : lineBoxes;

  const block: LayoutBlock = {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children,
  };
  if (backgroundColor) {
    return { ...block, backgroundColor };
  }
  return block;
}

function computeChildrenHeight(lineBoxes: readonly LineBox[]): number {
  if (lineBoxes.length === 0) return 0;
  const last = lineBoxes[lineBoxes.length - 1];
  if (!last) return 0;
  return last.bounds.y + last.bounds.height;
}

/** Create a list context if the node is a ul or ol. */
function createListContext(node: StyledNode): ListContext | undefined {
  if (node.tag === 'ul' || node.tag === 'ol') {
    return { listStyleType: node.style.listStyleType, counter: 0 };
  }
  return undefined;
}

/** Layout a list item (with marker) or a plain text block. */
function layoutListItemOrTextBlock(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
  listCtx?: ListContext,
): LayoutBlock {
  const block = layoutTextBlock(node, contentWidth, y, layouter);
  if (!listCtx || node.tag !== 'li' || listCtx.listStyleType === LIST_STYLE_TYPES.None) {
    return block;
  }
  listCtx.counter++;
  const firstLine = block.children[0];
  if (!firstLine || firstLine.type !== 'line-box') return block;
  const marker = createMarkerRun(
    listCtx.counter,
    listCtx.listStyleType,
    node.style,
    firstLine.bounds.height,
  );
  const markerLine: LineBox = {
    ...firstLine,
    runs: [marker, ...firstLine.runs],
  };
  return { ...block, children: [markerLine, ...block.children.slice(1)] };
}

/** Offset all blocks' x position by the given indent. */
function indentBlocks(blocks: readonly LayoutBlock[], indent: number): readonly LayoutBlock[] {
  return blocks.map((b) => ({
    ...b,
    bounds: { ...b.bounds, x: b.bounds.x + indent },
  }));
}

/** Add page-break flags from a style to a layout block. */
function withPageBreaks(block: LayoutBlock, style: ComputedStyle): LayoutBlock {
  const before = style.pageBreakBefore === PAGE_BREAKS.Always;
  const after = style.pageBreakAfter === PAGE_BREAKS.Always;
  if (!before && !after) return block;
  const result = { ...block };
  if (before) (result as { pageBreakBefore?: boolean }).pageBreakBefore = true;
  if (after) (result as { pageBreakAfter?: boolean }).pageBreakAfter = true;
  return result;
}

/** Propagate page-break flags from a container to its first/last child blocks. */
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

const HR_THICKNESS = 1;

/** Layout a horizontal rule as a thin block. */
function layoutHorizontalRule(contentWidth: number, y: number, color: string): LayoutBlock {
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
