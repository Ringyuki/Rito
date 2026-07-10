import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { createReader, type Reader } from '@ritojs/core';
import { createController, type ReaderController } from '@ritojs/kit';
import {
  INITIAL,
  type InternalState,
  type LoadedReaderStack,
  type ReaderRefs,
  type RefBox,
  type UseRitoReaderOptions,
} from './use-rito-reader-model';

const INITIAL_LAYOUT_TIMEOUT_MS = 15_000;
const LOADING_INDICATOR_DELAY_MS = 120;

export function useReaderLoader(
  refs: ReaderRefs,
  optionsRef: RefBox<UseRitoReaderOptions>,
  setState: Dispatch<SetStateAction<InternalState>>,
  disposeCurrent: () => void,
): (data: ArrayBuffer | PromiseLike<ArrayBuffer>) => Promise<void> {
  return useCallback(
    async (data) => {
      const requestId = ++refs.loadRequestIdRef.current;
      const hadVisibleStack = refs.ctrlRef.current !== null || refs.readerRef.current !== null;
      disposeCurrent();
      if (hadVisibleStack) setState(INITIAL);
      const cancelLoadingIndicator = scheduleLoadingIndicator(
        requestId,
        refs.loadRequestIdRef,
        setState,
      );
      try {
        const loaded = await loadReaderStack(
          data,
          requestId,
          optionsRef.current,
          refs.canvasRef,
          refs.loadRequestIdRef,
        );
        if (!loaded) return;
        commitLoadedStack(loaded, refs, setState, cancelLoadingIndicator, disposeCurrent);
      } catch (err) {
        cancelLoadingIndicator();
        if (requestId !== refs.loadRequestIdRef.current) return;
        setState((s) => ({ ...s, isLoading: false, error: getErrorMessage(err) }));
      }
    },
    [
      disposeCurrent,
      optionsRef,
      refs.canvasRef,
      refs.ctrlRef,
      refs.detachEventsRef,
      refs.loadRequestIdRef,
      refs.readerRef,
      setState,
    ],
  );
}

function commitLoadedStack(
  loaded: LoadedReaderStack,
  refs: ReaderRefs,
  setState: Dispatch<SetStateAction<InternalState>>,
  cancelLoadingIndicator: () => void,
  disposeCurrent: () => void,
): void {
  cancelLoadingIndicator();
  disposeCurrent();
  refs.readerRef.current = loaded.reader;
  refs.ctrlRef.current = loaded.ctrl;
  refs.detachEventsRef.current = subscribeEvents(loaded.ctrl, setState);
  setState(createLoadedState(loaded.reader));
}

function scheduleLoadingIndicator(
  requestId: number,
  loadRequestIdRef: RefBox<number>,
  setState: Dispatch<SetStateAction<InternalState>>,
): () => void {
  const timerId = setTimeout(() => {
    if (requestId !== loadRequestIdRef.current) return;
    setState({ ...INITIAL, isLoading: true });
  }, LOADING_INDICATOR_DELAY_MS);
  return () => {
    clearTimeout(timerId);
  };
}

async function loadReaderStack(
  data: ArrayBuffer | PromiseLike<ArrayBuffer>,
  requestId: number,
  opts: UseRitoReaderOptions,
  canvasRef: RefBox<HTMLCanvasElement | null>,
  loadRequestIdRef: RefBox<number>,
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

  await waitForLayoutOrDispose(reader, requestId, loadRequestIdRef);
  return createControllerStack(reader, canvas, opts, requestId, loadRequestIdRef);
}

async function waitForLayoutOrDispose(
  reader: Reader,
  requestId: number,
  loadRequestIdRef: RefBox<number>,
): Promise<void> {
  try {
    await waitForInitialLayout(reader, requestId, loadRequestIdRef);
  } catch (error) {
    reader.dispose();
    throw error;
  }
}

function createControllerStack(
  reader: Reader,
  canvas: HTMLCanvasElement,
  opts: UseRitoReaderOptions,
  requestId: number,
  loadRequestIdRef: RefBox<number>,
): LoadedReaderStack | null {
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
  if (requestId === loadRequestIdRef.current) return { reader, ctrl };
  ctrl.dispose();
  reader.dispose();
  return null;
}

function waitForInitialLayout(
  reader: Reader,
  requestId: number,
  loadRequestIdRef: RefBox<number>,
): Promise<void> {
  if (reader.totalSpreads > 0 || requestId !== loadRequestIdRef.current) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let done = false;
    let unsubscribe = (): void => {};
    const timeoutId = setTimeout(() => {
      finish(new Error('Reader initial layout timed out'));
    }, INITIAL_LAYOUT_TIMEOUT_MS);
    const staleCheckId = setInterval(() => {
      if (requestId !== loadRequestIdRef.current) finish();
    }, 50);
    const finish = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      clearInterval(staleCheckId);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    unsubscribe = reader.onLayoutCommitted(() => {
      if (reader.totalSpreads > 0) finish();
    });
  });
}

function createLoadedState(reader: Reader): InternalState {
  const hasLayout = reader.totalSpreads > 0;
  return {
    isLoaded: hasLayout,
    isLoading: !hasLayout,
    error: null,
    currentSpread: 0,
    totalSpreads: reader.totalSpreads,
    metadata: reader.metadata,
    toc: reader.toc,
    spreads: reader.spreads,
  };
}

function subscribeEvents(
  ctrl: ReaderController,
  setState: Dispatch<SetStateAction<InternalState>>,
): () => void {
  const unsubscribers = [
    ctrl.on('spreadChange', ({ spreadIndex }) => {
      setState((s) => ({ ...s, currentSpread: spreadIndex }));
    }),
    ctrl.on('layoutChange', ({ spreads, totalSpreads }) => {
      const hasLayout = totalSpreads > 0;
      setState((s) => ({
        ...s,
        isLoaded: hasLayout,
        isLoading: !hasLayout,
        spreads,
        totalSpreads,
      }));
    }),
    ctrl.on('error', ({ message }) => {
      setState((s) => ({ ...s, error: message }));
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

function getOrCreateCanvas(canvasRef: RefBox<HTMLCanvasElement | null>): HTMLCanvasElement | null {
  if (canvasRef.current) return canvasRef.current;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvasRef.current = canvas;
  return canvas;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
