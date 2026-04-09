import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackageMetadata, Reader, Spread, TocEntry } from 'rito';
import { createReader, type ReaderOptions } from 'rito';
import {
  createController,
  type ControllerOptions,
  type ReaderController,
  type TransitionDriverOptions,
} from '@rito/kit';
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
  useEffect(
    () => () => {
      ctrlRef.current?.dispose();
      readerRef.current?.dispose();
    },
    [],
  );
  const load = useCallback(async (data: ArrayBuffer | PromiseLike<ArrayBuffer>) => {
    const opts = optionsRef.current;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const resolvedData = await data;
      const reader = await createReader(resolvedData, canvasRef.current, opts.reader);
      // Dispose old instances only after the new reader is fully ready —
      // no await gap between dispose and reassignment, so concurrent
      // effects (resize, theme) never see a disposed-but-referenced state.
      ctrlRef.current?.dispose();
      readerRef.current?.dispose();
      readerRef.current = reader;
      const ctrl = createController(reader, canvasRef.current, opts.controller);
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
  const actions = useControllerActions(ctrlRef);
  return { controller: ctrlRef.current, ...state, load, ...actions };
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
