import type { BrowserReaderState } from './reader/types';

const HOST_TASK_DRAIN_TIMEOUT_MS = 1_000;

/** Keeps host-side font, frame and image work inside the Reader disposal barrier. */
export function trackBrowserReaderHostTask<T>(
  state: BrowserReaderState,
  task: Promise<T>,
): Promise<T> {
  const tracked = task.finally(() => {
    state.pendingHostTasks.delete(tracked);
  });
  state.pendingHostTasks.add(tracked);
  return tracked;
}

export async function drainBrowserReaderHostTasks(state: BrowserReaderState): Promise<void> {
  const deadline = Date.now() + HOST_TASK_DRAIN_TIMEOUT_MS;
  while (state.pendingHostTasks.size > 0) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0 || !(await settleHostTasks(state.pendingHostTasks, remainingMs))) {
      warnHostTaskTimeout(state);
      return;
    }
  }
}

function settleHostTasks(
  tasks: ReadonlySet<Promise<unknown>>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    void Promise.allSettled([...tasks]).then(() => {
      globalThis.clearTimeout(timer);
      resolve(true);
    });
  });
}

function warnHostTaskTimeout(state: BrowserReaderState): void {
  try {
    state.logger.warn(
      `reader host task drain timed out after ${String(HOST_TASK_DRAIN_TIMEOUT_MS)}ms`,
    );
  } catch {
    // Logging must not keep Reader disposal pending.
  }
}
