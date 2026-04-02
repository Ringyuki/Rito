import type { StyledNode } from '../style/types';
import type { ImageElement, LayoutBlock, LineBox } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import { flattenInlineContent } from './styled-segment';

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

    const hasBlockChildren = node.children.some((c) => c.type === 'block' || c.type === 'image');

    if (hasBlockChildren) {
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;
      const childBlocks = layoutNodesAt(
        node.children,
        contentWidth,
        contentHeight,
        layouter,
        y,
        imageSizes,
      );
      for (const child of childBlocks) blocks.push(child);
      if (childBlocks.length > 0) {
        const last = childBlocks[childBlocks.length - 1];
        if (last) y = last.bounds.y + last.bounds.height;
      }
      prevMarginBottom = node.style.marginBottom;
    } else {
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;
      const block = layoutTextBlock(node, contentWidth, y, layouter);
      blocks.push(block);
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
  const segments = flattenInlineContent(node.children);
  const lineBoxes = layouter.layoutParagraph(segments, contentWidth, 0);
  const height = computeChildrenHeight(lineBoxes);
  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children: lineBoxes,
  };
}

function computeChildrenHeight(lineBoxes: readonly LineBox[]): number {
  if (lineBoxes.length === 0) return 0;
  const last = lineBoxes[lineBoxes.length - 1];
  if (!last) return 0;
  return last.bounds.y + last.bounds.height;
}
