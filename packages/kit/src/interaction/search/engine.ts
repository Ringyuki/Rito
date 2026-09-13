/**
 * SearchEngine — holds the reader's search results and the active-result cursor.
 * Results are produced by the reader (`reader.search()`); this engine only
 * stores them and navigates between them.
 */

import type { SearchResult } from '@ritojs/core';

export type { SearchOptions, SearchResult } from '@ritojs/core';

export interface SearchEngine {
  setResults(results: readonly SearchResult[]): void;
  getResults(): readonly SearchResult[];
  getActiveIndex(): number;
  nextResult(): SearchResult | undefined;
  prevResult(): SearchResult | undefined;
  clear(): void;
  onResultsChange(cb: (results: readonly SearchResult[]) => void): () => void;
  onActiveResultChange(cb: (index: number) => void): () => void;
}

interface SearchState {
  results: readonly SearchResult[];
  activeIndex: number;
  resultListeners: Set<(r: readonly SearchResult[]) => void>;
  activeListeners: Set<(i: number) => void>;
}

export function createSearchEngine(): SearchEngine {
  const s: SearchState = {
    results: [],
    activeIndex: -1,
    resultListeners: new Set(),
    activeListeners: new Set(),
  };
  return {
    setResults(results) {
      s.results = results;
      s.activeIndex = s.results.length > 0 ? 0 : -1;
      notifyResults(s);
      notifyActive(s);
    },
    getResults: () => s.results,
    getActiveIndex: () => s.activeIndex,
    nextResult: () => navigate(s, 1),
    prevResult: () => navigate(s, -1),
    clear() {
      const had = s.results.length > 0;
      s.results = [];
      s.activeIndex = -1;
      if (had) {
        notifyResults(s);
        notifyActive(s);
      }
    },
    onResultsChange(cb) {
      s.resultListeners.add(cb);
      return () => s.resultListeners.delete(cb);
    },
    onActiveResultChange(cb) {
      s.activeListeners.add(cb);
      return () => s.activeListeners.delete(cb);
    },
  };
}

function notifyResults(s: SearchState): void {
  for (const cb of s.resultListeners) cb(s.results);
}

function notifyActive(s: SearchState): void {
  for (const cb of s.activeListeners) cb(s.activeIndex);
}

function navigate(s: SearchState, delta: number): SearchResult | undefined {
  if (s.results.length === 0) return undefined;
  s.activeIndex = (s.activeIndex + delta + s.results.length) % s.results.length;
  notifyActive(s);
  return s.results[s.activeIndex];
}
