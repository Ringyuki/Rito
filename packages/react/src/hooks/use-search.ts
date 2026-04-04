import { useCallback, useState } from 'react';
import type { ReaderController } from '@rito/kit';
import type { SearchResult } from 'rito/search';
import { useControllerEvent } from '../utils/use-controller-event';

export interface SearchState {
  readonly results: readonly SearchResult[];
  readonly activeIndex: number;
  readonly activeResult: SearchResult | undefined;
  readonly isActive: boolean;
}

export function useSearch(controller: ReaderController | null): SearchState & {
  query: string;
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  clear: () => void;
} {
  const [query, setQueryState] = useState('');
  const [state, setState] = useState<SearchState>({
    results: [],
    activeIndex: -1,
    activeResult: undefined,
    isActive: false,
  });

  useControllerEvent(controller, 'searchResults', ({ results, activeIndex }) => {
    setState({
      results,
      activeIndex,
      activeResult: results[activeIndex],
      isActive: results.length > 0,
    });
  });

  useControllerEvent(controller, 'searchActiveChange', ({ activeIndex, result }) => {
    setState((s) => ({ ...s, activeIndex, activeResult: result }));
  });

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      controller?.search(q);
    },
    [controller],
  );

  const next = useCallback(() => {
    controller?.searchNext();
  }, [controller]);
  const prev = useCallback(() => {
    controller?.searchPrev();
  }, [controller]);
  const clear = useCallback(() => {
    setQueryState('');
    controller?.clearSearch();
    setState({ results: [], activeIndex: -1, activeResult: undefined, isActive: false });
  }, [controller]);

  const goTo = useCallback(
    (index: number) => {
      controller?.goToSearchResult(index);
    },
    [controller],
  );

  return { ...state, query, setQuery, next, prev, goTo, clear };
}
