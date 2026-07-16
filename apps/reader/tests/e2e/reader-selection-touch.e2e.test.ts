import { expect, test, type Page } from '@playwright/test';
import {
  copySelection,
  loadSelectionFixture,
  pointInsideFirstWord,
  requireBand,
  requireTextBands,
  selectionRectCount,
  selectionTextLength,
} from './reader-selection-harness';
import {
  createReaderTouchInput,
  moveTouchAlongPath,
  type ReaderTouchInput,
} from './reader-touch-input';
import { SAME_FLOW_SELECTION_TEXT } from './selection-fixture';

const LONG_PRESS_SETTLE_MS = 400;

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('reader native touch selection acceptance', () => {
  let touchInput: ReaderTouchInput | null = null;

  test.beforeEach(async ({ page }) => {
    touchInput = await createReaderTouchInput(page);
    await openEmptyReader(page);
    await loadSelectionFixture(page);
  });

  test.afterEach(async () => {
    await touchInput?.dispose();
    touchInput = null;
  });

  test('long-presses a word and keeps the highlight after release', async ({ page }) => {
    const firstLine = requireBand(await requireTextBands(page, 2), 0);
    const start = pointInsideFirstWord(firstLine);
    const input = requireTouchInput(touchInput);

    await input.start(start);
    await page.waitForTimeout(LONG_PRESS_SETTLE_MS);
    await expect(page.getByTestId('reader-shell')).toHaveAttribute(
      'data-selection-text-length',
      String('ALPHA'.length),
    );
    await input.end();

    await expectReleasedSelection(page, 'ALPHA'.length, 1);
    expect(await copySelection(page)).toBe('ALPHA');
  });

  test('extends across lines and keeps an immediate release', async ({ page }) => {
    const bands = await requireTextBands(page, 2);
    const firstLine = requireBand(bands, 0);
    const secondLine = requireBand(bands, 1);
    const start = pointInsideFirstWord(firstLine);
    const end = { x: secondLine.right, y: secondLine.centerY };
    const input = requireTouchInput(touchInput);

    await input.start(start);
    await page.waitForTimeout(LONG_PRESS_SETTLE_MS);
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-selection-active', 'true');
    await moveTouchAlongPath(input, start, end);
    await input.end();

    await expectReleasedSelection(page, SAME_FLOW_SELECTION_TEXT.length, 2);
    expect(await copySelection(page)).toBe(SAME_FLOW_SELECTION_TEXT);
  });

  test('cancels an active long-press without committing it', async ({ page }) => {
    const firstLine = requireBand(await requireTextBands(page, 2), 0);
    const input = requireTouchInput(touchInput);
    await input.start(pointInsideFirstWord(firstLine));
    await page.waitForTimeout(LONG_PRESS_SETTLE_MS);
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-selection-active', 'true');

    await input.cancel();

    const shell = page.getByTestId('reader-shell');
    await expect(shell).toHaveAttribute('data-selection-active', 'false');
    await expect.poll(() => selectionTextLength(page)).toBe(0);
    await expect.poll(() => selectionRectCount(page)).toBe(0);
    await page.waitForTimeout(300);
    await expect(shell).toHaveAttribute('data-selection-active', 'false');
    expect(await selectionTextLength(page)).toBe(0);
    expect(await selectionRectCount(page)).toBe(0);
  });
});

function requireTouchInput(input: ReaderTouchInput | null): ReaderTouchInput {
  if (!input) throw new Error('Reader touch input is unavailable');
  return input;
}

async function expectReleasedSelection(
  page: Page,
  minimumTextLength: number,
  minimumRectCount: number,
): Promise<void> {
  const shell = page.getByTestId('reader-shell');
  await expect(shell).toHaveAttribute('data-selection-active', 'true');
  await expect.poll(() => selectionTextLength(page)).toBeGreaterThanOrEqual(minimumTextLength);
  await expect.poll(() => selectionRectCount(page)).toBeGreaterThanOrEqual(minimumRectCount);
  const selectedTextLength = await selectionTextLength(page);
  await page.waitForTimeout(300);
  await expect(shell).toHaveAttribute('data-selection-active', 'true');
  expect(await selectionTextLength(page)).toBe(selectedTextLength);
}

async function openEmptyReader(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
}
