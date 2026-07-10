import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reader } from '@ritojs/core';
import type { ReaderController } from '@ritojs/kit';
import { useControllerActions } from './use-controller-actions';
import { useReaderLoader } from './use-rito-reader-loader';
import { INITIAL, type ReaderRefs, type RitoReaderActions } from './use-rito-reader-model';
import type { RitoReaderState, UseRitoReaderOptions } from './use-rito-reader-model';

export type {
  RitoReaderActions,
  RitoReaderState,
  UseRitoReaderOptions,
} from './use-rito-reader-model';

/** Own the full Reader + Controller lifecycle for one React component. */
export function useRitoReader(options: UseRitoReaderOptions): RitoReaderState & RitoReaderActions {
  const refs = useReaderRefs();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState(INITIAL);
  const disposeCurrent = useReaderLifecycle(refs);
  const load = useReaderLoader(refs, optionsRef, setState, disposeCurrent);
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
