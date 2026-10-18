import type { Reader } from '@ritojs/core';
import type { ContentRenderer, PageBufferPool } from '../painter/buffer-pool';
import { scheduleIdleTask } from '../utils/idle-task';

export interface PrerenderJob {
  readonly getCurrentSpread: () => number;
  readonly isAnimating: () => boolean;
  readonly reader: Reader;
  readonly pool: PageBufferPool;
  readonly contentRenderer: ContentRenderer;
  /** Warm the newly exposed navigation direction before the opposite side. */
  readonly eagerPosition?: 'next' | 'prev';
  /** Called once both neighbours are painted. */
  readonly painted?: () => void;
}

interface PrerenderSchedulerState {
  disposed: boolean;
  job: PrerenderJob | null;
  generation: number;
  step: number;
  cancelPending: (() => void) | null;
  pauseCount: number;
}

export interface PrerenderScheduler {
  schedule(job: PrerenderJob): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

/** Owns the single pending adjacent-spread prerender callback. */
export function createPrerenderScheduler(): PrerenderScheduler {
  const state: PrerenderSchedulerState = {
    disposed: false,
    job: null,
    generation: 0,
    step: 0,
    cancelPending: null,
    pauseCount: 0,
  };
  return {
    schedule(job): void {
      if (state.disposed) return;
      state.job = job;
      state.generation += 1;
      state.step = 0;
      state.cancelPending?.();
      state.cancelPending = null;
      if (state.pauseCount === 0) scheduleNext(state);
    },
    pause(): void {
      if (state.disposed) return;
      state.pauseCount += 1;
      state.cancelPending?.();
      state.cancelPending = null;
    },
    resume(): void {
      if (state.disposed || state.pauseCount === 0) return;
      state.pauseCount -= 1;
      if (state.pauseCount === 0 && state.job) scheduleNext(state);
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

function runPrerender(state: PrerenderSchedulerState, generation: number): void {
  if (state.generation !== generation) return;
  state.cancelPending = null;
  if (state.disposed || state.pauseCount > 0) return;
  if (hasPendingInput()) {
    scheduleNext(state);
    return;
  }
  const job = state.job;
  if (!job || job.isAnimating()) {
    if (state.generation === generation) state.job = null;
    return;
  }

  const current = job.getCurrentSpread();
  const firstPosition = job.eagerPosition ?? 'next';
  const position = state.step === 0 ? firstPosition : oppositePosition(firstPosition);
  const spreadIndex = position === 'next' ? current + 1 : current - 1;
  warmAdjacentSpread(job, position, spreadIndex);
  if (state.generation !== generation) {
    scheduleNext(state);
    return;
  }
  state.step += 1;
  if (state.step < 2) {
    scheduleNext(state);
    return;
  }
  state.job = null;
  job.painted?.();
}

function warmAdjacentSpread(
  job: PrerenderJob,
  position: 'next' | 'prev',
  spreadIndex: number,
): void {
  if (spreadIndex < 0 || spreadIndex >= job.reader.totalSpreads) return;
  if (job.pool.getSlotFor(spreadIndex) !== position) {
    job.pool.assignSlot(position, spreadIndex);
  }
  job.pool.ensureContent(position, job.contentRenderer);
}

function scheduleNext(state: PrerenderSchedulerState): void {
  if (state.disposed || state.pauseCount > 0 || state.cancelPending) return;
  const generation = state.generation;
  const eager = state.step === 0 && state.job?.eagerPosition !== undefined;
  state.cancelPending = scheduleIdleTask(() => {
    runPrerender(state, generation);
  }, eager);
}

function hasPendingInput(): boolean {
  if (typeof navigator === 'undefined') return false;
  const scheduling = (navigator as Navigator & { scheduling?: { isInputPending?: () => boolean } })
    .scheduling;
  return scheduling?.isInputPending?.() === true;
}

function oppositePosition(position: 'next' | 'prev'): 'next' | 'prev' {
  return position === 'next' ? 'prev' : 'next';
}
