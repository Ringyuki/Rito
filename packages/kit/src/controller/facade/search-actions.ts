import type { SearchResult } from '@ritojs/core/search';
import {
  goToSearchResult,
  navigateToSearchIndex,
  type SearchNavDeps,
} from '../engines/search-navigation';
import type { Emitter, Internals, Nav, RuntimeComponents, SearchActionsSlice } from './types';

export function buildSearchActions(
  internals: Internals,
  emitter: Emitter,
  nav: Nav,
  runtime: RuntimeComponents,
): SearchActionsSlice {
  const searchNavDeps = createSearchNavDeps(internals, emitter, nav, runtime);

  return {
    search(q: string): void {
      internals.engines.search.search(q);
    },
    searchNext(): SearchResult | undefined {
      const result = internals.engines.search.nextResult();
      if (result) goToSearchResult(result, searchNavDeps);
      return result;
    },
    searchPrev(): SearchResult | undefined {
      const result = internals.engines.search.prevResult();
      if (result) goToSearchResult(result, searchNavDeps);
      return result;
    },
    goToSearchResult(targetIndex: number): void {
      navigateToSearchIndex(internals.engines.search, targetIndex, searchNavDeps);
    },
    clearSearch(): void {
      internals.engines.search.clear();
    },
    get searchResults() {
      return internals.engines.search.getResults();
    },
    get searchActiveIndex() {
      return internals.engines.search.getActiveIndex();
    },
  };
}

function createSearchNavDeps(
  internals: Internals,
  emitter: Emitter,
  nav: Nav,
  runtime: RuntimeComponents,
): SearchNavDeps {
  const contentRenderer = (idx: number, ctx: OffscreenCanvasRenderingContext2D): void => {
    internals.reader.renderSpreadTo(idx, ctx);
  };

  return {
    reader: internals.reader,
    nav,
    pool: runtime.pool,
    frameDriver: runtime.frameDriver,
    contentRenderer,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (i) => {
      internals.currentSpread = i;
    },
    emitSpreadChange: (i) => {
      const spread = internals.reader.spreads[i];
      if (spread) emitter.emit('spreadChange', { spreadIndex: i, spread });
    },
  };
}
