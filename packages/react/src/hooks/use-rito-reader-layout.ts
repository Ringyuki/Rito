import type { Reader } from '@ritojs/core';
import type { RefBox } from './use-rito-reader-model';

const INITIAL_LAYOUT_TIMEOUT_MS = 15_000;

export function waitForInitialReaderLayout(
  reader: Reader,
  requestId: number,
  loadRequestIdRef: RefBox<number>,
): Promise<void> {
  if (reader.totalSpreads > 0 || requestId !== loadRequestIdRef.current) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let done = false;
    let unsubscribe = (): void => {};
    const timeoutId = setTimeout(() => {
      finish(new Error('Reader initial layout timed out'));
    }, INITIAL_LAYOUT_TIMEOUT_MS);
    const staleCheckId = setInterval(() => {
      if (requestId !== loadRequestIdRef.current) finish();
    }, 50);
    const finish = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      clearInterval(staleCheckId);
      try {
        unsubscribe();
      } catch {
        // A broken listener disposer must not strand the creation queue.
      }
      if (error) reject(error);
      else resolve();
    };
    unsubscribe = reader.onLayoutCommitted(() => {
      if (reader.totalSpreads > 0) finish();
    });
  });
}
