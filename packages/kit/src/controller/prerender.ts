import type { Reader } from '@ritojs/core';
import type { ContentRenderer, PageBufferPool } from '../painter/buffer-pool';

export interface PrerenderJob {
  readonly getCurrentSpread: () => number;
  readonly isAnimating: () => boolean;
  readonly reader: Reader;
  readonly pool: PageBufferPool;
  readonly contentRenderer: ContentRenderer;
}

interface PrerenderSchedulerState {
  disposed: boolean;
  job: PrerenderJob | null;
  cancelPending: (() => void) | null;
}

export interface PrerenderScheduler {
  schedule(job: PrerenderJob): void;
  dispose(): void;
}

/** Owns the single pending adjacent-spread prerender callback. */
export function createPrerenderScheduler(): PrerenderScheduler {
  const state: PrerenderSchedulerState = { disposed: false, job: null, cancelPending: null };
  return {
    schedule(job): void {
      if (state.disposed) return;
      state.job = job;
      if (state.cancelPending) return;
      state.cancelPending = scheduleCancelable(() => {
        runPrerender(state);
      });
    },
    dispose(): void {
      if (state.disposed) return;
      state.disposed = true;
      state.job = null;
      state.cancelPending?.();
      state.cancelPending = null;
    },
  };
}

function runPrerender(state: PrerenderSchedulerState): void {
  state.cancelPending = null;
  if (state.disposed) return;
  const job = state.job;
  state.job = null;
  if (!job || job.isAnimating()) return;

  const current = job.getCurrentSpread();
  if (current + 1 < job.reader.totalSpreads) {
    job.pool.assignSlot('next', current + 1);
    job.pool.ensureContent('next', job.contentRenderer);
  }
  if (current - 1 >= 0) {
    job.pool.assignSlot('prev', current - 1);
    job.pool.ensureContent('prev', job.contentRenderer);
  }
}

function scheduleCancelable(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    const id = requestAnimationFrame(callback);
    return () => {
      cancelAnimationFrame(id);
    };
  }
  const id = setTimeout(callback, 1);
  return () => {
    clearTimeout(id);
  };
}
