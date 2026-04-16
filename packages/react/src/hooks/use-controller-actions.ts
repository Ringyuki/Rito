import { useCallback, type RefObject } from 'react';
import type { TocEntry } from '@ritojs/core';
import type { ReaderController, TransitionDriverOptions } from '@ritojs/kit';

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
  readonly configureTransition: (opts: Partial<TransitionDriverOptions>) => void;
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
    resize: useCallback((w: number, h: number, m?: number) => ctrlRef.current?.resize(w, h, m), []),
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
      (o: Partial<TransitionDriverOptions>) => ctrlRef.current?.configureTransition(o),
      [],
    ),
  };
}
