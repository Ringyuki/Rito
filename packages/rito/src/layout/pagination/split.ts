import type { LayoutBlock, LineBox } from '../core/types';

interface SplitResult {
  readonly head: LayoutBlock;
  readonly tail: LayoutBlock;
}

const MIN_SPLIT_LINES = 2;

export function trySplitBlock(
  block: LayoutBlock,
  availableHeight: number,
): SplitResult | undefined {
  if (!block.children.every((child): child is LineBox => child.type === 'line-box')) {
    return undefined;
  }

  const lineBoxes = block.children;
  if (lineBoxes.length < 2) return undefined;

  const splitIndex = findSplitIndex(lineBoxes, availableHeight);
  if (splitIndex === 0 || splitIndex >= lineBoxes.length) return undefined;

  const headCount = splitIndex;
  const tailCount = lineBoxes.length - splitIndex;
  if (headCount < MIN_SPLIT_LINES || tailCount < MIN_SPLIT_LINES) return undefined;

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
    runs: line.runs.map((run) => ({
      ...run,
      bounds: { ...run.bounds, y: run.bounds.y - firstY },
    })),
  }));
}

function computeLinesHeight(lines: readonly LineBox[]): number {
  if (lines.length === 0) return 0;
  const last = lines[lines.length - 1];
  return last ? last.bounds.y + last.bounds.height : 0;
}
