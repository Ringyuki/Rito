import type { Reader } from '@ritojs/core';
import type { PrerenderScheduler } from '../prerender';

/**
 * How long a size must stand before the reader lays the whole book out
 * again behind the page: the engine's `READER_RELAYOUT_SETTLE_MS`. Pages
 * laid out behind a size the next one replaces are thrown away, so while
 * a window is being resized the book waits; a drag's sizes come at most
 * 50 ms apart.
 */
export const RESIZE_SETTLE_MS = 300;

/** The hold a run of resizes keeps on the whole-book layout and the neighbouring spreads. */
export interface ResizeSettle {
  release: (() => void) | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function createResizeSettle(): ResizeSettle {
  return { release: undefined, timer: undefined };
}

/**
 * Holds the whole-book layout and the prerendering of the spreads beside
 * the one shown back until no size has come for {@link RESIZE_SETTLE_MS}:
 * a neighbour painted for one size is replaced by the next, and the paint
 * holds that size back.
 */
export function holdWhileResizing(
  settle: ResizeSettle,
  reader: Reader,
  prerender: PrerenderScheduler,
): void {
  settle.release ??= holdFor(reader, prerender);
  clearTimeout(settle.timer);
  settle.timer = setTimeout(() => {
    settle.timer = undefined;
    endResizeSettle(settle);
  }, RESIZE_SETTLE_MS);
}

function holdFor(reader: Reader, prerender: PrerenderScheduler): () => void {
  const releaseBook = reader.holdBookLayout?.();
  prerender.pause();
  return () => {
    releaseBook?.();
    prerender.resume();
  };
}

/** Lets the whole-book layout and the neighbouring spreads go at once. */
export function endResizeSettle(settle: ResizeSettle): void {
  clearTimeout(settle.timer);
  settle.timer = undefined;
  const release = settle.release;
  settle.release = undefined;
  release?.();
}
