import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reader, ReaderLocator } from '@ritojs/core';
import {
  createScrollController,
  type ReaderController,
  type ScrollController,
  type ScrollControllerOptions,
} from '@ritojs/kit';
import { followScrollView, NOTHING_READ, type ScrollViewReading } from './use-rito-scroll-state';

export interface UseRitoScrollViewOptions {
  /** Whether the book is read scrolled now. */
  readonly active: boolean;
  /** How the book is paged again once it is no longer read scrolled. */
  readonly paged: 'single' | 'double';
  readonly scroll?: ScrollControllerOptions | undefined;
}

export interface RitoScrollViewState extends ScrollViewReading {
  /** The scroll view while the book is read scrolled and shown; null otherwise. */
  readonly controller: ScrollController | null;
  /** Whether the book is being laid out scrolled, shown once it is. */
  readonly isLoading: boolean;
  /** Why the book could not be laid out scrolled, or null. */
  readonly error: string | null;
}

export interface RitoScrollViewActions {
  /** The element the view is shown in, as a ref callback. */
  readonly containerRef: (element: HTMLElement | null) => void;
}

const LAYOUT_TIMEOUT_MS = 15_000;
const LOADING_INDICATOR_DELAY_MS = 120;
const INITIAL: Omit<RitoScrollViewState, 'controller'> = {
  ...NOTHING_READ,
  isLoading: false,
  error: null,
};
type State = typeof INITIAL;

/** One turn of the book to scrolled reading and back, as one effect runs it. */
interface Switch {
  /** Until the effect is cleaned up: the view is wanted. */
  live: boolean;
  /** Whether the pages handed the reader over, so that leaving gives it back. */
  suspended: boolean;
  view: { readonly controller: ScrollController; readonly detach: () => void } | null;
  /** Where the view reads, and the pages open again. */
  reading: ReaderLocator | null;
}

/**
 * The book a page controller shows, read scrolled: while `active`, the
 * pages hand their reader over (`ReaderController.suspend`), the reader is
 * laid out scrolled and a scroll view shows it from where the pages were.
 * Turned off, the reader is paged again from where the view was read and
 * the pages take it back. One reader throughout: nothing is opened again.
 */
export function useRitoScrollView(
  pages: ReaderController | null,
  options: UseRitoScrollViewOptions,
): RitoScrollViewState & RitoScrollViewActions {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // The pages of the latest render: a cleanup that finds others there was
  // run because its pages were replaced, and their owner lets them go.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const [state, setState] = useState(INITIAL);
  const [shown, setShown] = useState<ScrollController | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  // Switches run one after another: a view is let go before the next one is made.
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    if (!pages || !options.active) return;
    const run: Switch = { live: true, suspended: false, view: null, reading: null };
    const show = (controller: ScrollController): void => {
      if (containerRef.current) controller.mount(containerRef.current);
      setShown(controller);
    };
    queue.current = queue.current.then(() => enter(pages, run, optionsRef, setState, show));
    return () => {
      run.live = false;
      const replaced = pagesRef.current !== pages;
      setShown(null);
      setState(INITIAL);
      queue.current = queue.current.then(() =>
        leave(pages, run, replaced ? null : optionsRef.current.paged),
      );
    };
  }, [pages, options.active]);
  const attach = useCallback(
    (element: HTMLElement | null): void => {
      containerRef.current = element;
      if (element) shown?.mount(element);
    },
    [shown],
  );
  return { ...state, controller: shown, containerRef: attach };
}

async function enter(
  pages: ReaderController,
  run: Switch,
  optionsRef: { readonly current: UseRitoScrollViewOptions },
  setState: (update: State | ((previous: State) => State)) => void,
  show: (controller: ScrollController) => void,
): Promise<void> {
  // Read again after each wait: the effect may have been cleaned up meanwhile.
  const over = (): boolean => !run.live;
  if (over()) return;
  run.reading = pages.position?.sourceLocator ?? null;
  pages.suspend();
  run.suspended = true;
  const reader = pages.reader;
  const indicator = setTimeout(() => {
    if (!over()) setState((previous) => ({ ...previous, isLoading: true }));
  }, LOADING_INDICATOR_DELAY_MS);
  try {
    if (!isScrolled(reader)) reader.setSpreadMode('scrolled');
    await layoutWhere(reader, () => isScrolled(reader));
    if (over()) return;
    const controller = createScrollController(reader, document.createElement('canvas'), {
      ...optionsRef.current.scroll,
    });
    const stopReading = controller.on('position', ({ locator }) => {
      run.reading = locator;
    });
    const stopFollowing = followScrollView(controller, setState);
    run.view = {
      controller,
      detach: () => {
        stopReading();
        stopFollowing();
      },
    };
    if (run.reading) await controller.scrollToLocator(run.reading);
    if (over()) return;
    setState((previous) => ({ ...previous, isLoading: false, error: null }));
    show(controller);
  } catch (error: unknown) {
    if (!over()) setState({ ...INITIAL, error: messageOf(error) });
  } finally {
    clearTimeout(indicator);
  }
}

/** Lets the view go and, unless the pages are going too (`paged` null), pages the reader again. */
async function leave(
  pages: ReaderController,
  run: Switch,
  paged: 'single' | 'double' | null,
): Promise<void> {
  if (run.view) {
    run.view.detach();
    run.view.controller.dispose();
  }
  // Pages let go meanwhile have nothing to take back.
  if (!run.suspended || paged === null || !pages.suspended) return;
  const reader = pages.reader;
  try {
    // The pages open on the line the view was read at.
    if (run.reading && isScrolled(reader)) await reader.navigateToLocator?.(run.reading);
    if (isScrolled(reader)) {
      reader.setSpreadMode(paged);
      await layoutWhere(reader, () => !isScrolled(reader));
    }
  } catch {
    // A reader let go meanwhile, or one that could not be paged again: the
    // pages take back what there is.
  } finally {
    pages.resume();
  }
}

/** Whether the reader's committed layout is scrolled. */
function isScrolled(reader: Reader): boolean {
  return reader.getScrollLayout() !== undefined;
}

/** Resolves once the reader commits a layout `holds` accepts, at once when it already has. */
function layoutWhere(reader: Reader, holds: () => boolean): Promise<void> {
  if (holds()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let stop = (): void => undefined;
    const timeout = setTimeout(() => {
      stop();
      reject(new Error('The reader was not laid out in time'));
    }, LAYOUT_TIMEOUT_MS);
    stop = reader.onLayoutCommitted(() => {
      if (!holds()) return;
      clearTimeout(timeout);
      stop();
      resolve();
    });
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
