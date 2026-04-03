import type { ComputedStyle, ListStyleType, StyledNode } from '../style/types';
import { LIST_STYLE_TYPES, PAGE_BREAKS } from '../style/types';
import type { BlockBorders, HorizontalRule, ImageElement, LayoutBlock, LineBox } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import { flattenInlineContent } from './styled-segment';
import { createMarkerRun } from './list-marker';
import { layoutTable } from './table-layout';

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
  // Active floats: track their bottom y and width for text wrapping
  let leftFloat: { bottomY: number; width: number } | undefined;
  let rightFloat: { bottomY: number; width: number } | undefined;

  for (const node of nodes) {
    // Clear expired floats
    if (leftFloat && y >= leftFloat.bottomY) leftFloat = undefined;
    if (rightFloat && y >= rightFloat.bottomY) rightFloat = undefined;

    if (node.type === 'image' && node.src) {
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;
      const imgBlock = layoutImageBlock(node.src, contentWidth, contentHeight, y, imageSizes, node.style);

      if (node.style.float === 'left' || node.style.float === 'right') {
        // Floated image: position to left/right, don't advance y
        const floatedBlock = node.style.float === 'right'
          ? { ...imgBlock, bounds: { ...imgBlock.bounds, x: contentWidth - imgBlock.bounds.width } }
          : imgBlock;
        blocks.push(floatedBlock);
        const floatInfo = { bottomY: y + imgBlock.bounds.height, width: imgBlock.bounds.width };
        if (node.style.float === 'left') leftFloat = floatInfo;
        else rightFloat = floatInfo;
        prevMarginBottom = 0;
      } else {
        blocks.push(imgBlock);
        y += imgBlock.bounds.height;
        prevMarginBottom = node.style.marginBottom;
      }
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

    if (node.tag === 'table') {
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;
      // Tables use full content width — CSS width on tables is a min-width hint,
      // not a max constraint. Tables expand to fit their content.
      let block = layoutTable(node, contentWidth, y, layouter);
      if (node.id) block = { ...block, anchorId: node.id };
      blocks.push(withPageBreaks(block, node.style));
      y += block.bounds.height;
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

      const ml = node.style.marginLeft;
      const mr = node.style.marginRight;
      let effectiveWidth = ml + mr > 0 ? contentWidth - ml - mr : contentWidth;
      effectiveWidth = applySizeConstraints(effectiveWidth, node.style);
      // Reduce width for active floats
      const floatLeftW = leftFloat && y < leftFloat.bottomY ? leftFloat.width : 0;
      const floatRightW = rightFloat && y < rightFloat.bottomY ? rightFloat.width : 0;
      effectiveWidth -= floatLeftW + floatRightW;
      let block = layoutListItemOrTextBlock(node, Math.max(effectiveWidth, 1), y, layouter, listCtx);
      const xOffset = ml + floatLeftW;
      if (xOffset > 0) block = { ...block, bounds: { ...block.bounds, x: block.bounds.x + xOffset } };
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
  style?: ComputedStyle,
): LayoutBlock {
  const intrinsic = imageSizes?.getSize(src);
  const aspect = intrinsic ? intrinsic.height / intrinsic.width : DEFAULT_IMAGE_ASPECT;

  // Start with explicit CSS dimensions or default to full content width
  let width = style?.width && style.width > 0 ? Math.min(style.width, contentWidth) : contentWidth;
  if (style?.maxWidth && style.maxWidth > 0) width = Math.min(width, style.maxWidth);
  let height = style?.height && style.height > 0 ? style.height : width * aspect;

  // Cap at content area
  if (height > contentHeight) {
    height = contentHeight;
    width = height / aspect;
  }
  if (width > contentWidth) {
    width = contentWidth;
    height = width * aspect;
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
  const lineBoxes = layouter.layoutParagraph(
    segments,
    innerWidth > 0 ? innerWidth : contentWidth,
    0,
  );
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

  let block: LayoutBlock = {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children,
  };
  if (backgroundColor) {
    block = { ...block, backgroundColor };
  }
  const borders = extractBorders(node.style);
  if (borders) {
    block = { ...block, borders };
  }
  return block;
}

/** Extract border info from style, or return undefined if no visible borders. */
/** Apply CSS width/max-width constraints to an available width. */
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
