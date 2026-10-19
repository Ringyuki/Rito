import type { SearchOptions, SearchResult } from '../../interaction/index';
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
  const searchState: SearchState = { serial: 0, query: '', options: undefined };
  internals.coordState.searchResults.refresh = () => {
    if (searchState.query.length === 0) {
      internals.coordState.searchResults.stale = false;
      return;
    }
    runSearch(searchState.query, searchState.options, internals, emitter, searchState);
  };

  return {
    search(q: string, options?: SearchOptions): void {
      runSearch(q, options, internals, emitter, searchState);
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
  /** The query whose results are shown, searched again when the layout is replaced. */
  query: string;
  options: SearchOptions | undefined;
}

function runSearch(
  q: string,
  options: SearchOptions | undefined,
  internals: Internals,
  emitter: Emitter,
  state: SearchState,
): void {
  if (!internals.coordState.nativeInteractionsAlive) return;
  state.serial += 1;
  state.query = q;
  state.options = options;
  const search = internals.reader.search?.bind(internals.reader);
  if (q.length === 0 || !search) {
    internals.coordState.searchResults.stale = false;
    internals.engines.search.clear();
    return;
  }
  const serial = state.serial;
  void Promise.resolve()
    .then(() => search(q, options))
    .then(
      (results) => {
        if (!ownsSearch(serial, internals, state)) return;
        internals.coordState.searchResults.stale = false;
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
  state.query = '';
  state.options = undefined;
  internals.coordState.searchResults.stale = false;
  internals.engines.search.clear();
}

function createSearchNavDeps(internals: Internals, nav: Nav): SearchNavDeps {
  return {
    reader: internals.reader,
    nav,
    getCurrentSpread: () => internals.currentSpread,
    resultsAreStale: () => internals.coordState.searchResults.stale,
  };
}
