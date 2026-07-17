import { expect, test, type Page } from '@playwright/test';
import {
  installFirstVisibleReaderFrameProbe,
  readFirstVisibleReaderFrame,
} from './reader-first-frame-probe';
import { stableReaderCanvasSampleChecksum } from './reader-page-harness';

const READER_LOAD_TIMEOUT_MS = 90_000;

test('restores a saved position before the first visible reader frame', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await loadDemoBook(page);
  const spreadZeroChecksum = await stableReaderCanvasSampleChecksum(page);

  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Contents/ }).click();
  await page.getByRole('button', { name: /第14话/ }).click();
  await expect
    .poll(() => readerAttribute(page, 'data-active-chapter-href'), {
      timeout: READER_LOAD_TIMEOUT_MS,
    })
    .toContain('Section014.xhtml');
  await expect.poll(() => currentSpread(page)).toBeGreaterThan(0);
  const targetSpread = await currentSpread(page);
  const targetChecksum = await stableReaderCanvasSampleChecksum(page);
  expect(targetChecksum).not.toBe(spreadZeroChecksum);

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('rito-position') ?? ''), {
      timeout: READER_LOAD_TIMEOUT_MS,
    })
    .toContain('Section014.xhtml');
  const savedSpread = await savedPositionSpread(page);
  expect(savedSpread).toBe(targetSpread);

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

  const firstFrame = await readFirstVisibleReaderFrame(page);
  expect(firstFrame.firstLoadedSpread).toBe(savedSpread);
  expect(await currentSpread(page)).toBe(savedSpread);
  expect(firstFrame.checksum).toBe(targetChecksum);
  expect(firstFrame.checksum).not.toBe(spreadZeroChecksum);
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

async function savedPositionSpread(page: Page): Promise<number> {
  return page.evaluate(() => {
    const serialized = localStorage.getItem('rito-position');
    if (!serialized) return -1;
    try {
      const value: unknown = JSON.parse(serialized);
      if (typeof value !== 'object' || value === null) return -1;
      const projection = (value as Record<string, unknown>)['projection'];
      if (typeof projection !== 'object' || projection === null) return -1;
      const spreadIndex = (projection as Record<string, unknown>)['spreadIndex'];
      return typeof spreadIndex === 'number' && Number.isSafeInteger(spreadIndex)
        ? spreadIndex
        : -1;
    } catch {
      return -1;
    }
  });
}
