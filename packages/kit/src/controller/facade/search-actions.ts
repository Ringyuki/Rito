import type { SearchResult } from '../../interaction/index';
import {
  goToSearchResult,
  navigateToSearchIndex,
  type SearchNavDeps,
} from '../engines/search-navigation';
import type { Emitter, Internals, Nav, RuntimeComponents, SearchActionsSlice } from './types';

export function buildSearchActions(
  internals: Internals,
  _emitter: Emitter,
  nav: Nav,
  _runtime: RuntimeComponents,
): SearchActionsSlice {
  const searchNavDeps = createSearchNavDeps(internals, nav);
  const searchState = { serial: 0 };

  return {
    search(q: string): void {
      runSearch(q, internals, searchState);
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
      clearSearch(internals, searchState);
    },
    get searchResults() {
      return internals.engines.search.getResults();
    },
    get searchActiveIndex() {
      return internals.engines.search.getActiveIndex();
    },
  };
}

interface SearchState {
  serial: number;
}

function runSearch(q: string, internals: Internals, state: SearchState): void {
  state.serial += 1;
  if (typeof internals.reader.search !== 'function') {
    internals.engines.search.search(q);
    return;
  }
  if (q.length === 0) {
    internals.engines.search.clear();
    return;
  }
  const serial = state.serial;
  void Promise.resolve(internals.reader.search(q))
    .then((results) => {
      if (serial !== state.serial) return;
      internals.engines.search.setResults(results);
    })
    .catch(() => {
      if (serial !== state.serial) return;
      internals.engines.search.setResults([]);
    });
}

function clearSearch(internals: Internals, state: SearchState): void {
  state.serial += 1;
  internals.engines.search.clear();
}

function createSearchNavDeps(internals: Internals, nav: Nav): SearchNavDeps {
  return {
    reader: internals.reader,
    nav,
    getCurrentSpread: () => internals.currentSpread,
  };
}
