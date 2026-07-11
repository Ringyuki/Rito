import type { ConsoleMessage, Page } from '@playwright/test';
import type { PixelGoldenRun } from './pixel-cases';
import type { PixelRunRenderResult } from './pixel-run-assertions';

interface BrowserReaderParityApi {
  renderRitoReaderParity(testRun: ReaderParityRun, bookBase64: string): Promise<BrowserParityPair>;
}

interface BrowserReaderParityWindow extends Partial<BrowserReaderParityApi> {
  renderRitoReaderParityReady?: string;
}

interface BrowserParityPair {
  readonly reference: BrowserEngineRun;
  readonly production: BrowserEngineRun;
}

interface BrowserEngineRun {
  readonly totalSpreads: number;
  readonly spreads: readonly BrowserEngineSpread[];
  readonly missingSpreadIndexes: readonly number[];
}

interface BrowserEngineSpread {
  readonly spreadIndex: number;
  readonly pngBase64: string;
  readonly textDraws?: readonly ReaderParityTextDraw[];
}

export interface ReaderParityRenderResult {
  readonly expected: PixelRunRenderResult;
  readonly actual: PixelRunRenderResult;
  readonly missingActualSpreadIndexes: readonly number[];
  readonly textDraws?: {
    readonly expected: readonly ReaderParitySpreadTextDraws[];
    readonly actual: readonly ReaderParitySpreadTextDraws[];
  };
}

export interface ReaderParityRun extends PixelGoldenRun {
  readonly spreadQueries?: readonly string[];
  readonly captureTextDraws?: boolean;
}

export interface ReaderParityTextDraw {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly letterSpacing: string;
  readonly wordSpacing: string;
}

export interface ReaderParitySpreadTextDraws {
  readonly spreadIndex: number;
  readonly draws: readonly ReaderParityTextDraw[];
}

const PAGE_READY_TIMEOUT_MS = 30_000;

export async function renderReaderParityRun(
  page: Page,
  origin: string,
  run: ReaderParityRun,
  bookBytes: Buffer,
): Promise<ReaderParityRenderResult> {
  const diagnostics: string[] = [];
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === 'error') diagnostics.push(`console error: ${message.text()}`);
  };
  const onPageError = (error: Error): void => {
    diagnostics.push(`page error: ${error.message}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  try {
    await page.goto(`${origin}/reader-parity-review.html`);
    await waitForParityApi(page, diagnostics);
    const result = await page.evaluate(
      async ({ browserRun, bookBase64 }) => {
        const api = window as unknown as BrowserReaderParityApi;
        return await api.renderRitoReaderParity(browserRun, bookBase64);
      },
      { browserRun: run, bookBase64: bookBytes.toString('base64') },
    );
    if (diagnostics.length > 0) {
      throw new Error(`Reader parity render emitted browser errors:\n${diagnostics.join('\n')}`);
    }
    const textDraws = run.captureTextDraws
      ? {
          expected: toSpreadTextDraws(result.reference),
          actual: toSpreadTextDraws(result.production),
        }
      : undefined;
    return {
      expected: toPixelRunResult(result.reference),
      actual: toPixelRunResult(result.production),
      missingActualSpreadIndexes: result.production.missingSpreadIndexes,
      ...(textDraws ? { textDraws } : {}),
    };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}

function toSpreadTextDraws(result: BrowserEngineRun): readonly ReaderParitySpreadTextDraws[] {
  return result.spreads.map((spread) => ({
    spreadIndex: spread.spreadIndex,
    draws: spread.textDraws ?? [],
  }));
}

async function waitForParityApi(page: Page, diagnostics: readonly string[]): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = window as unknown as BrowserReaderParityWindow;
      return (
        typeof api.renderRitoReaderParity === 'function' ||
        api.renderRitoReaderParityReady !== 'loading'
      );
    },
    undefined,
    { timeout: PAGE_READY_TIMEOUT_MS },
  );
  const ready = await page.evaluate(() => {
    const api = window as unknown as BrowserReaderParityWindow;
    return {
      hasApi: typeof api.renderRitoReaderParity === 'function',
      state: api.renderRitoReaderParityReady,
    };
  });
  if (ready.hasApi) return;
  const details = diagnostics.length > 0 ? `\n${diagnostics.join('\n')}` : '';
  throw new Error(`Reader parity page failed to load: ${ready.state ?? 'unknown'}${details}`);
}

function toPixelRunResult(result: BrowserEngineRun): PixelRunRenderResult {
  return {
    totalSpreads: result.totalSpreads,
    spreads: result.spreads.map((spread) => ({
      spreadIndex: spread.spreadIndex,
      png: Buffer.from(spread.pngBase64, 'base64'),
    })),
  };
}
