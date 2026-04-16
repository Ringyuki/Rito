import type { Reader } from '@ritojs/core';
import type { SearchResult } from '@ritojs/core/search';
import type { createSearchEngine } from '@ritojs/core/search';
import type { createNavigation } from '../navigation/index';
import type { PageBufferPool, ContentRenderer } from '../../painter/buffer-pool';
import type { FrameDriver } from '../../driver/frame-driver';

export interface SearchNavDeps {
  reader: Reader;
  nav: ReturnType<typeof createNavigation>;
  pool: PageBufferPool;
  frameDriver: FrameDriver;
  contentRenderer: ContentRenderer;
  getCurrentSpread: () => number;
  setCurrentSpread: (idx: number) => void;
}

export function goToSearchResult(result: SearchResult, deps: SearchNavDeps): void {
  const spreadIdx = deps.reader.findSpread(result.pageIndex);
  if (spreadIdx === undefined) return;

  const curr = deps.getCurrentSpread();
  const distance = Math.abs(spreadIdx - curr);

  if (distance <= 2) {
    // Close — animate normally
    deps.nav.goToSpread(spreadIdx);
  } else {
    // Far jump — skip animation, snap directly
    deps.pool.jump(spreadIdx);
    deps.pool.ensureContent('curr', deps.contentRenderer);
    deps.setCurrentSpread(spreadIdx);
    deps.reader.notifyActiveSpread(spreadIdx);
    deps.frameDriver.scheduleComposite();
  }
}

export function navigateToSearchIndex(
  search: ReturnType<typeof createSearchEngine>,
  targetIndex: number,
  deps: SearchNavDeps,
): void {
  const results = search.getResults();
  if (targetIndex < 0 || targetIndex >= results.length) return;
  const current = search.getActiveIndex();
  const total = results.length;
  if (current === targetIndex) {
    const result = results[targetIndex];
    if (result) goToSearchResult(result, deps);
    return;
  }
  const fwd = (targetIndex - current + total) % total;
  const bwd = (current - targetIndex + total) % total;
  const step = fwd <= bwd ? 1 : -1;
  const move = step === 1 ? () => search.nextResult() : () => search.prevResult();
  let result: SearchResult | undefined;
  const steps = Math.min(fwd, bwd);
  for (let i = 0; i < steps; i++) result = move();
  if (result) goToSearchResult(result, deps);
}
