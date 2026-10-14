import { expect, test, type Page } from '@playwright/test';
import {
  installFirstVisibleReaderFrameProbe,
  readFirstVisibleReaderFrame,
} from './reader-first-frame-probe';
import { stableReaderCanvasSampleChecksum } from './reader-page-harness';
import { installReaderWorkerProbe, readReaderWorkerOperations } from './reader-worker-probe';

const READER_LOAD_TIMEOUT_MS = 90_000;
const TARGET_HREF = 'Text/Section001.xhtml';
const TARGET_TURNS_FROM_CHAPTER_START = 2;

interface ExactSourcePoint {
  readonly nodePath: readonly number[];
  readonly textOffset: number;
}

/** A persisted position: a page of text is anchored at a source point, a plate at its progression. */
interface ExactSavedPosition {
  readonly sourceLocator: {
    readonly href: string;
    readonly sourcePoint?: ExactSourcePoint | undefined;
    readonly progression?: number | undefined;
  };
  readonly projection: {
    readonly spreadIndex: number;
    readonly pageIndex: number;
  };
}

test('restores a saved position before the first visible reader frame', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await loadDemoBook(page);
  const spreadZeroChecksum = await stableReaderCanvasSampleChecksum(page);

  const expectedPosition = await moveToExactChapterPosition(page);
  const expectedSpread = expectedPosition.projection.spreadIndex;
  const expectedChecksum = await stableReaderCanvasSampleChecksum(page);
  expect(expectedSpread).toBeGreaterThan(0);
  expect(expectedChecksum).not.toBe(spreadZeroChecksum);

  await installReaderWorkerProbe(page);
  await page.reload();
  await expect(page.getByTestId('reader-empty')).toBeVisible();
  await installFirstVisibleReaderFrameProbe(page);
  await loadDemoBook(page);
  await expect
    .poll(async () => {
      const frame = await readFirstVisibleReaderFrame(page);
      return frame.checksum !== null && frame.firstLoadedSpread !== null;
    })
    .toBe(true);

  // The first frame is the saved page itself: the session opens on the
  // saved position's chapter and lays the rest of the book out behind it,
  // so the page is on screen before its book-wide spread number is known.
  const firstFrame = await readFirstVisibleReaderFrame(page);
  expect(firstFrame.checksum).toBe(expectedChecksum);
  await expect.poll(() => currentSpread(page)).toBe(expectedSpread);
  expect(await readerAttribute(page, 'data-active-chapter-href')).toContain('Section001.xhtml');

  const restoredPosition = await readExactSavedPosition(page);
  expect(restoredPosition?.sourceLocator).toEqual(expectedPosition.sourceLocator);
  expect(restoredPosition?.projection).toEqual(expectedPosition.projection);

  // One session, opened on that position: nothing was laid out and thrown
  // away to get there.
  const operations = await readReaderWorkerOperations(page);
  expect(operations.some((operation) => operation.ok === false)).toBe(false);
  expect(operations.filter((operation) => operation.kind === 'open')).toHaveLength(1);
  expect(operations.some((operation) => operation.kind === 'request-artifact')).toBe(false);
});

async function loadDemoBook(page: Page): Promise<void> {
  const shell = page.getByTestId('reader-shell');
  await expect(page.getByTestId('reader-empty')).toBeVisible();
  await page.getByTestId('load-demo-button').click();
  await expect(shell).toHaveAttribute('data-loaded', 'true', {
    timeout: READER_LOAD_TIMEOUT_MS,
  });
}

async function currentSpread(page: Page): Promise<number> {
  return Number(await readerAttribute(page, 'data-current-spread'));
}

async function readerAttribute(page: Page, name: string): Promise<string> {
  return (await page.getByTestId('reader-shell').getAttribute(name)) ?? '';
}

async function moveToExactChapterPosition(page: Page): Promise<ExactSavedPosition> {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Contents/ }).click();
  await page.getByRole('button', { name: /第1话/ }).click();
  await expect
    .poll(() => readerAttribute(page, 'data-active-chapter-href'), {
      timeout: READER_LOAD_TIMEOUT_MS,
    })
    .toContain('Section001.xhtml');
  await waitForExactPositionAtCurrentSpread(page);

  for (let turn = 0; turn < TARGET_TURNS_FROM_CHAPTER_START; turn += 1) {
    const previousSpread = await currentSpread(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => currentSpread(page)).toBeGreaterThan(previousSpread);
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-transitioning', 'false');
    await waitForExactPositionAtCurrentSpread(page);
  }
  expect(await readerAttribute(page, 'data-active-chapter-href')).toContain('Section001.xhtml');
  const expectedSpread = await currentSpread(page);
  await expect
    .poll(async () => (await readExactSavedPosition(page))?.projection.spreadIndex ?? -1, {
      timeout: READER_LOAD_TIMEOUT_MS,
    })
    .toBe(expectedSpread);
  const position = await readExactSavedPosition(page);
  if (!position) throw new Error('Reader did not persist an exact source position');
  return position;
}

async function waitForExactPositionAtCurrentSpread(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const position = await readExactSavedPosition(page);
        return position?.projection.spreadIndex === (await currentSpread(page));
      },
      { timeout: READER_LOAD_TIMEOUT_MS },
    )
    .toBe(true);
}

async function readExactSavedPosition(page: Page): Promise<ExactSavedPosition | null> {
  return page.evaluate((targetHref) => {
    // The demo keeps one position per book.
    const key = Object.keys(localStorage).find((name) => name.startsWith('rito-position:'));
    const serialized = key === undefined ? null : localStorage.getItem(key);
    if (!serialized) return null;
    try {
      return parseExactSavedPosition(JSON.parse(serialized) as unknown);
    } catch {
      return null;
    }

    function parseExactSavedPosition(value: unknown): ExactSavedPosition | null {
      const position = objectValue(value);
      const sourceLocator = objectValue(position?.['sourceLocator']);
      const sourcePoint = objectValue(sourceLocator?.['sourcePoint']);
      const projection = objectValue(position?.['projection']);
      const nodePath = sourcePoint?.['nodePath'];
      const exactPoint =
        Array.isArray(nodePath) &&
        nodePath.every((part) => Number.isSafeInteger(part) && part >= 0) &&
        typeof sourcePoint?.['textOffset'] === 'number' &&
        Number.isSafeInteger(sourcePoint['textOffset']);
      if (
        sourceLocator?.['href'] !== targetHref ||
        (sourcePoint !== undefined && !exactPoint) ||
        (sourcePoint === undefined && typeof sourceLocator['progression'] !== 'number') ||
        typeof projection?.['spreadIndex'] !== 'number' ||
        !Number.isSafeInteger(projection['spreadIndex']) ||
        typeof projection['pageIndex'] !== 'number' ||
        !Number.isSafeInteger(projection['pageIndex'])
      ) {
        return null;
      }
      const progression = sourceLocator['progression'];
      return {
        sourceLocator: {
          href: sourceLocator['href'],
          ...(exactPoint
            ? {
                sourcePoint: {
                  nodePath: nodePath as number[],
                  textOffset: sourcePoint['textOffset'] as number,
                },
              }
            : {}),
          ...(typeof progression === 'number' ? { progression } : {}),
        },
        projection: {
          spreadIndex: projection['spreadIndex'],
          pageIndex: projection['pageIndex'],
        },
      };
    }

    function objectValue(value: unknown): Record<string, unknown> | undefined {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    }
  }, TARGET_HREF);
}
