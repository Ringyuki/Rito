import type { Reader } from 'rito';
import type { PageBufferPool, ContentRenderer } from '../painter/buffer-pool';

/**
 * Schedule prerendering of adjacent spreads using requestIdleCallback.
 * Falls back to setTimeout if rIC is unavailable.
 *
 * Uses a live getCurrentSpread getter so the callback always reads the
 * current spread at execution time, not the value captured at scheduling time.
 */
export function scheduleIdlePrerender(
  getCurrentSpread: () => number,
  isAnimating: () => boolean,
  reader: Reader,
  pool: PageBufferPool,
  contentRenderer: ContentRenderer,
): void {
  const schedule =
    typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 1);

  schedule(() => {
    // Skip if a navigation is in progress — goToSpread has already set up
    // the incoming slot, and overwriting it with prerender data would corrupt it.
    if (isAnimating()) return;

    const cs = getCurrentSpread();
    const total = reader.totalSpreads;
    if (cs + 1 < total) {
      pool.assignSlot('next', cs + 1);
      pool.ensureContent('next', contentRenderer);
    }
    if (cs - 1 >= 0) {
      pool.assignSlot('prev', cs - 1);
      pool.ensureContent('prev', contentRenderer);
    }
  });
}
