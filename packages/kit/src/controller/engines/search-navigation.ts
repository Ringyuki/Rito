import type { Reader } from 'rito';
import type { SearchResult } from 'rito/search';
import type { createSearchEngine } from 'rito/search';
import type { createNavigation } from '../navigation/index';

export function goToSearchResult(
  result: SearchResult,
  reader: Reader,
  nav: ReturnType<typeof createNavigation>,
): void {
  const spreadIdx = reader.findSpread(result.pageIndex);
  if (spreadIdx !== undefined) nav.goToSpread(spreadIdx);
}

export function navigateToSearchIndex(
  search: ReturnType<typeof createSearchEngine>,
  targetIndex: number,
  reader: Reader,
  nav: ReturnType<typeof createNavigation>,
): void {
  const results = search.getResults();
  if (targetIndex < 0 || targetIndex >= results.length) return;
  const current = search.getActiveIndex();
  const total = results.length;
  if (current === targetIndex) {
    const result = results[targetIndex];
    if (result) goToSearchResult(result, reader, nav);
    return;
  }
  const fwd = (targetIndex - current + total) % total;
  const bwd = (current - targetIndex + total) % total;
  const step = fwd <= bwd ? 1 : -1;
  const move = step === 1 ? () => search.nextResult() : () => search.prevResult();
  let result: SearchResult | undefined;
  const steps = Math.min(fwd, bwd);
  for (let i = 0; i < steps; i++) result = move();
  if (result) goToSearchResult(result, reader, nav);
}
