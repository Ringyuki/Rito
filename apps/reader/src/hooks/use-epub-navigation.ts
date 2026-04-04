import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Reader, TocEntry } from 'rito';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, type EpubState } from './epub-shared';
import type { DrawSpread } from './use-epub-controller';

interface EpubNavigationOptions {
  readonly readerRef: RefObject<Reader | null>;
  readonly setState: Dispatch<SetStateAction<EpubState>>;
  readonly draw: DrawSpread;
}

export function useEpubNavigation({ readerRef, setState, draw }: EpubNavigationOptions) {
  const goToSpread = useCallback(
    (index: number) => {
      const reader = readerRef.current;
      if (!reader) return;
      setState((state) => {
        if (index < 0 || index >= state.spreads.length) return state;
        draw(reader, index, state.fontScale);
        return { ...state, currentSpread: index };
      });
    },
    [draw, readerRef, setState],
  );

  const nextSpread = useCallback(() => {
    setState((state) => {
      const reader = readerRef.current;
      if (!reader || state.currentSpread >= state.spreads.length - 1) return state;
      const next = state.currentSpread + 1;
      draw(reader, next, state.fontScale);
      return { ...state, currentSpread: next };
    });
  }, [draw, readerRef, setState]);

  const prevSpread = useCallback(() => {
    setState((state) => {
      const reader = readerRef.current;
      if (!reader || state.currentSpread <= 0) return state;
      const prev = state.currentSpread - 1;
      draw(reader, prev, state.fontScale);
      return { ...state, currentSpread: prev };
    });
  }, [draw, readerRef, setState]);

  const toggleSpreadMode = useCallback(() => {
    setState((state) => ({
      ...state,
      spreadMode: state.spreadMode === 'single' ? 'double' : 'single',
    }));
  }, [setState]);

  const navigateToTocEntry = useCallback(
    (entry: TocEntry) => {
      const reader = readerRef.current;
      if (!reader) return;
      const location = reader.resolveTocEntry(entry);
      if (!location) return;

      setState((state) => {
        draw(reader, location.spreadIndex, state.fontScale);
        return { ...state, currentSpread: location.spreadIndex };
      });
    },
    [draw, readerRef, setState],
  );

  const increaseFontSize = useCallback(() => {
    setState((state) => ({
      ...state,
      fontScale: Math.min(state.fontScale + FONT_SCALE_STEP, FONT_SCALE_MAX),
    }));
  }, [setState]);

  const decreaseFontSize = useCallback(() => {
    setState((state) => ({
      ...state,
      fontScale: Math.max(state.fontScale - FONT_SCALE_STEP, FONT_SCALE_MIN),
    }));
  }, [setState]);

  return {
    goToSpread,
    nextSpread,
    prevSpread,
    toggleSpreadMode,
    navigateToTocEntry,
    increaseFontSize,
    decreaseFontSize,
  };
}
