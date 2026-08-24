import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  drainBrowserReaderHostTasks,
  trackBrowserReaderHostTask,
} from '../../src/bindings/browser/reader/host-tasks';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';

afterEach(() => {
  vi.useRealTimers();
});

describe('Browser Reader host tasks', () => {
  it('drains tasks that settle inside the disposal window', async () => {
    const state = hostTaskState();
    const task = deferred<undefined>();
    void trackBrowserReaderHostTask(state, task.promise);

    const draining = drainBrowserReaderHostTasks(state);
    task.resolve(undefined);
    await draining;

    expect(state.pendingHostTasks.size).toBe(0);
    expect(state.logger.warn).not.toHaveBeenCalled();
  });

  it('stops waiting for a stuck browser host API', async () => {
    vi.useFakeTimers();
    const state = hostTaskState();
    void trackBrowserReaderHostTask(state, new Promise<undefined>(() => undefined));

    const draining = drainBrowserReaderHostTasks(state);
    await vi.advanceTimersByTimeAsync(1_000);
    await draining;

    expect(state.pendingHostTasks.size).toBe(1);
    expect(state.logger.warn).toHaveBeenCalledWith('reader host task drain timed out after 1000ms');
  });
});

function hostTaskState(): BrowserReaderState {
  return {
    pendingHostTasks: new Set(),
    logger: { warn: vi.fn() },
  } as unknown as BrowserReaderState;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
