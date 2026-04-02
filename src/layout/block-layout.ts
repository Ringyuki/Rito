import type { StyledNode } from '../style/types';
import type { LayoutBlock, LineBox } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import { flattenInlineContent } from './styled-segment';

/**
 * Lay out block-level styled nodes into a continuous vertical flow.
 *
 * Coordinates are in content-area space (y starts at 0).
 * LineBox y-values within each block are relative to the block's top.
 * The paginator later splits these blocks into pages.
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

    // Simplified margin collapsing: use max of adjacent margins
    const collapsedMargin = Math.max(prevMarginBottom, node.style.marginTop);
    y += collapsedMargin;

    const block = layoutSingleBlock(node, contentWidth, y, layouter);
    blocks.push(block);

    y += block.bounds.height;
    prevMarginBottom = node.style.marginBottom;
  }

  return blocks;
}

function layoutSingleBlock(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
): LayoutBlock {
  const hasBlockChildren = node.children.some((c) => c.type === 'block');

  if (hasBlockChildren) {
    return layoutContainerBlock(node, contentWidth, y, layouter);
  }

  return layoutTextBlock(node, contentWidth, y, layouter);
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

/** Layout a block that contains nested block children. */
function layoutContainerBlock(
  node: StyledNode,
  contentWidth: number,
  y: number,
  layouter: ParagraphLayouter,
): LayoutBlock {
  const childBlocks = layoutBlocks(node.children, contentWidth, layouter);
  const height = computeBlocksHeight(childBlocks);

  return {
    type: 'layout-block',
    bounds: { x: 0, y, width: contentWidth, height },
    children: childBlocks,
  };
}

function computeChildrenHeight(lineBoxes: readonly LineBox[]): number {
  if (lineBoxes.length === 0) return 0;
  const last = lineBoxes[lineBoxes.length - 1];
  if (!last) return 0;
  return last.bounds.y + last.bounds.height;
}

function computeBlocksHeight(blocks: readonly LayoutBlock[]): number {
  if (blocks.length === 0) return 0;
  const last = blocks[blocks.length - 1];
  if (!last) return 0;
  // Height from 0 to the bottom of the last child block (relative to container)
  return last.bounds.y + last.bounds.height;
}
