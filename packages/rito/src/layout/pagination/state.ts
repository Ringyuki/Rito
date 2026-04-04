import type { LayoutBlock, LayoutConfig, Page } from '../types';

export interface PaginationState {
  pages: Page[];
  pageBlocks: LayoutBlock[];
  usedHeight: number;
  config: LayoutConfig;
}

export function createPaginationState(config: LayoutConfig): PaginationState {
  return { pages: [], pageBlocks: [], usedHeight: 0, config };
}

export function emitPage(state: PaginationState): void {
  state.pages.push(buildPage(state.pages.length, state.pageBlocks, state.config));
  state.pageBlocks = [];
  state.usedHeight = 0;
}

function buildPage(index: number, blocks: readonly LayoutBlock[], config: LayoutConfig): Page {
  return {
    index,
    bounds: { x: 0, y: 0, width: config.pageWidth, height: config.pageHeight },
    content: blocks,
  };
}
