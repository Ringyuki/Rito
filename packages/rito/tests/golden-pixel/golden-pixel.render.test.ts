import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { BOOK_FIXTURE_ROOT } from '../golden-books/helpers/book-manifest';
import { getPixelGoldenRuns, type PixelGoldenRun } from './helpers/pixel-cases';
import {
  SHOULD_REVIEW_PIXEL_GOLDEN,
  SHOULD_RUN_PIXEL_GOLDEN,
  SHOULD_UPDATE_PIXEL_GOLDEN,
} from './helpers/pixel-golden-file';
import {
  resetPixelReviewReport,
  writePixelReviewIndex,
  type PixelReviewRecord,
} from './helpers/pixel-review';
import {
  comparePixelRun,
  reviewPixelRun,
  updatePixelRunGoldens,
  type PixelRunRenderResult,
} from './helpers/pixel-run-assertions';
import { startPixelRenderServer, type PixelRenderServer } from './helpers/render-server';

interface BrowserRenderApi {
  renderRitoPixelRun(testRun: PixelGoldenRun, bookBase64: string): Promise<BrowserPixelRunResult>;
}

interface BrowserPixelRunResult {
  readonly totalSpreads: number;
  readonly spreads: readonly BrowserPixelSpread[];
}

interface BrowserPixelSpread {
  readonly spreadIndex: number;
  readonly pngBase64: string;
}

interface BrowserRenderWindow extends Partial<BrowserRenderApi> {
  renderRitoPixelReady?: string;
}

const PAGE_READY_TIMEOUT_MS = 30_000;
const PIXEL_TEST_MODE = SHOULD_REVIEW_PIXEL_GOLDEN ? 'serial' : 'parallel';

test.describe.configure({ mode: PIXEL_TEST_MODE });

test.describe('golden pixel render snapshots', () => {
  const runs = getPixelGoldenRuns();
  const reviewRecords: PixelReviewRecord[] = [];
  let server: PixelRenderServer | undefined;

  test.skip(!SHOULD_RUN_PIXEL_GOLDEN, 'Set RITO_PIXEL_GOLDEN=1 to run pixel goldens');

  test.beforeAll(async () => {
    if (SHOULD_UPDATE_PIXEL_GOLDEN && SHOULD_REVIEW_PIXEL_GOLDEN) {
      throw new Error('RITO_PIXEL_REVIEW=1 cannot be combined with RITO_UPDATE_GOLDEN=1');
    }
    if (SHOULD_REVIEW_PIXEL_GOLDEN) await resetPixelReviewReport();
    server = await startPixelRenderServer();
  });

  test.afterAll(async () => {
    if (SHOULD_REVIEW_PIXEL_GOLDEN) {
      const indexPath = await writePixelReviewIndex(reviewRecords);
      console.log(`Pixel review report: ${indexPath}`);
    }
    if (!server) return;
    await server.close();
  });

  test('has enabled pixel runs', () => {
    expect(runs.length).toBeGreaterThan(0);
  });

  for (const { run, book } of runs) {
    test(run.id, async ({ page }, testInfo) => {
      if (!server) throw new Error('Pixel render server did not start');
      const bookBytes = await readFile(resolve(BOOK_FIXTURE_ROOT, book.path));
      const result = await renderPixelRun(page, server.origin, run, bookBytes);

      if (SHOULD_UPDATE_PIXEL_GOLDEN) {
        await updatePixelRunGoldens(run, result);
        return;
      }

      if (SHOULD_REVIEW_PIXEL_GOLDEN) {
        reviewRecords.push(...(await reviewPixelRun(run, result)));
        return;
      }

      await comparePixelRun(run, result, testInfo);
    });
  }
});

async function renderPixelRun(
  page: Page,
  origin: string,
  testRun: PixelGoldenRun,
  bookBytes: Buffer,
): Promise<PixelRunRenderResult> {
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    diagnostics.push(`page error: ${error.message}`);
  });

  await page.goto(`${origin}/render.html`);
  await waitForRenderApi(page, diagnostics);

  const result = await page.evaluate(
    async ({ browserRun, bookBase64 }) => {
      const api = window as unknown as BrowserRenderApi;
      return api.renderRitoPixelRun(browserRun, bookBase64);
    },
    {
      browserRun: testRun,
      bookBase64: bookBytes.toString('base64'),
    },
  );
  return {
    totalSpreads: result.totalSpreads,
    spreads: result.spreads.map((spread) => ({
      spreadIndex: spread.spreadIndex,
      png: Buffer.from(spread.pngBase64, 'base64'),
    })),
  };
}

async function waitForRenderApi(page: Page, diagnostics: readonly string[]): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = window as unknown as BrowserRenderWindow;
      return typeof api.renderRitoPixelRun === 'function' || api.renderRitoPixelReady !== 'loading';
    },
    undefined,
    { timeout: PAGE_READY_TIMEOUT_MS },
  );

  const readyState = await page.evaluate(() => {
    const api = window as unknown as BrowserRenderWindow;
    return {
      hasApi: typeof api.renderRitoPixelRun === 'function',
      ready: api.renderRitoPixelReady,
    };
  });

  if (readyState.hasApi) return;

  const details = diagnostics.length > 0 ? `\n${diagnostics.join('\n')}` : '';
  throw new Error(
    `Rito pixel render page failed to load: ${readyState.ready ?? 'unknown'}${details}`,
  );
}
