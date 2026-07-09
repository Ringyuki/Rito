import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackageMetadata, Spread, TocEntry } from '@ritojs/core';
import {
  createReader,
  type Reader,
  type ReaderOptions,
  type ReaderThemeOptions,
} from '@ritojs/core/web';
import {
  createController,
  type ControllerOptions,
  type ReaderController,
  type TransitionDriverOptions,
} from '@ritojs/kit';
import { useControllerActions } from './use-controller-actions';

export interface UseRitoReaderOptions {
  readonly reader: ReaderOptions;
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
  readonly load: (data: ArrayBuffer | PromiseLike<ArrayBuffer>) => Promise<void>;
  readonly nextSpread: () => void;
  readonly prevSpread: () => void;
  readonly goToSpread: (index: number) => void;
  readonly navigateToTocEntry: (entry: TocEntry) => void;
  readonly resize: (width: number, height: number, margin?: number) => void;
  readonly setRenderScale: (scale: number) => void;
  readonly setSpreadMode: (mode: 'single' | 'double') => void;
  readonly setLineBreaking: (lineBreaking: 'greedy' | 'optimal') => boolean;
  readonly setTheme: (opts: ReaderThemeOptions) => void;
  readonly setTypography: (opts: {
    fontSize?: number | null;
    lineHeight?: number | null;
    lineHeightForce?: boolean;
    fontFamily?: string | null;
    fontFamilyForce?: boolean;
  }) => boolean;
  readonly configureTransition: (opts: Partial<TransitionDriverOptions>) => void;
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

interface LoadedReaderStack {
  readonly reader: Reader;
  readonly ctrl: ReaderController;
}

interface RefBox<T> {
  current: T;
}

interface ReaderRefs {
  readonly canvasRef: RefBox<HTMLCanvasElement | null>;
  readonly readerRef: RefBox<Reader | null>;
  readonly ctrlRef: RefBox<ReaderController | null>;
  readonly detachEventsRef: RefBox<(() => void) | null>;
  readonly loadRequestIdRef: RefBox<number>;
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
 * Full-lifecycle hook for the Rito reader stack.
 * Handles canvas creation, Reader + Controller instantiation, event sync, and cleanup.
 */
export function useRitoReader(options: UseRitoReaderOptions): RitoReaderState & RitoReaderActions {
  const refs = useReaderRefs();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState(INITIAL);
  const disposeCurrent = useReaderLifecycle(refs);

  const load = useCallback(
    async (data: ArrayBuffer | PromiseLike<ArrayBuffer>) => {
      const requestId = ++refs.loadRequestIdRef.current;
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const loaded = await loadReaderStack(
          data,
          requestId,
          optionsRef.current,
          refs.canvasRef,
          refs.loadRequestIdRef,
        );
        if (!loaded) return;
        disposeCurrent();
        refs.readerRef.current = loaded.reader;
        refs.ctrlRef.current = loaded.ctrl;
        refs.detachEventsRef.current = subscribeEvents(loaded.ctrl, setState);
        setState(createLoadedState(loaded.reader));
      } catch (err) {
        if (requestId !== refs.loadRequestIdRef.current) return;
        setState((s) => ({ ...s, isLoading: false, error: getErrorMessage(err) }));
      }
    },
    [
      disposeCurrent,
      refs.canvasRef,
      refs.ctrlRef,
      refs.detachEventsRef,
      refs.loadRequestIdRef,
      refs.readerRef,
    ],
  );
  const actions = useControllerActions(refs.ctrlRef);
  return { controller: refs.ctrlRef.current, ...state, load, ...actions };
}

function useReaderRefs(): ReaderRefs {
  return {
    canvasRef: useRef<HTMLCanvasElement | null>(null),
    readerRef: useRef<Reader | null>(null),
    ctrlRef: useRef<ReaderController | null>(null),
    detachEventsRef: useRef<(() => void) | null>(null),
    loadRequestIdRef: useRef(0),
  };
}

function useReaderLifecycle(refs: ReaderRefs): () => void {
  const detachEvents = useCallback((): void => {
    refs.detachEventsRef.current?.();
    refs.detachEventsRef.current = null;
  }, [refs.detachEventsRef]);

  const disposeCurrent = useCallback((): void => {
    detachEvents();
    refs.ctrlRef.current?.dispose();
    refs.readerRef.current?.dispose();
    refs.ctrlRef.current = null;
    refs.readerRef.current = null;
  }, [detachEvents, refs.ctrlRef, refs.readerRef]);

  useEffect(
    () => () => {
      refs.loadRequestIdRef.current++;
      disposeCurrent();
    },
    [disposeCurrent, refs.loadRequestIdRef],
  );
  return disposeCurrent;
}

async function loadReaderStack(
  data: ArrayBuffer | PromiseLike<ArrayBuffer>,
  requestId: number,
  opts: UseRitoReaderOptions,
  canvasRef: { current: HTMLCanvasElement | null },
  loadRequestIdRef: { readonly current: number },
): Promise<LoadedReaderStack | null> {
  const resolvedData = await data;
  if (requestId !== loadRequestIdRef.current) return null;

  const canvas = getOrCreateCanvas(canvasRef);
  if (!canvas) throw new Error('useRitoReader requires a browser document to create a canvas');

  const reader = await createReader(resolvedData, canvas, opts.reader);
  if (requestId !== loadRequestIdRef.current) {
    reader.dispose();
    return null;
  }

  let ctrl: ReaderController;
  try {
    ctrl = createController(reader, canvas, opts.controller);
  } catch (error: unknown) {
    reader.dispose();
    throw error;
  }
  if (requestId !== loadRequestIdRef.current) {
    ctrl.dispose();
    reader.dispose();
    return null;
  }
  return { reader, ctrl };
}

function createLoadedState(reader: Reader): InternalState {
  return {
    isLoaded: true,
    isLoading: false,
    error: null,
    currentSpread: 0,
    totalSpreads: reader.totalSpreads,
    metadata: reader.metadata,
    toc: reader.toc,
    spreads: reader.spreads,
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function subscribeEvents(
  ctrl: ReaderController,
  setState: React.Dispatch<React.SetStateAction<InternalState>>,
): () => void {
  const unsubscribers = [
    ctrl.on('spreadChange', ({ spreadIndex }) => {
      setState((s) => ({ ...s, currentSpread: spreadIndex }));
    }),
    ctrl.on('layoutChange', ({ spreads, totalSpreads }) => {
      setState((s) => ({ ...s, spreads, totalSpreads }));
    }),
    ctrl.on('error', ({ message }) => {
      setState((s) => ({ ...s, error: message }));
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

function getOrCreateCanvas(canvasRef: {
  current: HTMLCanvasElement | null;
}): HTMLCanvasElement | null {
  if (canvasRef.current) return canvasRef.current;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvasRef.current = canvas;
  return canvas;
}
