import { expect, type Page } from '@playwright/test';

const READER_TRANSITION_TIMEOUT_MS = 90_000;

type ReaderTransitionValue = 'true' | 'false';

interface ReaderTransitionEvent {
  readonly value: ReaderTransitionValue;
  readonly observedAt: number;
}

interface ReaderTransitionSnapshot {
  readonly current: ReaderTransitionValue;
  readonly events: readonly ReaderTransitionEvent[];
}

export interface ReaderTransitionLifecycle {
  readonly startedAt: number;
  readonly endedAt: number;
}

interface ReaderTransitionObserverRuntime {
  __RITO_READER_TRANSITION_OBSERVER__?: MutationObserver;
  __RITO_READER_TRANSITION_EVENTS__?: ReaderTransitionEvent[];
  __RITO_READER_FLUSH_TRANSITION_OBSERVER__?: () => void;
}

/** Starts one exact attribute observer immediately before a measured navigation input. */
export async function startReaderTransitionObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderTransitionObserverRuntime;
    runtime.__RITO_READER_TRANSITION_OBSERVER__?.disconnect();
    delete runtime.__RITO_READER_TRANSITION_OBSERVER__;
    delete runtime.__RITO_READER_TRANSITION_EVENTS__;
    delete runtime.__RITO_READER_FLUSH_TRANSITION_OBSERVER__;
    const shell = document.querySelector('[data-testid="reader-shell"]');
    if (!(shell instanceof HTMLElement)) throw new Error('Reader shell is unavailable');
    const initial = transitionValue(shell.getAttribute('data-transitioning'));
    if (initial !== 'false') {
      throw new Error('Reader transition observer must start from a settled reader');
    }
    const events: ReaderTransitionEvent[] = [{ value: initial, observedAt: performance.now() }];
    const recordCurrent = (): void => {
      const value = transitionValue(shell.getAttribute('data-transitioning'));
      if (events.at(-1)?.value !== value) events.push({ value, observedAt: performance.now() });
    };
    const recordChanges = (records: readonly MutationRecord[]): void => {
      if (records.some((record) => record.attributeName === 'data-transitioning')) recordCurrent();
    };
    const observer = new MutationObserver(recordChanges);
    observer.observe(shell, {
      attributes: true,
      attributeFilter: ['data-transitioning'],
      attributeOldValue: true,
    });
    runtime.__RITO_READER_TRANSITION_OBSERVER__ = observer;
    runtime.__RITO_READER_TRANSITION_EVENTS__ = events;
    runtime.__RITO_READER_FLUSH_TRANSITION_OBSERVER__ = () => {
      recordChanges(observer.takeRecords());
    };

    function transitionValue(value: string | null): ReaderTransitionValue {
      if (value === 'true' || value === 'false') return value;
      throw new Error(`Invalid reader transition state: ${String(value)}`);
    }
  });
}

/**
 * Requires a real false -> true -> false attribute lifecycle. The `true`
 * MutationObserver callback must run no later than the qualifying target frame.
 */
export async function requireAnimatedReaderTurn(
  page: Page,
  targetFrameAt: number,
): Promise<ReaderTransitionLifecycle> {
  const firstFrameSnapshot = await readReaderTransitionSnapshot(page);
  const transitionStart = firstFrameSnapshot.events.find((event) => event.value === 'true');
  if (!transitionStart) {
    throw transitionContractError(
      'target frame painted before data-transitioning=true was observed',
      firstFrameSnapshot,
      targetFrameAt,
    );
  }
  if (transitionStart.observedAt > targetFrameAt) {
    throw transitionContractError(
      'data-transitioning=true was observed after the target frame',
      firstFrameSnapshot,
      targetFrameAt,
    );
  }
  const startIndex = firstFrameSnapshot.events.indexOf(transitionStart);
  await expect
    .poll(
      async () => {
        const snapshot = await readReaderTransitionSnapshot(page);
        return (
          snapshot.current === 'false' &&
          snapshot.events.slice(startIndex + 1).some((event) => event.value === 'false')
        );
      },
      { timeout: READER_TRANSITION_TIMEOUT_MS, intervals: [5] },
    )
    .toBe(true);
  const settledSnapshot = await readReaderTransitionSnapshot(page);
  const transitionEnd = settledSnapshot.events
    .slice(startIndex + 1)
    .find((event) => event.value === 'false');
  if (!transitionEnd) {
    throw transitionContractError(
      'data-transitioning did not return to false',
      settledSnapshot,
      targetFrameAt,
    );
  }
  return { startedAt: transitionStart.observedAt, endedAt: transitionEnd.observedAt };
}

export async function stopReaderTransitionObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderTransitionObserverRuntime;
    runtime.__RITO_READER_FLUSH_TRANSITION_OBSERVER__?.();
    runtime.__RITO_READER_TRANSITION_OBSERVER__?.disconnect();
    delete runtime.__RITO_READER_TRANSITION_OBSERVER__;
    delete runtime.__RITO_READER_TRANSITION_EVENTS__;
    delete runtime.__RITO_READER_FLUSH_TRANSITION_OBSERVER__;
  });
}

async function readReaderTransitionSnapshot(page: Page): Promise<ReaderTransitionSnapshot> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderTransitionObserverRuntime;
    runtime.__RITO_READER_FLUSH_TRANSITION_OBSERVER__?.();
    const shell = document.querySelector('[data-testid="reader-shell"]');
    if (!(shell instanceof HTMLElement)) throw new Error('Reader shell is unavailable');
    const current = shell.getAttribute('data-transitioning');
    if (current !== 'true' && current !== 'false') {
      throw new Error(`Invalid reader transition state: ${String(current)}`);
    }
    const events = runtime.__RITO_READER_TRANSITION_EVENTS__;
    if (!events) throw new Error('Reader transition observer is not active');
    return { current, events: events.map((event) => ({ ...event })) };
  });
}

function transitionContractError(
  message: string,
  snapshot: ReaderTransitionSnapshot,
  targetFrameAt: number,
): Error {
  return new Error(
    `${message}; targetFrameAt=${String(targetFrameAt)}, current=${snapshot.current}, events=${JSON.stringify(snapshot.events)}`,
  );
}
