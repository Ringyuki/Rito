import type { LayoutBlock, LineBox, Page, TextRun } from '../../layout/core/types';
import type { TextPosition, TextRange } from './types';

export interface TraversedLineBox {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly lineBox: LineBox;
  readonly originX: number;
  readonly originY: number;
}

export interface TraversedTextRun {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly run: TextRun;
  readonly originX: number;
  readonly originY: number;
}

interface LineTraversalState {
  lineIndex: number;
}

export function walkPageLineBoxes(
  page: Page,
  callback: (entry: TraversedLineBox) => boolean | undefined,
): void {
  for (let blockIndex = 0; blockIndex < page.content.length; blockIndex++) {
    const block = page.content[blockIndex];
    if (!block) continue;
    const state: LineTraversalState = { lineIndex: 0 };
    if (walkBlockLineBoxes(block, blockIndex, 0, 0, state, callback)) return;
  }
}

export function walkPageTextRuns(
  page: Page,
  callback: (entry: TraversedTextRun) => boolean | undefined,
): void {
  walkPageLineBoxes(page, ({ blockIndex, lineIndex, lineBox, originX, originY }) => {
    for (let runIndex = 0; runIndex < lineBox.runs.length; runIndex++) {
      const run = lineBox.runs[runIndex];
      if (run?.type !== 'text-run') continue;
      if (callback({ blockIndex, lineIndex, runIndex, run, originX, originY })) return true;
    }
    return false;
  });
}

export function compareTextPositions(a: TextPosition, b: TextPosition): number {
  if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
  if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
  if (a.runIndex !== b.runIndex) return a.runIndex - b.runIndex;
  return a.charIndex - b.charIndex;
}

export function normalizeTextRange(range: TextRange): [TextPosition, TextPosition] {
  if (compareTextPositions(range.start, range.end) <= 0) return [range.start, range.end];
  return [range.end, range.start];
}

export function isSameTextPosition(a: TextPosition, b: TextPosition): boolean {
  return compareTextPositions(a, b) === 0;
}

export function isSameTextRun(
  pos: { blockIndex: number; lineIndex: number; runIndex: number },
  target: TextPosition,
): boolean {
  return (
    pos.blockIndex === target.blockIndex &&
    pos.lineIndex === target.lineIndex &&
    pos.runIndex === target.runIndex
  );
}

export function getFirstTextPosition(page: Page): TextPosition | undefined {
  let first: TextPosition | undefined;
  walkPageTextRuns(page, ({ blockIndex, lineIndex, runIndex }) => {
    first = { blockIndex, lineIndex, runIndex, charIndex: 0 };
    return true;
  });
  return first;
}

export function getLastTextPosition(page: Page): TextPosition | undefined {
  let last: TextPosition | undefined;
  walkPageTextRuns(page, ({ blockIndex, lineIndex, runIndex, run }) => {
    last = { blockIndex, lineIndex, runIndex, charIndex: run.text.length };
    return false;
  });
  return last;
}

function walkBlockLineBoxes(
  block: LayoutBlock,
  blockIndex: number,
  offsetX: number,
  offsetY: number,
  state: LineTraversalState,
  callback: (entry: TraversedLineBox) => boolean | undefined,
): boolean {
  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;

  for (const child of block.children) {
    if (child.type === 'line-box') {
      const lineIndex = state.lineIndex++;
      const shouldStop = callback({
        blockIndex,
        lineIndex,
        lineBox: child,
        originX: blockX + child.bounds.x,
        originY: blockY + child.bounds.y,
      });
      if (shouldStop) return true;
      continue;
    }
    if (child.type === 'layout-block') {
      if (walkBlockLineBoxes(child, blockIndex, blockX, blockY, state, callback)) return true;
    }
  }

  return false;
}
