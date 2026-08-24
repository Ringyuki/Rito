import type { Page } from '@playwright/test';

export type ReaderStartupColorScheme = 'light' | 'dark';

export interface ReaderStartupProbeSnapshot {
  readonly navigationStartedAt: number;
  readonly initializedAt: number;
  readonly readerReadyAt: number;
  readonly locale: string;
  readonly colorScheme: ReaderStartupColorScheme;
}

interface ReaderStartupProbeState {
  navigationStartedAt: number;
  initializedAt: number;
  readerReadyAt: number | null;
  startupErrorAt: number | null;
  startupErrorMessage: string | null;
}

interface ReaderStartupProbeGlobal {
  __RITO_READER_STARTUP__?: ReaderStartupProbeState;
}

export async function installReaderStartupProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const runtime = globalThis as typeof globalThis & ReaderStartupProbeGlobal;
    const state: ReaderStartupProbeState = {
      navigationStartedAt: 0,
      initializedAt: performance.now(),
      readerReadyAt: null,
      startupErrorAt: null,
      startupErrorMessage: null,
    };
    runtime.__RITO_READER_STARTUP__ = state;
    const observer = new MutationObserver(scan);
    observer.observe(document, { childList: true, subtree: true });
    scan();

    function scan(): void {
      if (state.readerReadyAt !== null || state.startupErrorAt !== null) return;
      if (document.querySelector('[data-testid="reader-empty"]')) {
        state.readerReadyAt = performance.now();
        observer.disconnect();
        return;
      }
      const error = document.querySelector('[data-testid="reader-startup-error"]');
      if (!error) return;
      state.startupErrorAt = performance.now();
      state.startupErrorMessage = error.textContent.trim() || 'Reader startup failed';
      observer.disconnect();
    }
  });
}

export async function waitForReaderStartup(page: Page): Promise<ReaderStartupProbeSnapshot> {
  await page.waitForFunction(
    () => {
      const runtime = globalThis as typeof globalThis & ReaderStartupProbeGlobal;
      const state = runtime.__RITO_READER_STARTUP__;
      return state !== undefined && (state.readerReadyAt !== null || state.startupErrorAt !== null);
    },
    undefined,
    { timeout: 90_000 },
  );
  return readReaderStartup(page);
}

async function readReaderStartup(page: Page): Promise<ReaderStartupProbeSnapshot> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderStartupProbeGlobal;
    const state = runtime.__RITO_READER_STARTUP__;
    if (!state) throw new Error('Reader startup probe is unavailable');
    if (state.startupErrorAt !== null) {
      throw new Error(state.startupErrorMessage ?? 'Reader startup failed');
    }
    if (state.readerReadyAt === null) throw new Error('Reader did not reach its ready state');
    return {
      navigationStartedAt: state.navigationStartedAt,
      initializedAt: state.initializedAt,
      readerReadyAt: state.readerReadyAt,
      locale: navigator.language,
      colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    };
  });
}
