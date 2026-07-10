import type { Reader } from '@ritojs/core';
import type { PageBufferPool, ContentRenderer } from '../painter/buffer-pool';

/**
 * Schedule prerendering of adjacent spreads for the next paint turn.
 * Adjacent page buffers are part of the navigation hot path, so this uses
 * rAF instead of idle time; otherwise the first flip after load can miss its
 * buffer while background full reflow is still active.
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
    typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
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
