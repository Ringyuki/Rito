import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import { createPrerenderScheduler, type PrerenderJob } from '../src/controller/prerender';
import type { PageBufferPool } from '../src/painter/buffer-pool';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PrerenderScheduler', () => {
  it('prerenders adjacent spreads on the scheduled frame', () => {
    let callback: FrameRequestCallback = () => {};
    const requestFrame = vi.fn((next: FrameRequestCallback) => {
      callback = next;
      return 7;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { job, assignSlot, ensureContent } = createJob();
    const scheduler = createPrerenderScheduler();

    scheduler.schedule(job);
    callback(0);

    expect(assignSlot).toHaveBeenNthCalledWith(1, 'next', 2);
    expect(assignSlot).toHaveBeenNthCalledWith(2, 'prev', 0);
    expect(ensureContent).toHaveBeenCalledTimes(2);
  });

  it('cancels rAF and guards against a callback racing disposal', () => {
    let callback: FrameRequestCallback = () => {};
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
      callback = next;
      return 19;
    });
    const cancelFrame = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const { job, assignSlot } = createJob();
    const scheduler = createPrerenderScheduler();

    scheduler.schedule(job);
    scheduler.dispose();
    callback(0);

    expect(cancelFrame).toHaveBeenCalledWith(19);
    expect(assignSlot).not.toHaveBeenCalled();
  });

  it('cancels the timeout fallback and guards its callback', () => {
    let callback = (): void => {};
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
    vi.stubGlobal('setTimeout', (next: () => void) => {
      callback = next;
      return 23;
    });
    const clear = vi.fn();
    vi.stubGlobal('clearTimeout', clear);
    const { job, assignSlot } = createJob();
    const scheduler = createPrerenderScheduler();

    scheduler.schedule(job);
    scheduler.dispose();
    callback();

    expect(clear).toHaveBeenCalledWith(23);
    expect(assignSlot).not.toHaveBeenCalled();
  });
});

function createJob(): {
  readonly job: PrerenderJob;
  readonly assignSlot: ReturnType<typeof vi.fn>;
  readonly ensureContent: ReturnType<typeof vi.fn>;
} {
  const assignSlot = vi.fn();
  const ensureContent = vi.fn(() => true);
  const pool = { assignSlot, ensureContent } as unknown as PageBufferPool;
  return {
    assignSlot,
    ensureContent,
    job: {
      getCurrentSpread: () => 1,
      isAnimating: () => false,
      reader: { totalSpreads: 3 } as Reader,
      pool,
      contentRenderer: vi.fn(() => true),
    },
  };
}
