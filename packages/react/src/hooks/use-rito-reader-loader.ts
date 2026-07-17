import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { createReader, type Reader } from '@ritojs/core';
import { createController, type ReaderController } from '@ritojs/kit';
import {
  createLoadedState,
  INITIAL,
  type InternalState,
  type LoadedReaderStack,
  type ReaderRefs,
  type RefBox,
  type UseRitoReaderOptions,
} from './use-rito-reader-model';
import { waitForInitialReaderLayout } from './use-rito-reader-layout';
import {
  hydrateInitialPosition,
  loadInitialPosition,
  readerOptionsWithInitialPosition,
  type InitialPositionLoad,
} from './use-rito-reader-position';
import { subscribeReaderControllerEvents } from './use-rito-reader-subscriptions';

const LOADING_INDICATOR_DELAY_MS = 120;

export function useReaderLoader(
  refs: ReaderRefs,
  optionsRef: RefBox<UseRitoReaderOptions>,
  setState: Dispatch<SetStateAction<InternalState>>,
  disposeCurrent: () => Promise<void>,
): (data: ArrayBuffer | PromiseLike<ArrayBuffer>) => Promise<void> {
  const creationTailRef = useRef(Promise.resolve());
  return useCallback(
    (data) => {
      const requestId = ++refs.loadRequestIdRef.current;
      return loadReader(
        data,
        requestId,
        creationTailRef,
        refs,
        optionsRef,
        setState,
        disposeCurrent,
      );
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

async function loadReader(
  data: ArrayBuffer | PromiseLike<ArrayBuffer>,
  requestId: number,
  creationTailRef: RefBox<Promise<void>>,
  refs: ReaderRefs,
  optionsRef: RefBox<UseRitoReaderOptions>,
  setState: Dispatch<SetStateAction<InternalState>>,
  disposeCurrent: () => Promise<void>,
): Promise<void> {
  const hadVisibleStack = refs.ctrlRef.current !== null || refs.readerRef.current !== null;
  const disposeTask = disposeCurrent();
  if (hadVisibleStack) setState(INITIAL);
  const cancelLoadingIndicator = scheduleLoadingIndicator(
    requestId,
    refs.loadRequestIdRef,
    setState,
  );
  try {
    const resolvedData = await data;
    if (requestId !== refs.loadRequestIdRef.current) {
      cancelLoadingIndicator();
      return;
    }
    const options = optionsRef.current;
    const initialPosition = await loadInitialPosition(options);
    if (requestId !== refs.loadRequestIdRef.current) {
      cancelLoadingIndicator();
      return;
    }
    await enqueueReaderCreation(creationTailRef, () =>
      createAndCommitReader(
        resolvedData,
        requestId,
        disposeTask,
        refs,
        options,
        initialPosition,
        setState,
        cancelLoadingIndicator,
        disposeCurrent,
      ),
    );
  } catch (err) {
    cancelLoadingIndicator();
    if (requestId !== refs.loadRequestIdRef.current) return;
    setState((s) => ({ ...s, isLoading: false, error: getErrorMessage(err) }));
  }
}

function enqueueReaderCreation(
  tailRef: RefBox<Promise<void>>,
  operation: () => Promise<void>,
): Promise<void> {
  const task = tailRef.current.catch(() => undefined).then(operation);
  tailRef.current = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function createAndCommitReader(
  data: ArrayBuffer,
  requestId: number,
  disposeTask: Promise<void>,
  refs: ReaderRefs,
  options: UseRitoReaderOptions,
  initialPosition: InitialPositionLoad,
  setState: Dispatch<SetStateAction<InternalState>>,
  cancelLoadingIndicator: () => void,
  disposeCurrent: () => Promise<void>,
): Promise<void> {
  await disposeTask;
  if (requestId !== refs.loadRequestIdRef.current) return;
  const loaded = await loadReaderStack(
    data,
    requestId,
    options,
    initialPosition,
    refs.canvasRef,
    refs.loadRequestIdRef,
  );
  if (!loaded) return;
  await commitLoadedStack(
    loaded,
    requestId,
    refs,
    setState,
    cancelLoadingIndicator,
    disposeCurrent,
  );
}

async function commitLoadedStack(
  loaded: LoadedReaderStack,
  requestId: number,
  refs: ReaderRefs,
  setState: Dispatch<SetStateAction<InternalState>>,
  cancelLoadingIndicator: () => void,
  disposeCurrent: () => Promise<void>,
): Promise<void> {
  cancelLoadingIndicator();
  await disposeCurrent();
  if (requestId !== refs.loadRequestIdRef.current) {
    await disposeLoadedStack(loaded);
    return;
  }
  let detachEvents: (() => void) | undefined;
  try {
    detachEvents = subscribeReaderControllerEvents(loaded.ctrl, setState);
    refs.readerRef.current = loaded.reader;
    refs.ctrlRef.current = loaded.ctrl;
    refs.detachEventsRef.current = detachEvents;
    setState(createLoadedState(loaded.reader, loaded.ctrl));
  } catch (error) {
    detachEvents?.();
    if (refs.readerRef.current === loaded.reader) refs.readerRef.current = null;
    if (refs.ctrlRef.current === loaded.ctrl) refs.ctrlRef.current = null;
    if (refs.detachEventsRef.current === detachEvents) refs.detachEventsRef.current = null;
    await disposeLoadedStack(loaded);
    throw error;
  }
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
  data: ArrayBuffer,
  requestId: number,
  opts: UseRitoReaderOptions,
  initialPosition: InitialPositionLoad,
  canvasRef: RefBox<HTMLCanvasElement | null>,
  loadRequestIdRef: RefBox<number>,
): Promise<LoadedReaderStack | null> {
  const canvas = getOrCreateCanvas(canvasRef);
  if (!canvas) throw new Error('useRitoReader requires a browser document to create a canvas');

  const reader = await createReader(
    data,
    canvas,
    readerOptionsWithInitialPosition(opts.reader, initialPosition),
  );
  if (requestId !== loadRequestIdRef.current) {
    await disposeReader(reader);
    return null;
  }

  await waitForLayoutOrDispose(reader, requestId, loadRequestIdRef);
  return createControllerStack(reader, canvas, opts, initialPosition, requestId, loadRequestIdRef);
}

async function waitForLayoutOrDispose(
  reader: Reader,
  requestId: number,
  loadRequestIdRef: RefBox<number>,
): Promise<void> {
  try {
    await waitForInitialReaderLayout(reader, requestId, loadRequestIdRef);
  } catch (error) {
    await disposeReader(reader);
    throw error;
  }
}

async function createControllerStack(
  reader: Reader,
  canvas: HTMLCanvasElement,
  opts: UseRitoReaderOptions,
  initialPosition: InitialPositionLoad,
  requestId: number,
  loadRequestIdRef: RefBox<number>,
): Promise<LoadedReaderStack | null> {
  if (requestId !== loadRequestIdRef.current) {
    await disposeReader(reader);
    return null;
  }

  let ctrl: ReaderController;
  try {
    ctrl = createController(reader, canvas, opts.controller);
  } catch (error: unknown) {
    await disposeReader(reader);
    throw error;
  }
  await hydrateInitialPosition(ctrl, initialPosition);
  if (requestId === loadRequestIdRef.current) return { reader, ctrl };
  disposeController(ctrl);
  await disposeReader(reader);
  return null;
}

async function disposeLoadedStack(stack: LoadedReaderStack): Promise<void> {
  disposeController(stack.ctrl);
  await disposeReader(stack.reader);
}

function disposeController(controller: ReaderController): void {
  try {
    controller.dispose();
  } catch {
    // Reader release still needs to run if controller cleanup fails.
  }
}

async function disposeReader(reader: Reader): Promise<void> {
  try {
    await reader.dispose();
  } catch {
    // A rejected release must not block cancellation or a replacement load.
  }
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
