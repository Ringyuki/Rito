import type { Locator, Page } from '@playwright/test';
import type { ReaderProfileActiveHrefObservation } from './reader-profile-model';

interface ActiveHrefObserverRuntime {
  __RITO_READER_ACTIVE_HREF_OBSERVER__?: MutationObserver;
  __RITO_READER_ACTIVE_HREF_OBSERVATIONS__?: ReaderProfileActiveHrefObservation[];
  __RITO_READER_FLUSH_ACTIVE_HREF_OBSERVER__?: (observedAtOverride?: number) => number | undefined;
}

export function clickReaderTocButtonAcceptedAt(
  button: Locator,
  flushHrefObserverBeforeClick = false,
): Promise<number> {
  return button.evaluate((element, shouldFlushHrefObserver) => {
    if (shouldFlushHrefObserver) {
      const runtime = globalThis as typeof globalThis & ActiveHrefObserverRuntime;
      // The mutation already happened. The tiny conservative offset keeps it strictly before
      // acceptedAt even when performance.now() is precision-clamped.
      runtime.__RITO_READER_FLUSH_ACTIVE_HREF_OBSERVER__?.(performance.now() - 0.001);
    }
    const acceptedAt = performance.now();
    if (!(element instanceof HTMLButtonElement)) throw new Error('TOC entry is not a button');
    element.click();
    return acceptedAt;
  }, flushHrefObserverBeforeClick);
}

export async function startReaderActiveHrefObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ActiveHrefObserverRuntime;
    runtime.__RITO_READER_ACTIVE_HREF_OBSERVER__?.disconnect();
    const shell = document.querySelector('[data-testid="reader-shell"]');
    if (!(shell instanceof HTMLElement)) throw new Error('Reader shell is unavailable');
    const observations: ReaderProfileActiveHrefObservation[] = [];
    const recordChanges = (
      records: readonly MutationRecord[],
      observedAt = performance.now(),
    ): void => {
      for (const [index, record] of records.entries()) {
        if (record.attributeName !== 'data-active-chapter-href') continue;
        const next = records[index + 1];
        const href = next?.oldValue ?? shell.getAttribute('data-active-chapter-href') ?? '';
        if (href !== '' && observations.at(-1)?.href !== href) {
          observations.push({ href, observedAt });
        }
      }
    };
    const observer = new MutationObserver((records) => {
      recordChanges(records);
    });
    observer.observe(shell, {
      attributes: true,
      attributeFilter: ['data-active-chapter-href'],
      attributeOldValue: true,
    });
    runtime.__RITO_READER_ACTIVE_HREF_OBSERVER__ = observer;
    runtime.__RITO_READER_ACTIVE_HREF_OBSERVATIONS__ = observations;
    runtime.__RITO_READER_FLUSH_ACTIVE_HREF_OBSERVER__ = (observedAtOverride) => {
      const records = observer.takeRecords();
      if (records.length === 0) return undefined;
      const observedAt = observedAtOverride ?? performance.now();
      recordChanges(records, observedAt);
      return observedAt;
    };
  });
}

export async function stopReaderActiveHrefObserver(
  page: Page,
): Promise<ReaderProfileActiveHrefObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ActiveHrefObserverRuntime;
    runtime.__RITO_READER_FLUSH_ACTIVE_HREF_OBSERVER__?.();
    runtime.__RITO_READER_ACTIVE_HREF_OBSERVER__?.disconnect();
    const observations = (runtime.__RITO_READER_ACTIVE_HREF_OBSERVATIONS__ ?? []).map((entry) => ({
      ...entry,
    }));
    delete runtime.__RITO_READER_ACTIVE_HREF_OBSERVER__;
    delete runtime.__RITO_READER_ACTIVE_HREF_OBSERVATIONS__;
    delete runtime.__RITO_READER_FLUSH_ACTIVE_HREF_OBSERVER__;
    return observations;
  });
}
