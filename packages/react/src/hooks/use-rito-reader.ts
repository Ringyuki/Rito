import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackageMetadata, Reader, Spread, TocEntry } from '@ritojs/core';
import { createReader, type ReaderOptions } from '@ritojs/core';
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
  readonly setTheme: (opts: { backgroundColor?: string; foregroundColor?: string }) => void;
  readonly setTypography: (opts: {
    fontSize?: number;
    lineHeight?: number;
    fontFamily?: string;
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readerRef = useRef<Reader | null>(null);
  const ctrlRef = useRef<ReaderController | null>(null);
  const detachEventsRef = useRef<(() => void) | null>(null);
  const loadRequestIdRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState(INITIAL);

  const detachEvents = useCallback((): void => {
    detachEventsRef.current?.();
    detachEventsRef.current = null;
  }, []);

  const disposeCurrent = useCallback((): void => {
    detachEvents();
    ctrlRef.current?.dispose();
    readerRef.current?.dispose();
    ctrlRef.current = null;
    readerRef.current = null;
  }, [detachEvents]);

  useEffect(
    () => () => {
      loadRequestIdRef.current++;
      disposeCurrent();
    },
    [disposeCurrent],
  );

  const load = useCallback(
    async (data: ArrayBuffer | PromiseLike<ArrayBuffer>) => {
      const requestId = ++loadRequestIdRef.current;
      const opts = optionsRef.current;
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const resolvedData = await data;
        if (requestId !== loadRequestIdRef.current) return;

        const canvas = getOrCreateCanvas(canvasRef);
        if (!canvas) {
          throw new Error('useRitoReader requires a browser document to create a canvas');
        }

        const reader = await createReader(resolvedData, canvas, opts.reader);
        if (requestId !== loadRequestIdRef.current) {
          reader.dispose();
          return;
        }

        const ctrl = createController(reader, canvas, opts.controller);
        if (requestId !== loadRequestIdRef.current) {
          ctrl.dispose();
          reader.dispose();
          return;
        }

        disposeCurrent();
        readerRef.current = reader;
        ctrlRef.current = ctrl;
        detachEventsRef.current = subscribeEvents(ctrl, setState);
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
        if (requestId !== loadRequestIdRef.current) return;
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [disposeCurrent],
  );
  const actions = useControllerActions(ctrlRef);
  return { controller: ctrlRef.current, ...state, load, ...actions };
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
