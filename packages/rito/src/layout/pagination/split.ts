import type { LayoutBlock, LineBox, PaginationPolicy } from '../core/types';

interface SplitResult {
  readonly head: LayoutBlock;
  readonly tail: LayoutBlock;
}

export function trySplitBlock(
  block: LayoutBlock,
  availableHeight: number,
  policy?: PaginationPolicy,
): SplitResult | undefined {
  if (!block.children.every((child): child is LineBox => child.type === 'line-box')) {
    return undefined;
  }

  const lineBoxes = block.children;
  const policyEnabled = policy?.enabled !== false;
  const defaultOrphans = policy?.defaultOrphans ?? 2;
  const defaultWidows = policy?.defaultWidows ?? 2;
  const orphans = policyEnabled ? (block.orphans ?? defaultOrphans) : 1;
  const widows = policyEnabled ? (block.widows ?? defaultWidows) : 1;
  const minTotal = orphans + widows;

  let splitIndex = findSplitIndex(lineBoxes, availableHeight);

  // Enforce orphans/widows when the block has enough lines
  if (lineBoxes.length >= minTotal) {
    if (splitIndex < orphans) splitIndex = orphans;
    if (lineBoxes.length - splitIndex < widows) splitIndex = lineBoxes.length - widows;
  }
  // For blocks with fewer lines than orphans+widows, still allow splitting
  // at the height boundary to prevent overflow (skip orphan/widow rules)

  if (splitIndex <= 0 || splitIndex >= lineBoxes.length) return undefined;

  return buildSplitResult(block, lineBoxes, splitIndex);
}

/**
 * Force-split a block at the height boundary, ignoring orphan/widow rules.
 * Used as a last resort when trySplitBlock returns undefined but the block overflows.
 */
export function forceSplitBlock(
  block: LayoutBlock,
  availableHeight: number,
): SplitResult | undefined {
  const lineBoxes = block.children.filter((child): child is LineBox => child.type === 'line-box');
  if (lineBoxes.length === 0) return undefined;

  const splitIndex = findSplitIndex(lineBoxes, availableHeight);
  if (splitIndex <= 0 || splitIndex >= lineBoxes.length) return undefined;

  return buildSplitResult(block, lineBoxes, splitIndex);
}

export function repositionBlock(block: LayoutBlock, newY: number): LayoutBlock {
  return { ...block, bounds: { ...block.bounds, y: newY } };
}

function findSplitIndex(lineBoxes: readonly LineBox[], availableHeight: number): number {
  let splitIndex = 0;
  for (let index = 0; index < lineBoxes.length; index++) {
    const lineBox = lineBoxes[index];
    if (!lineBox || lineBox.bounds.y + lineBox.bounds.height > availableHeight) break;
    splitIndex = index + 1;
  }
  return splitIndex;
}

function buildSplitResult(
  block: LayoutBlock,
  lineBoxes: readonly LineBox[],
  splitIndex: number,
): SplitResult {
  const headLines = lineBoxes.slice(0, splitIndex);
  const tailLines = repositionLines(lineBoxes.slice(splitIndex));

  return {
    head: {
      type: 'layout-block',
      bounds: { ...block.bounds, height: computeLinesHeight(headLines) },
      children: headLines,
    },
    tail: {
      type: 'layout-block',
      bounds: { ...block.bounds, y: 0, height: computeLinesHeight(tailLines) },
      children: tailLines,
    },
  };
}

function repositionLines(lines: readonly LineBox[]): LineBox[] {
  if (lines.length === 0) return [];
  const firstY = lines[0]?.bounds.y ?? 0;

  return lines.map((line) => ({
    ...line,
    bounds: { ...line.bounds, y: line.bounds.y - firstY },
    // Run bounds are relative to the line box — do NOT shift them.
    // Only line box positions need repositioning within the new block.
  }));
}

function computeLinesHeight(lines: readonly LineBox[]): number {
  if (lines.length === 0) return 0;
  const last = lines[lines.length - 1];
  return last ? last.bounds.y + last.bounds.height : 0;
}
