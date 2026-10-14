import { sessionReaderClosed, type SessionReaderQueue, type SessionReaderState } from './state';

/**
 * How soon an operation is wanted: `asked` for what the reader was asked to
 * do, `ahead` for a spread loaded before it is shown.
 */
export type SessionReaderUrgency = keyof Pick<SessionReaderQueue, 'asked' | 'ahead'>;

export function createSessionReaderQueue(): SessionReaderQueue {
  return { asked: [], ahead: [], running: false, idle: () => Promise.resolve(false) };
}

/**
 * Runs `operation` on the reader's queue. Everything that creates, adopts,
 * commits or releases one of the session's artifacts, or advances the
 * whole-book layout, runs here and nowhere else, one operation at a time:
 * the session's live-artifact budget is then counted exactly, and nothing
 * comes between a request and the adoption of its result.
 *
 * Resolves with what the operation resolved with, or undefined when the
 * reader closed first or the operation failed. A failure is logged and
 * never stops the operations behind it.
 */
export function runSessionReaderOperation<Result>(
  state: SessionReaderState,
  urgency: SessionReaderUrgency,
  operation: () => Promise<Result>,
): Promise<Result | undefined> {
  return new Promise((resolve) => {
    state.queue[urgency].push(async () => {
      let result: Result | undefined;
      try {
        if (!state.disposed) result = await operation();
      } catch (error) {
        if (!sessionReaderClosed(state)) {
          state.logger.warn('reader session operation failed', error);
        }
      }
      resolve(result);
    });
    wakeSessionReaderQueue(state);
  });
}

/** Has the queue look for work: an operation that waits, or else a step of the whole book. */
export function wakeSessionReaderQueue(state: SessionReaderState): void {
  // Deferred, so that what is asked for in one task is queued before any of it starts.
  queueMicrotask(() => void drain(state));
}

async function drain(state: SessionReaderState): Promise<void> {
  const { queue } = state;
  if (queue.running) return;
  queue.running = true;
  try {
    for (;;) {
      const asked = queue.asked.shift();
      const next = asked ?? queue.ahead.shift();
      if (next) {
        await next();
        // Something the reader was asked for is the cue to try a stalled book again.
        if (asked) state.bookStalled = false;
      } else if (!(await queue.idle()) && queue.asked.length + queue.ahead.length === 0) {
        return;
      }
    }
  } finally {
    queue.running = false;
  }
}
