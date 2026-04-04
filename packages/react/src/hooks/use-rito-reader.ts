import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackageMetadata, Reader, Spread, TocEntry } from 'rito';
import { createReader, type ReaderOptions } from 'rito';
import {
  createController,
  type ControllerOptions,
  type ReaderController,
  type TransitionOptions,
} from '@rito/kit';

export interface UseRitoReaderOptions {
  /** Reader options passed to createReader(). */
  readonly reader: ReaderOptions;
  /** Controller options passed to createController(). */
  readonly controller?: ControllerOptions | undefined;
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
  /** Load an EPUB from an ArrayBuffer. Disposes any previous reader. */
  readonly load: (data: ArrayBuffer) => Promise<void>;
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

const INITIAL: InternalState = {
  isLoaded: false,
  isLoading: false,
  error: null,
  currentSpread: 0,
  totalSpreads: 0,
  metadata: null,
  toc: [],
  spreads: [],
};

/**
 * Full-lifecycle hook for rito.
 * Handles canvas creation, Reader + Controller instantiation, event sync, and cleanup.
 */
export function useRitoReader(options: UseRitoReaderOptions): RitoReaderState & RitoReaderActions {
  const canvasRef = useRef(document.createElement('canvas'));
  const readerRef = useRef<Reader | null>(null);
  const ctrlRef = useRef<ReaderController | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState(INITIAL);

  // Cleanup on unmount
  useEffect(
    () => () => {
      ctrlRef.current?.dispose();
      readerRef.current?.dispose();
    },
    [],
  );

  // Load
  const load = useCallback(async (data: ArrayBuffer) => {
    const opts = optionsRef.current;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      ctrlRef.current?.dispose();
      readerRef.current?.dispose();

      const reader = await createReader(data, canvasRef.current, opts.reader);
      readerRef.current = reader;

      // Forward margin/spreadGap from reader options so the user doesn't have to pass them twice
      const ctrl = createController(reader, canvasRef.current, {
        ...opts.controller,
        margin: opts.controller?.margin ?? opts.reader.margin,
        spreadGap: opts.controller?.spreadGap ?? opts.reader.spreadGap,
      });
      ctrlRef.current = ctrl;
      subscribeEvents(ctrl, setState);

      setState({
        isLoaded: true,
        isLoading: false,
        error: null,
        currentSpread: 0,
        totalSpreads: reader.totalSpreads,
        metadata: reader.metadata,
        toc: reader.toc,
        spreads: reader.spreads,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  // Actions — stable callbacks that delegate to current controller
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
  const setRenderScale = useCallback((s: number) => {
    ctrlRef.current?.setRenderScale(s);
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
    setRenderScale,
    setSpreadMode,
    setTheme,
    setTypography,
    configureTransition,
  };
}

function subscribeEvents(
  ctrl: ReaderController,
  setState: React.Dispatch<React.SetStateAction<InternalState>>,
): void {
  ctrl.on('spreadChange', ({ spreadIndex }) => {
    setState((s) => ({ ...s, currentSpread: spreadIndex }));
  });
  ctrl.on('layoutChange', ({ spreads, totalSpreads }) => {
    setState((s) => ({ ...s, spreads, totalSpreads }));
  });
  ctrl.on('error', ({ message }) => {
    setState((s) => ({ ...s, error: message }));
  });
}
