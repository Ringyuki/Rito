import type { SearchResult } from '../../interaction/index';
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
  _runtime: RuntimeComponents,
): SearchActionsSlice {
  const searchNavDeps = createSearchNavDeps(internals, nav);
  const searchState = { serial: 0 };

  return {
    search(q: string): void {
      runSearch(q, internals, emitter, searchState);
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

function runSearch(q: string, internals: Internals, emitter: Emitter, state: SearchState): void {
  if (!internals.coordState.nativeInteractionsAlive) return;
  state.serial += 1;
  if (typeof internals.reader.search !== 'function') {
    internals.engines.search.search(q);
    return;
  }
  const search = internals.reader.search.bind(internals.reader);
  if (q.length === 0) {
    internals.engines.search.clear();
    return;
  }
  const serial = state.serial;
  void Promise.resolve()
    .then(() => search(q))
    .then(
      (results) => {
        if (!ownsSearch(serial, internals, state)) return;
        publishSearchResults(results, internals, emitter);
      },
      (error: unknown) => {
        if (!ownsSearch(serial, internals, state)) return;
        reportSearchError(error, 'reader-search', emitter);
        publishSearchResults([], internals, emitter);
      },
    );
}

function ownsSearch(serial: number, internals: Internals, state: SearchState): boolean {
  return serial === state.serial && internals.coordState.nativeInteractionsAlive;
}

function publishSearchResults(
  results: readonly SearchResult[],
  internals: Internals,
  emitter: Emitter,
): void {
  try {
    internals.engines.search.setResults(results);
  } catch (error: unknown) {
    reportSearchError(error, 'reader-search-publication', emitter);
  }
}

function reportSearchError(error: unknown, source: string, emitter: Emitter): void {
  try {
    emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source,
    });
  } catch {
    // Consumer listeners must not turn a search read or publication into an unhandled rejection.
  }
}

function clearSearch(internals: Internals, state: SearchState): void {
  if (!internals.coordState.nativeInteractionsAlive) return;
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
