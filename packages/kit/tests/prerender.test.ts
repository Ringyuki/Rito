import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import { createPrerenderScheduler, type PrerenderJob } from '../src/controller/prerender';
import type { PageBufferPool } from '../src/painter/buffer-pool';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PrerenderScheduler', () => {
  it('prerenders one adjacent spread per idle callback', () => {
    const callbacks: (() => void)[] = [];
    const requestIdle = vi.fn((next: () => void) => {
      callbacks.push(next);
      return 7;
    });
    vi.stubGlobal('requestIdleCallback', requestIdle);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { job, assignSlot, ensureContent } = createJob();
    const scheduler = createPrerenderScheduler();

    scheduler.schedule(job);
    callbacks.shift()?.();

    expect(assignSlot).toHaveBeenCalledOnce();
    expect(assignSlot).toHaveBeenCalledWith('next', 2);
    expect(ensureContent).toHaveBeenCalledOnce();

    callbacks.shift()?.();

    expect(assignSlot).toHaveBeenNthCalledWith(2, 'prev', 0);
    expect(ensureContent).toHaveBeenCalledTimes(2);
  });

  it('does not dirty an adjacent slot that already owns its spread', () => {
    const callbacks: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (next: () => void) => {
      callbacks.push(next);
      return callbacks.length;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { job, assignSlot, ensureContent, getSlotFor } = createJob();
    getSlotFor.mockImplementation((spreadIndex: number) =>
      spreadIndex === 2 ? 'next' : spreadIndex === 0 ? 'prev' : null,
    );
    const scheduler = createPrerenderScheduler();

    scheduler.schedule(job);
    callbacks.shift()?.();
    callbacks.shift()?.();

    expect(assignSlot).not.toHaveBeenCalled();
    expect(ensureContent).toHaveBeenCalledTimes(2);
  });

  it('warms the forward spread with the shorter idle deadline', () => {
    const idleCallbacks: (() => void)[] = [];
    const requestIdle = vi.fn((next: () => void) => {
      idleCallbacks.push(next);
      return 12;
    });
    vi.stubGlobal('requestIdleCallback', requestIdle);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { job, assignSlot } = createJob();
    const scheduler = createPrerenderScheduler();

    scheduler.schedule({ ...job, eagerPosition: 'next' });
    expect(requestIdle).toHaveBeenCalledWith(expect.any(Function), { timeout: 25 });

    idleCallbacks.shift()?.();
    expect(assignSlot).toHaveBeenCalledWith('next', 2);
    expect(idleCallbacks).toHaveLength(1);

    idleCallbacks.shift()?.();
    expect(assignSlot).toHaveBeenNthCalledWith(2, 'prev', 0);
  });

  it('warms the backward spread first after a committed backward turn', () => {
    const callbacks: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (next: () => void) => {
      callbacks.push(next);
      return callbacks.length;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { job, assignSlot } = createJob();
    const scheduler = createPrerenderScheduler();

    scheduler.schedule({ ...job, eagerPosition: 'prev' });
    callbacks.shift()?.();
    callbacks.shift()?.();

    expect(assignSlot).toHaveBeenNthCalledWith(1, 'prev', 0);
    expect(assignSlot).toHaveBeenNthCalledWith(2, 'next', 2);
  });

  it('uses a cancellable background task when the scheduler API is available', () => {
    const callbacks: (() => void)[] = [];
    const postTask = vi.fn(
      (
        next: () => void,
        _options: { readonly priority: 'background'; readonly signal: AbortSignal },
      ) => {
        callbacks.push(next);
        return Promise.resolve();
      },
    );
    vi.stubGlobal('scheduler', { postTask });
    const { job, assignSlot } = createJob();
    const scheduler = createPrerenderScheduler();

    scheduler.schedule({ ...job, eagerPosition: 'next' });
    expect(postTask).toHaveBeenCalledOnce();
    const options = postTask.mock.calls[0]?.[1];
    expect(options?.priority).toBe('background');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    callbacks.shift()?.();

    expect(assignSlot).toHaveBeenCalledWith('next', 2);
  });

  it('reschedules background work while input is pending', () => {
    const callbacks: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (next: () => void) => {
      callbacks.push(next);
      return callbacks.length;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    vi.stubGlobal('navigator', {
      scheduling: { isInputPending: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) },
    });
    const { job, assignSlot } = createJob();
    const scheduler = createPrerenderScheduler();

    scheduler.schedule(job);
    callbacks.shift()?.();
    expect(assignSlot).not.toHaveBeenCalled();

    callbacks.shift()?.();
    expect(assignSlot).toHaveBeenCalledWith('next', 2);
  });

  it('ignores a cancelled callback that races a newer job', () => {
    const callbacks: (() => void)[] = [];
    const cancelIdle = vi.fn();
    vi.stubGlobal('requestIdleCallback', (next: () => void) => {
      callbacks.push(next);
      return callbacks.length;
    });
    vi.stubGlobal('cancelIdleCallback', cancelIdle);
    const first = createJob();
    const latest = createJob(2, 4);
    const scheduler = createPrerenderScheduler();

    scheduler.schedule(first.job);
    scheduler.schedule(latest.job);
    callbacks[0]?.();
    expect(first.assignSlot).not.toHaveBeenCalled();
    expect(latest.assignSlot).not.toHaveBeenCalled();

    callbacks[1]?.();
    expect(latest.assignSlot).toHaveBeenCalledWith('next', 3);
    expect(cancelIdle).toHaveBeenCalledWith(1);
  });

  it('cancels idle work and guards against a callback racing disposal', () => {
    let callback = (): void => {};
    vi.stubGlobal('requestIdleCallback', (next: () => void) => {
      callback = next;
      return 19;
    });
    const cancelIdle = vi.fn();
    vi.stubGlobal('cancelIdleCallback', cancelIdle);
    const { job, assignSlot } = createJob();
    const scheduler = createPrerenderScheduler();

    scheduler.schedule(job);
    scheduler.dispose();
    callback();

    expect(cancelIdle).toHaveBeenCalledWith(19);
    expect(assignSlot).not.toHaveBeenCalled();
  });

  it('cancels the timeout fallback and guards its callback', () => {
    let callback = (): void => {};
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.stubGlobal('cancelIdleCallback', undefined);
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

function createJob(
  currentSpread = 1,
  totalSpreads = 3,
): {
  readonly job: PrerenderJob;
  readonly assignSlot: ReturnType<typeof vi.fn>;
  readonly ensureContent: ReturnType<typeof vi.fn>;
  readonly getSlotFor: ReturnType<typeof vi.fn>;
} {
  const assignSlot = vi.fn();
  const ensureContent = vi.fn(() => true);
  const getSlotFor = vi.fn(() => null);
  const pool = { assignSlot, ensureContent, getSlotFor } as unknown as PageBufferPool;
  return {
    assignSlot,
    ensureContent,
    getSlotFor,
    job: {
      getCurrentSpread: () => currentSpread,
      isAnimating: () => false,
      reader: { totalSpreads } as Reader,
      pool,
      contentRenderer: vi.fn(() => true),
    },
  };
}
