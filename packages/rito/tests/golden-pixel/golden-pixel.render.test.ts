import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { BOOK_FIXTURE_ROOT } from '../golden-books/helpers/book-manifest';
import { comparePng } from './helpers/png-diff';
import { getPixelGoldenCases, type PixelGoldenCase } from './helpers/pixel-cases';
import {
  readPixelGoldenFile,
  SHOULD_REVIEW_PIXEL_GOLDEN,
  SHOULD_RUN_PIXEL_GOLDEN,
  SHOULD_UPDATE_PIXEL_GOLDEN,
  writePixelGoldenFile,
} from './helpers/pixel-golden-file';
import {
  pixelReviewCasePaths,
  resetPixelReviewReport,
  writePixelReviewCase,
  writePixelReviewIndex,
  type PixelReviewRecord,
} from './helpers/pixel-review';
import { startPixelRenderServer, type PixelRenderServer } from './helpers/render-server';

interface BrowserRenderApi {
  renderRitoPixelCase(testCase: PixelGoldenCase, bookBase64: string): Promise<string>;
}

interface BrowserRenderWindow extends Partial<BrowserRenderApi> {
  renderRitoPixelReady?: string;
}

const PAGE_READY_TIMEOUT_MS = 30_000;

test.describe.configure({ mode: 'serial' });

test.describe('golden pixel render snapshots', () => {
  const cases = getPixelGoldenCases();
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

  test('has enabled pixel cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const { testCase, book } of cases) {
    test(testCase.id, async ({ page }, testInfo) => {
      if (!server) throw new Error('Pixel render server did not start');
      const bookBytes = await readFile(resolve(BOOK_FIXTURE_ROOT, book.path));
      const actual = await renderPixelCase(page, server.origin, testCase, bookBytes);

      if (SHOULD_UPDATE_PIXEL_GOLDEN) {
        await writePixelGoldenFile(testCase, actual);
        return;
      }

      const expected = await readPixelGoldenFile(testCase);
      if (SHOULD_REVIEW_PIXEL_GOLDEN) {
        reviewRecords.push(await reviewPixelCase(testCase, expected, actual));
        return;
      }

      expect(
        expected,
        'Run pnpm test:golden:pixel:update to create/update this golden',
      ).toBeDefined();
      if (!expected) return;

      const actualPath = testInfo.outputPath(`${testCase.id}-actual.png`);
      const diffPath = testInfo.outputPath(`${testCase.id}-diff.png`);
      const result = await comparePng(expected, actual, testCase, diffPath);
      if (result.diffRatio > testCase.maxDiffPixelRatio) {
        await writeOutput(actualPath, actual);
      }

      expect(
        result.diffRatio,
        formatDiffMessage(testCase, result.diffPixels, result.diffRatio),
      ).toBeLessThanOrEqual(testCase.maxDiffPixelRatio);
    });
  }
});

async function renderPixelCase(
  page: Page,
  origin: string,
  testCase: PixelGoldenCase,
  bookBytes: Buffer,
): Promise<Buffer> {
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    diagnostics.push(`page error: ${error.message}`);
  });

  await page.goto(`${origin}/render.html`);
  await waitForRenderApi(page, diagnostics);

  const pngBase64 = await page.evaluate(
    async ({ browserCase, bookBase64 }) => {
      const api = window as unknown as BrowserRenderApi;
      return api.renderRitoPixelCase(browserCase, bookBase64);
    },
    {
      browserCase: testCase,
      bookBase64: bookBytes.toString('base64'),
    },
  );
  return Buffer.from(pngBase64, 'base64');
}

async function reviewPixelCase(
  testCase: PixelGoldenCase,
  expected: Buffer | undefined,
  actual: Buffer,
): Promise<PixelReviewRecord> {
  if (!expected) return await writePixelReviewCase({ testCase, actual });

  const paths = pixelReviewCasePaths(testCase);
  try {
    const diff = await comparePng(expected, actual, testCase, paths.diffPath, {
      writeDiffWhenEqual: true,
    });
    return await writePixelReviewCase({ testCase, actual, expected, diff });
  } catch (error) {
    return await writePixelReviewCase({
      testCase,
      actual,
      expected,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function waitForRenderApi(page: Page, diagnostics: readonly string[]): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = window as unknown as BrowserRenderWindow;
      return (
        typeof api.renderRitoPixelCase === 'function' || api.renderRitoPixelReady !== 'loading'
      );
    },
    undefined,
    { timeout: PAGE_READY_TIMEOUT_MS },
  );

  const readyState = await page.evaluate(() => {
    const api = window as unknown as BrowserRenderWindow;
    return {
      hasApi: typeof api.renderRitoPixelCase === 'function',
      ready: api.renderRitoPixelReady,
    };
  });

  if (readyState.hasApi) return;

  const details = diagnostics.length > 0 ? `\n${diagnostics.join('\n')}` : '';
  throw new Error(
    `Rito pixel render page failed to load: ${readyState.ready ?? 'unknown'}${details}`,
  );
}

async function writeOutput(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function formatDiffMessage(
  testCase: PixelGoldenCase,
  diffPixels: number,
  diffRatio: number,
): string {
  return `${testCase.id} pixel diff ${String(diffPixels)} (${diffRatio.toFixed(6)}) exceeds ${String(
    testCase.maxDiffPixelRatio,
  )}`;
}
