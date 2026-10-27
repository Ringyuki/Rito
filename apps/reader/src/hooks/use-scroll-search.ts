import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reader, SearchOptions, SearchResult } from '@ritojs/core';
import type { ScrollController } from '@ritojs/kit';

/** The search result the reader is on, drawn over the text of a scrolled view. */
const ACTIVE_COLOR = 'rgba(249, 115, 22, 0.6)';

interface ScrolledBook {
  readonly controller: ScrollController | null;
  readonly reader: Reader | null;
}

/**
 * Search in the book read scrolled, shaped as the paged reader's search: the
 * reader's own search, the result the reader is on shown at the reading
 * line and highlighted over its window.
 */
export function useScrollSearch({ controller, reader }: ScrolledBook) {
  const [query, setQueryState] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const asked = useRef(0);
  const setQuery = useCallback(
    (next: string, options?: SearchOptions) => {
      setQueryState(next);
      const request = ++asked.current;
      if (!reader?.search || next.length === 0) {
        setResults([]);
        setActiveIndex(-1);
        return;
      }
      void Promise.resolve(reader.search(next, options)).then((found) => {
        if (request !== asked.current) return;
        setResults(found);
        setActiveIndex(found.length > 0 ? 0 : -1);
      });
    },
    [reader],
  );
  const goTo = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);
  const step = useCallback(
    (by: number) => {
      if (results.length === 0) return;
      setActiveIndex((index) => (index + by + results.length) % results.length);
    },
    [results.length],
  );
  const clear = useCallback(() => {
    asked.current += 1;
    setQueryState('');
    setResults([]);
    setActiveIndex(-1);
  }, []);
  useActiveResult(controller, reader, results[activeIndex]);
  return {
    query,
    results,
    activeIndex,
    activeResult: results[activeIndex],
    isActive: results.length > 0,
    setQuery,
    next: useCallback(() => {
      step(1);
    }, [step]),
    prev: useCallback(() => {
      step(-1);
    }, [step]),
    goTo,
    clear,
  };
}

/** Shows the result the reader is on and highlights it; none, nothing. */
function useActiveResult(
  controller: ScrollController | null,
  reader: Reader | null,
  result: SearchResult | undefined,
): void {
  useEffect(() => {
    if (!controller) return;
    const source = result?.source;
    if (source?.status !== 'resolved') {
      controller.setHighlights([]);
      return;
    }
    const { href, sourceRange } = source;
    let current = true;
    void controller.scrollToLocator({ href, sourceRange });
    void reader?.interactions?.resolveExactSourceRange?.({ href, sourceRange }).then((found) => {
      if (!current || found?.status !== 'resolved') return;
      controller.setHighlights([
        { id: 'search', color: ACTIVE_COLOR, zIndex: 1, rects: found.range.rects },
      ]);
    });
    return () => {
      current = false;
    };
  }, [controller, reader, result]);
}
