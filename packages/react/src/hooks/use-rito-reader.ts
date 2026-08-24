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

function useReaderLifecycle(refs: ReaderRefs): () => Promise<void> {
  const disposeTaskRef = useRef(Promise.resolve());
  const disposeCurrent = useCallback(async (): Promise<void> => {
    const detachEvents = refs.detachEventsRef.current;
    const controller = refs.ctrlRef.current;
    const reader = refs.readerRef.current;
    refs.detachEventsRef.current = null;
    refs.ctrlRef.current = null;
    refs.readerRef.current = null;
    if (!detachEvents && !controller && !reader) {
      return disposeTaskRef.current;
    }
    runBestEffortCleanup(detachEvents);
    runBestEffortCleanup(
      controller
        ? () => {
            controller.dispose();
          }
        : undefined,
    );
    const previousTask = disposeTaskRef.current;
    const readerTask = runBestEffortAsyncCleanup(reader ? () => reader.dispose() : undefined);
    disposeTaskRef.current = Promise.all([previousTask, readerTask]).then(() => undefined);
    return disposeTaskRef.current;
  }, [refs.ctrlRef, refs.detachEventsRef, refs.readerRef]);

  useEffect(
    () => () => {
      refs.loadRequestIdRef.current++;
      void disposeCurrent();
    },
    [disposeCurrent, refs.loadRequestIdRef],
  );
  return disposeCurrent;
}

function runBestEffortCleanup(cleanup: (() => void) | null | undefined): void {
  try {
    cleanup?.();
  } catch {
    // One failed cleanup step must not retain the rest of the reader stack.
  }
}

async function runBestEffortAsyncCleanup(
  cleanup: (() => void | Promise<void>) | undefined,
): Promise<void> {
  try {
    await cleanup?.();
  } catch {
    // A rejected release must not block a later reader load.
  }
}
