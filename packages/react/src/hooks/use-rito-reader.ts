import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PackageMetadata, Spread, TocEntry } from 'rito';
import {
  createReaderController,
  type ReaderController,
  type ReaderControllerOptions,
  type TransitionOptions,
} from '@rito/kit';
import { useControllerEvent } from '../utils/use-controller-event';

export interface UseRitoReaderOptions extends ReaderControllerOptions {
  readonly data?: ArrayBuffer | null | undefined;
  readonly restorePosition?: boolean | undefined;
}

export interface RitoReaderState {
  readonly controller: ReaderController | null;
  readonly isLoaded: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly currentSpread: number;
  readonly totalSpreads: number;
  readonly metadata: PackageMetadata | null;
  readonly toc: readonly TocEntry[];
  readonly spreads: readonly Spread[];
}

export interface RitoReaderActions {
  readonly load: (data: ArrayBuffer) => Promise<void>;
  readonly nextSpread: () => void;
  readonly prevSpread: () => void;
  readonly goToSpread: (index: number) => void;
  readonly navigateToTocEntry: (entry: TocEntry) => void;
  readonly resize: (width: number, height: number) => void;
  readonly setSpreadMode: (mode: 'single' | 'double') => void;
  readonly setTheme: (opts: { backgroundColor?: string; foregroundColor?: string }) => void;
  readonly setTypography: (opts: {
    fontSize?: number;
    lineHeight?: number;
    fontFamily?: string;
  }) => boolean;
  readonly configureTransition: (opts: Partial<TransitionOptions>) => void;
}

interface InternalState {
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  currentSpread: number;
  totalSpreads: number;
  metadata: PackageMetadata | null;
  toc: readonly TocEntry[];
  spreads: readonly Spread[];
}

const INITIAL_STATE: InternalState = {
  isLoaded: false,
  isLoading: false,
  error: null,
  currentSpread: 0,
  totalSpreads: 0,
  metadata: null,
  toc: [],
  spreads: [],
};

export function useRitoReader(
  containerRef: RefObject<HTMLElement | null>,
  options: UseRitoReaderOptions,
): RitoReaderState & RitoReaderActions {
  const ctrlRef = useRef<ReaderController | null>(null);
  const [state, setState] = useState(INITIAL_STATE);

  // Create controller once
  useEffect(() => {
    const ctrl = createReaderController(options);
    ctrlRef.current = ctrl;
    const container = containerRef.current;
    if (container) ctrl.mount(container);
    return () => {
      ctrl.dispose();
      ctrlRef.current = null;
    };
  }, []);

  // Mount when container becomes available
  useEffect(() => {
    const container = containerRef.current;
    const ctrl = ctrlRef.current;
    if (container && ctrl) ctrl.mount(container);
  }, [containerRef]);

  // Auto-load data
  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl || !options.data) return;
    void ctrl.load(options.data).then(() => {
      if (options.restorePosition !== false) {
        const idx = ctrl.restorePosition();
        if (idx !== undefined) ctrl.goToSpread(idx);
      }
    });
  }, [options.data, options.restorePosition]);

  // Sync state from events
  useControllerEvent(ctrlRef.current, 'loadStart', () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
  });

  useControllerEvent(ctrlRef.current, 'loadEnd', ({ success, error }) => {
    const ctrl = ctrlRef.current;
    setState((s) => ({
      ...s,
      isLoading: false,
      isLoaded: success,
      error: error ?? null,
      metadata: ctrl?.metadata ?? null,
      toc: ctrl?.toc ?? [],
      spreads: ctrl?.spreads ?? [],
      totalSpreads: ctrl?.totalSpreads ?? 0,
    }));
  });

  useControllerEvent(ctrlRef.current, 'spreadChange', ({ spreadIndex }) => {
    setState((s) => ({ ...s, currentSpread: spreadIndex }));
  });

  useControllerEvent(ctrlRef.current, 'layoutChange', ({ spreads, totalSpreads }) => {
    setState((s) => ({ ...s, spreads, totalSpreads }));
  });

  useControllerEvent(ctrlRef.current, 'error', ({ message }) => {
    setState((s) => ({ ...s, error: message }));
  });

  // Stable action callbacks
  const load = useCallback(async (data: ArrayBuffer) => {
    await ctrlRef.current?.load(data);
  }, []);
  const nextSpread = useCallback(() => {
    ctrlRef.current?.nextSpread();
  }, []);
  const prevSpread = useCallback(() => {
    ctrlRef.current?.prevSpread();
  }, []);
  const goToSpread = useCallback((i: number) => {
    ctrlRef.current?.goToSpread(i);
  }, []);
  const navigateToTocEntry = useCallback((e: TocEntry) => {
    ctrlRef.current?.navigateToTocEntry(e);
  }, []);
  const resize = useCallback((w: number, h: number) => {
    ctrlRef.current?.resize(w, h);
  }, []);
  const setSpreadMode = useCallback((m: 'single' | 'double') => {
    ctrlRef.current?.setSpreadMode(m);
  }, []);
  const setTheme = useCallback((o: { backgroundColor?: string; foregroundColor?: string }) => {
    ctrlRef.current?.setTheme(o);
  }, []);
  const setTypography = useCallback(
    (o: { fontSize?: number; lineHeight?: number; fontFamily?: string }) =>
      ctrlRef.current?.setTypography(o) ?? false,
    [],
  );
  const configureTransition = useCallback((o: Partial<TransitionOptions>) => {
    ctrlRef.current?.configureTransition(o);
  }, []);

  return {
    controller: ctrlRef.current,
    ...state,
    load,
    nextSpread,
    prevSpread,
    goToSpread,
    navigateToTocEntry,
    resize,
    setSpreadMode,
    setTheme,
    setTypography,
    configureTransition,
  };
}
