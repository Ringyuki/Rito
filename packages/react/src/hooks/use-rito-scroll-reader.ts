import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createReader,
  type PackageMetadata,
  type Reader,
  type ReaderLocator,
  type ReaderOptions,
  type ReaderPublication,
  type TocEntry,
} from '@ritojs/core';
import {
  canDrawWithWebGl2,
  createScrollController,
  WebGlUnavailableError,
  type ScrollController,
  type ScrollControllerOptions,
} from '@ritojs/kit';
import { waitForInitialReaderLayout } from './use-rito-reader-layout';
import { followScrollView, NOTHING_READ, type ScrollViewReading } from './use-rito-scroll-state';

export interface UseRitoScrollReaderOptions {
  /** How the book opens; it is laid out scrolled whatever `spread` says. */
  readonly reader: Omit<ReaderOptions, 'spread'>;
  readonly scroll?: ScrollControllerOptions | undefined;
  /** Where the book opens: that line at the reading line once it is laid out. */
  readonly initialLocator?: ReaderLocator | null | undefined;
}

export interface RitoScrollReaderState extends ScrollViewReading {
  readonly controller: ScrollController | null;
  readonly reader: Reader | null;
  readonly isLoaded: boolean;
  readonly isLoading: boolean;
  /** Why the book could not be opened, or null. */
  readonly error: string | null;
  readonly metadata: PackageMetadata | null;
  readonly toc: readonly TocEntry[];
}

export interface RitoScrollReaderActions {
  /** Opens an EPUB archive or a sharded publication. */
  readonly load: (data: ReaderPublication | PromiseLike<ReaderPublication>) => Promise<void>;
  /** Lets the book go, and any load still opening one. */
  readonly unload: () => Promise<void>;
  /** The element the view is shown in, as a ref callback. */
  readonly containerRef: (element: HTMLElement | null) => void;
}

const INITIAL: Omit<RitoScrollReaderState, 'controller' | 'reader'> = {
  ...NOTHING_READ,
  isLoaded: false,
  isLoading: false,
  error: null,
  metadata: null,
  toc: [],
};

type State = typeof INITIAL;

interface Stack {
  readonly reader: Reader;
  readonly controller: ScrollController;
  readonly detach: () => void;
}

/** Owns a scrolled reader and its scroll view for one React component. */
export function useRitoScrollReader(
  options: UseRitoScrollReaderOptions,
): RitoScrollReaderState & RitoScrollReaderActions {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState(INITIAL);
  const held = useHeldStack();
  const containerRef = useRef<HTMLElement | null>(null);
  const load = useScrollLoad(optionsRef, held, containerRef, setState);
  const { release, request } = held;
  const unload = useCallback(async (): Promise<void> => {
    request.current += 1;
    setState(INITIAL);
    await release();
  }, [release, request]);
  const attach = useCallback(
    (element: HTMLElement | null): void => {
      containerRef.current = element;
      if (element) held.ref.current?.controller.mount(element);
    },
    [held.ref],
  );
  return {
    ...state,
    controller: held.stack?.controller ?? null,
    reader: held.stack?.reader ?? null,
    load,
    unload,
    containerRef: attach,
  };
}

interface HeldStack {
  readonly stack: Stack | null;
  readonly ref: { current: Stack | null };
  readonly hold: (stack: Stack) => void;
  /** Lets the held stack go; a load counted after it supersedes any still opening. */
  readonly release: () => Promise<void>;
  readonly request: { current: number };
}

/** The stack shown, let go when another replaces it and when the component unmounts. */
function useHeldStack(): HeldStack {
  const [stack, setStack] = useState<Stack | null>(null);
  const ref = useRef<Stack | null>(null);
  const request = useRef(0);
  const release = useCallback(async (): Promise<void> => {
    const current = ref.current;
    ref.current = null;
    setStack(null);
    if (current) await disposeStack(current);
  }, []);
  const hold = useCallback((next: Stack): void => {
    ref.current = next;
    setStack(next);
  }, []);
  useEffect(
    () => () => {
      request.current += 1;
      void release();
    },
    [release],
  );
  return { stack, ref, hold, release, request };
}

function useScrollLoad(
  optionsRef: { readonly current: UseRitoScrollReaderOptions },
  held: HeldStack,
  containerRef: { readonly current: HTMLElement | null },
  setState: (state: State | ((previous: State) => State)) => void,
): RitoScrollReaderActions['load'] {
  const { hold, release, request: requestRef } = held;
  return useCallback(
    async (data: ReaderPublication | PromiseLike<ReaderPublication>): Promise<void> => {
      const request = ++requestRef.current;
      await release();
      setState({ ...INITIAL, isLoading: true });
      try {
        const options = optionsRef.current;
        const opened = await openStack(await data, options, setState, requestRef, request);
        if (opened === null) return;
        hold(opened);
        if (containerRef.current) opened.controller.mount(containerRef.current);
        if (options.initialLocator) await opened.controller.scrollToLocator(options.initialLocator);
        setState((previous) => ({
          ...previous,
          isLoaded: true,
          isLoading: false,
          metadata: opened.reader.metadata,
          toc: opened.reader.toc,
        }));
      } catch (error: unknown) {
        if (request !== requestRef.current) return;
        setState({ ...INITIAL, error: error instanceof Error ? error.message : String(error) });
      }
    },
    [containerRef, hold, optionsRef, release, requestRef, setState],
  );
}

/** The reader laid out scrolled and its view, or null when a newer load replaced this one. */
async function openStack(
  data: ReaderPublication,
  options: UseRitoScrollReaderOptions,
  setState: (update: (previous: State) => State) => void,
  requestRef: { readonly current: number },
  request: number,
): Promise<Stack | null> {
  // Said before the book is opened, not after it was laid out for nothing.
  if (!canDrawWithWebGl2()) throw new WebGlUnavailableError();
  const canvas = document.createElement('canvas');
  const reader = await createReader(data, canvas, { ...options.reader, spread: 'scrolled' });
  const stale = (): boolean => request !== requestRef.current;
  try {
    if (!stale()) await waitForInitialReaderLayout(reader, request, requestRef);
  } catch (error: unknown) {
    await reader.dispose();
    throw error;
  }
  if (stale()) {
    await reader.dispose();
    return null;
  }
  const controller = createScrollController(reader, canvas, options.scroll);
  const detach = followScrollView(controller, setState);
  return { reader, controller, detach };
}

async function disposeStack(stack: Stack): Promise<void> {
  try {
    stack.detach();
    stack.controller.dispose();
  } catch {
    // The reader is released even when the view's cleanup fails.
  }
  try {
    await stack.reader.dispose();
  } catch {
    // A rejected release must not block a later load.
  }
}
