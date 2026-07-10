import type { LayoutBlock, Page, Spread } from '../../layout/core/types';

export function collectPageImageSources(page: Page): readonly string[] {
  const sources = new Set<string>();
  for (const block of page.content) collectBlockImageSources(block, sources);
  return [...sources];
}

export function collectSpreadImageSources(spread: Spread): readonly string[] {
  const sources = new Set<string>();
  if (spread.left) collectPageSources(spread.left, sources);
  if (spread.right) collectPageSources(spread.right, sources);
  return [...sources];
}

function collectPageSources(page: Page, sources: Set<string>): void {
  for (const block of page.content) collectBlockImageSources(block, sources);
}

function collectBlockImageSources(block: LayoutBlock, sources: Set<string>): void {
  const backgroundImage = block.paint?.background?.image;
  if (backgroundImage) sources.add(backgroundImage);

  for (const child of block.children) {
    if (child.type === 'image') {
      sources.add(child.src);
    } else if (child.type === 'line-box') {
      for (const run of child.runs) {
        if (run.type === 'inline-atom') {
          if (run.imageSrc) sources.add(run.imageSrc);
          if (run.block) collectBlockImageSources(run.block, sources);
        }
      }
    } else if (child.type === 'layout-block') {
      collectBlockImageSources(child, sources);
    }
  }
}
