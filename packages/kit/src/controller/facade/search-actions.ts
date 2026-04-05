import type { SearchResult } from 'rito/search';
import { goToSearchResult, navigateToSearchIndex } from '../engines/index';
import type { Internals, Nav, SearchActionsSlice } from './types';

export function buildSearchActions(internals: Internals, nav: Nav): SearchActionsSlice {
  return {
    search(q: string): void {
      internals.engines.search.search(q);
    },
    searchNext(): SearchResult | undefined {
      const result = internals.engines.search.nextResult();
      if (result) goToSearchResult(result, internals.reader, nav);
      return result;
    },
    searchPrev(): SearchResult | undefined {
      const result = internals.engines.search.prevResult();
      if (result) goToSearchResult(result, internals.reader, nav);
      return result;
    },
    goToSearchResult(targetIndex: number): void {
      navigateToSearchIndex(internals.engines.search, targetIndex, internals.reader, nav);
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
