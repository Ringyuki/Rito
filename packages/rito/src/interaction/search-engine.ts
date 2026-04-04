/**
 * L1 SearchEngine — stateful full-text search with result navigation.
 */

import type { Page, Rect } from '../layout/core/types';
import type { TextMeasurer } from '../layout/text/text-measurer';
import type { HitMap } from './types';
import {
  buildSearchIndex,
  search as searchIndex,
  type SearchIndex,
  type SearchOptions,
  type SearchResult,
} from './search-index';
import { getSelectionRects } from './selection';

export interface SearchEngine {
  setPages(pages: readonly Page[]): void;
  search(query: string, options?: SearchOptions): void;
  getResults(): readonly SearchResult[];
  getActiveIndex(): number;
  nextResult(): SearchResult | undefined;
  prevResult(): SearchResult | undefined;
  getHighlightRects(pageIndex: number, hitMap: HitMap, measurer: TextMeasurer): readonly Rect[];
  clear(): void;
  onResultsChange(cb: (results: readonly SearchResult[]) => void): () => void;
  onActiveResultChange(cb: (index: number) => void): () => void;
}

interface SearchState {
  index: SearchIndex | undefined;
  results: readonly SearchResult[];
  activeIndex: number;
  resultListeners: Set<(r: readonly SearchResult[]) => void>;
  activeListeners: Set<(i: number) => void>;
}

export function createSearchEngine(): SearchEngine {
  const s: SearchState = {
    index: undefined,
    results: [],
    activeIndex: -1,
    resultListeners: new Set(),
    activeListeners: new Set(),
  };
  return buildSearchEngineApi(s);
}

function notifyResults(s: SearchState): void {
  for (const cb of s.resultListeners) cb(s.results);
}

function notifyActive(s: SearchState): void {
  for (const cb of s.activeListeners) cb(s.activeIndex);
}

function buildSearchEngineApi(s: SearchState): SearchEngine {
  return {
    setPages(pages) {
      s.index = buildSearchIndex(pages);
      if (s.results.length > 0) {
        s.results = [];
        s.activeIndex = -1;
        notifyResults(s);
        notifyActive(s);
      }
    },
    search(query, options) {
      if (!s.index) return;
      s.results = searchIndex(s.index, query, options);
      s.activeIndex = s.results.length > 0 ? 0 : -1;
      notifyResults(s);
      notifyActive(s);
    },
    getResults: () => s.results,
    getActiveIndex: () => s.activeIndex,
    nextResult: () => navigate(s, 1),
    prevResult: () => navigate(s, -1),
    getHighlightRects: (pageIndex, hitMap, measurer) =>
      collectHighlights(s.results, pageIndex, hitMap, measurer),
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

function navigate(s: SearchState, delta: number): SearchResult | undefined {
  if (s.results.length === 0) return undefined;
  s.activeIndex = (s.activeIndex + delta + s.results.length) % s.results.length;
  notifyActive(s);
  return s.results[s.activeIndex];
}

function collectHighlights(
  results: readonly SearchResult[],
  pageIndex: number,
  hitMap: HitMap,
  measurer: TextMeasurer,
): Rect[] {
  const rects: Rect[] = [];
  for (const result of results) {
    if (result.pageIndex !== pageIndex) continue;
    rects.push(...getSelectionRects(hitMap, result.range, measurer));
  }
  return rects;
}
