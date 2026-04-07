import type { LayoutBlock, LayoutConfig, Page, PaginationPolicy } from '../core/types';
import { createPaginationState, emitPage, type PaginationState } from './state';
import { forceSplitBlock, repositionBlock, trySplitBlock } from './split';

export function paginateBlocks(
  blocks: readonly LayoutBlock[],
  config: LayoutConfig,
): readonly Page[] {
  const policy = config.paginationPolicy;
  const contentHeight = config.pageHeight - config.marginTop - config.marginBottom;
  if (contentHeight <= 0) {
    throw new Error(
      `Invalid layout config: contentHeight is ${String(contentHeight)} (must be > 0)`,
    );
  }

  const state = createPaginationState(config);
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block) continue;

    const spacing = computeSpacing(blocks, index);
    placeBlock(block, spacing, contentHeight, state, policy);
  }

  if (state.pageBlocks.length > 0) {
    emitPage(state);
  }

  return state.pages;
}

function computeSpacing(blocks: readonly LayoutBlock[], index: number): number {
  if (index === 0) return blocks[0]?.bounds.y ?? 0;
  const prev = blocks[index - 1];
  const curr = blocks[index];
  if (!prev || !curr) return 0;
  return curr.bounds.y - (prev.bounds.y + prev.bounds.height);
}

function placeBlock(
  block: LayoutBlock,
  spacing: number,
  contentHeight: number,
  state: PaginationState,
  policy?: PaginationPolicy,
): void {
  if (block.pageBreakBefore && state.pageBlocks.length > 0) {
    emitPage(state);
  }

  const effectiveSpacing = state.pageBlocks.length > 0 ? spacing : 0;
  const totalNeeded = state.usedHeight + effectiveSpacing + block.bounds.height;
  if (totalNeeded <= contentHeight) {
    state.usedHeight += effectiveSpacing;
    state.pageBlocks.push(repositionBlock(block, state.usedHeight));
    state.usedHeight += block.bounds.height;
    if (block.pageBreakAfter) emitPage(state);
    return;
  }

  if (state.pageBlocks.length > 0) {
    placeBlockOnFullPage(block, spacing, contentHeight, state, policy);
  } else {
    placeOversizedBlock(block, contentHeight, state, policy);
  }
}

function placeBlockOnFullPage(
  block: LayoutBlock,
  spacing: number,
  contentHeight: number,
  state: PaginationState,
  policy?: PaginationPolicy,
): void {
  const remaining = contentHeight - state.usedHeight - spacing;
  const split = remaining > 0 ? trySplitBlock(block, remaining, policy) : undefined;

  // No split possible, or head exceeds remaining space → start fresh page
  if (!split || split.head.bounds.height > remaining) {
    // Try force split as fallback before giving up on this page
    const forced = remaining > 0 ? forceSplitBlock(block, remaining) : undefined;
    if (forced && forced.head.bounds.height <= remaining) {
      state.usedHeight += spacing;
      state.pageBlocks.push(repositionBlock(forced.head, state.usedHeight));
      emitPage(state);
      placeBlock(forced.tail, 0, contentHeight, state, policy);
      return;
    }
    emitPage(state);
    placeBlock(block, 0, contentHeight, state, policy);
    return;
  }

  state.usedHeight += spacing;
  state.pageBlocks.push(repositionBlock(split.head, state.usedHeight));
  emitPage(state);
  placeBlock(split.tail, 0, contentHeight, state, policy);
}

function placeOversizedBlock(
  block: LayoutBlock,
  contentHeight: number,
  state: PaginationState,
  policy?: PaginationPolicy,
): void {
  // Try normal split (respects orphan/widow)
  const split = trySplitBlock(block, contentHeight, policy);
  if (split && split.head.bounds.height <= contentHeight) {
    state.pageBlocks.push(repositionBlock(split.head, 0));
    emitPage(state);
    placeBlock(split.tail, 0, contentHeight, state, policy);
    return;
  }

  // Normal split failed or produced oversized head — force split ignoring orphan/widow
  const forced = forceSplitBlock(block, contentHeight);
  if (forced) {
    state.pageBlocks.push(repositionBlock(forced.head, 0));
    emitPage(state);
    placeBlock(forced.tail, 0, contentHeight, state, policy);
    return;
  }

  // Truly unsplittable (no line-box children, or single line taller than page) — emit as-is
  state.pageBlocks.push(repositionBlock(block, 0));
  emitPage(state);
}
