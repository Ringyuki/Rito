import type { Reader } from '@ritojs/core';

/**
 * How long a size must stand before the reader lays the whole book out
 * again behind the page. A step of that holds the reader's session for as
 * long as the book takes (measured: 240 ms for a 400-page novel, 1.3 s for
 * an 800-page one), and one started between two sizes of a window being
 * resized held every size after it: the reader showed 8 layouts a second
 * where the window sent 57, and 1.5 where it sent 52. A drag's sizes came
 * at most 50 ms apart; laid out alone, each reached the screen.
 */
export const RESIZE_SETTLE_MS = 300;

/** The hold a run of resizes keeps on the whole-book layout. */
export interface ResizeSettle {
  release: (() => void) | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function createResizeSettle(): ResizeSettle {
  return { release: undefined, timer: undefined };
}

/** Holds the whole-book layout back until no size has come for {@link RESIZE_SETTLE_MS}. */
export function holdBookWhileResizing(settle: ResizeSettle, reader: Reader): void {
  if (!reader.holdBookLayout) return;
  settle.release ??= reader.holdBookLayout();
  clearTimeout(settle.timer);
  settle.timer = setTimeout(() => {
    settle.timer = undefined;
    endResizeSettle(settle);
  }, RESIZE_SETTLE_MS);
}

/** Lets the whole-book layout go at once. */
export function endResizeSettle(settle: ResizeSettle): void {
  clearTimeout(settle.timer);
  settle.timer = undefined;
  const release = settle.release;
  settle.release = undefined;
  release?.();
}
