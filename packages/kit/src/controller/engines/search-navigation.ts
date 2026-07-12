import type { Reader } from '@ritojs/core';
import type { SearchResult } from '../../interaction/index';
import type { createSearchEngine } from '../../interaction/index';
import type { createNavigation } from '../navigation/index';

export interface SearchNavDeps {
  reader: Reader;
  nav: ReturnType<typeof createNavigation>;
  getCurrentSpread: () => number;
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
    const outcome = deps.nav.jumpToSpreadIfReady(spreadIdx);
    if (outcome === 'not-ready') deps.nav.goToSpread(spreadIdx);
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
