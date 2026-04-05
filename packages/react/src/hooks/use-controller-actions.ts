import { useCallback, type RefObject } from 'react';
import type { TocEntry } from 'rito';
import type { ReaderController, TransitionOptions } from '@rito/kit';

export interface ControllerActions {
  readonly nextSpread: () => void;
  readonly prevSpread: () => void;
  readonly goToSpread: (index: number) => void;
  readonly navigateToTocEntry: (entry: TocEntry) => void;
  readonly resize: (width: number, height: number) => void;
  readonly setRenderScale: (scale: number) => void;
  readonly setSpreadMode: (mode: 'single' | 'double') => void;
  readonly setTheme: (opts: { backgroundColor?: string; foregroundColor?: string }) => void;
  readonly setTypography: (opts: {
    fontSize?: number;
    lineHeight?: number;
    fontFamily?: string;
  }) => boolean;
  readonly configureTransition: (opts: Partial<TransitionOptions>) => void;
}

/** Stable action callbacks that delegate to the current controller ref. */
export function useControllerActions(
  ctrlRef: RefObject<ReaderController | null>,
): ControllerActions {
  return {
    nextSpread: useCallback(() => ctrlRef.current?.nextSpread(), []),
    prevSpread: useCallback(() => ctrlRef.current?.prevSpread(), []),
    goToSpread: useCallback((i: number) => ctrlRef.current?.goToSpread(i), []),
    navigateToTocEntry: useCallback((e: TocEntry) => ctrlRef.current?.navigateToTocEntry(e), []),
    resize: useCallback((w: number, h: number) => ctrlRef.current?.resize(w, h), []),
    setRenderScale: useCallback((s: number) => ctrlRef.current?.setRenderScale(s), []),
    setSpreadMode: useCallback((m: 'single' | 'double') => ctrlRef.current?.setSpreadMode(m), []),
    setTheme: useCallback(
      (o: { backgroundColor?: string; foregroundColor?: string }) => ctrlRef.current?.setTheme(o),
      [],
    ),
    setTypography: useCallback(
      (o: { fontSize?: number; lineHeight?: number; fontFamily?: string }) =>
        ctrlRef.current?.setTypography(o) ?? false,
      [],
    ),
    configureTransition: useCallback(
      (o: Partial<TransitionOptions>) => ctrlRef.current?.configureTransition(o),
      [],
    ),
  };
}
