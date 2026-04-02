import type { StyledNode } from '../style/types';
import type { LayoutBlock, LineBox } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import { flattenInlineContent } from './styled-segment';

/**
 * Lay out block-level styled nodes into a continuous vertical flow.
 *
 * Container blocks (e.g. section, div) are flattened: their children
 * appear directly in the output flow rather than wrapped in an unsplittable
 * container. This ensures the paginator can split at any paragraph boundary.
 *
 * LineBox y-values within each block are relative to the block's top (start at 0).
 */
export function layoutBlocks(
  nodes: readonly StyledNode[],
  contentWidth: number,
  layouter: ParagraphLayouter,
): readonly LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  let y = 0;
  let prevMarginBottom = 0;

  for (const node of nodes) {
    if (node.type !== 'block') continue;

    const hasBlockChildren = node.children.some((c) => c.type === 'block');

    if (hasBlockChildren) {
      // Flatten container: lay out children directly into the flow
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;

      const childBlocks = layoutBlocksAt(node.children, contentWidth, layouter, y);
      for (const child of childBlocks) {
        blocks.push(child);
      }

      if (childBlocks.length > 0) {
        const last = childBlocks[childBlocks.length - 1];
        if (last) {
          y = last.bounds.y + last.bounds.height;
        }
      }
      prevMarginBottom = node.style.marginBottom;
    } else {
      // Text block: flatten inline content and lay out as paragraph
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

/**
 * Internal: lay out nodes starting at a given y offset.
 * Used for recursive container flattening.
 */
function layoutBlocksAt(
  nodes: readonly StyledNode[],
  contentWidth: number,
  layouter: ParagraphLayouter,
  startY: number,
): readonly LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  let y = startY;
  let prevMarginBottom = 0;

  for (const node of nodes) {
    if (node.type !== 'block') continue;

    const hasBlockChildren = node.children.some((c) => c.type === 'block');

    if (hasBlockChildren) {
      const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
      y += collapsedMargin;

      const childBlocks = layoutBlocksAt(node.children, contentWidth, layouter, y);
      for (const child of childBlocks) {
        blocks.push(child);
      }

      if (childBlocks.length > 0) {
        const last = childBlocks[childBlocks.length - 1];
        if (last) {
          y = last.bounds.y + last.bounds.height;
        }
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
