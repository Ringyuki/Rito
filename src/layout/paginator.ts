import type { LayoutBlock, LayoutConfig, LineBox, Page } from './types';

/**
 * Split a continuous flow of layout blocks into pages.
 *
 * Blocks are placed on pages top-to-bottom. When a block doesn't fit:
 * - If it contains LineBox children, split at a LineBox boundary.
 * - Otherwise, move it to the next page.
 * - If a block is taller than the content area, place it on its own page (overflow).
 */
export function paginateBlocks(
  blocks: readonly LayoutBlock[],
  config: LayoutConfig,
): readonly Page[] {
  const contentHeight = config.pageHeight - config.marginTop - config.marginBottom;
  const state = createPaginationState(config);

  for (const block of blocks) {
    placeBlock(block, contentHeight, state);
  }

  if (state.pageBlocks.length > 0) {
    emitPage(state);
  }

  return state.pages;
}

interface PaginationState {
  pages: Page[];
  pageBlocks: LayoutBlock[];
  usedHeight: number;
  config: LayoutConfig;
}

function createPaginationState(config: LayoutConfig): PaginationState {
  return { pages: [], pageBlocks: [], usedHeight: 0, config };
}

function emitPage(state: PaginationState): void {
  state.pages.push(buildPage(state.pages.length, state.pageBlocks, state.config));
  state.pageBlocks = [];
  state.usedHeight = 0;
}

function placeBlock(block: LayoutBlock, contentHeight: number, state: PaginationState): void {
  if (state.usedHeight + block.bounds.height <= contentHeight) {
    state.pageBlocks.push(repositionBlock(block, state.usedHeight));
    state.usedHeight += block.bounds.height;
    return;
  }

  if (state.pageBlocks.length > 0) {
    placeBlockOnFullPage(block, contentHeight, state);
  } else {
    placeOversizedBlock(block, contentHeight, state);
  }
}

/** Current page has content — try splitting first, otherwise start new page. */
function placeBlockOnFullPage(
  block: LayoutBlock,
  contentHeight: number,
  state: PaginationState,
): void {
  const remaining = contentHeight - state.usedHeight;
  const split = trySplitBlock(block, remaining);

  if (split) {
    state.pageBlocks.push(repositionBlock(split.head, state.usedHeight));
    emitPage(state);
    placeBlock(split.tail, contentHeight, state);
  } else {
    emitPage(state);
    placeBlock(block, contentHeight, state);
  }
}

/** Block is taller than the page — split if possible, otherwise overflow. */
function placeOversizedBlock(
  block: LayoutBlock,
  contentHeight: number,
  state: PaginationState,
): void {
  const split = trySplitBlock(block, contentHeight);

  if (split) {
    state.pageBlocks.push(repositionBlock(split.head, 0));
    emitPage(state);
    placeBlock(split.tail, contentHeight, state);
  } else {
    state.pageBlocks.push(repositionBlock(block, 0));
    emitPage(state);
  }
}

interface SplitResult {
  readonly head: LayoutBlock;
  readonly tail: LayoutBlock;
}

/** Try to split a block at a LineBox boundary to fit within availableHeight. */
function trySplitBlock(block: LayoutBlock, availableHeight: number): SplitResult | undefined {
  if (!block.children.every((c): c is LineBox => c.type === 'line-box')) {
    return undefined;
  }

  const lineBoxes = block.children;
  if (lineBoxes.length < 2) return undefined;

  const splitIndex = findSplitIndex(lineBoxes, availableHeight);
  if (splitIndex === 0 || splitIndex >= lineBoxes.length) return undefined;

  return buildSplitResult(block, lineBoxes, splitIndex);
}

function findSplitIndex(lineBoxes: readonly LineBox[], availableHeight: number): number {
  let splitIndex = 0;
  for (let i = 0; i < lineBoxes.length; i++) {
    const lb = lineBoxes[i];
    if (!lb || lb.bounds.y + lb.bounds.height > availableHeight) break;
    splitIndex = i + 1;
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

/** Reposition line boxes so they start at y=0. */
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

function repositionBlock(block: LayoutBlock, newY: number): LayoutBlock {
  return { ...block, bounds: { ...block.bounds, y: newY } };
}

function computeLinesHeight(lines: readonly LineBox[]): number {
  if (lines.length === 0) return 0;
  const last = lines[lines.length - 1];
  if (!last) return 0;
  return last.bounds.y + last.bounds.height;
}

function buildPage(index: number, blocks: readonly LayoutBlock[], config: LayoutConfig): Page {
  return {
    index,
    bounds: { x: 0, y: 0, width: config.pageWidth, height: config.pageHeight },
    content: blocks,
  };
}
