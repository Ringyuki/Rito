import { expect, test, type Page } from '@playwright/test';
import {
  copySelection,
  currentReaderSpread,
  loadEdgeSelectionFixture,
  loadSelectionFixture,
  pointInsideFirstWord,
  readerSurfaceBounds,
  requireBand,
  requireTextBands,
  selectionRectCount,
  selectionTextLength,
  waitForVisibleDocumentText,
  waitForReaderTransitionEnd,
} from './reader-selection-harness';
import {
  createReaderTouchInput,
  moveTouchAlongPath,
  type ReaderTouchInput,
} from './reader-touch-input';
import { stableReaderCanvasChecksum } from './reader-page-harness';
import {
  EDGE_FIRST_PAGE_TEXT,
  EDGE_SECOND_PAGE_TEXT,
  EDGE_SELECTION_TEXT,
  SAME_FLOW_SELECTION_TEXT,
} from './selection-fixture';

const LONG_PRESS_SETTLE_MS = 400;
const EDGE_INSET_PX = 4;

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

  test('drags the exact end handle across lines through pointer capture', async ({ page }) => {
    const bands = await requireTextBands(page, 2);
    const firstLine = requireBand(bands, 0);
    const secondLine = requireBand(bands, 1);
    const input = requireTouchInput(touchInput);

    await input.start(pointInsideFirstWord(firstLine));
    await page.waitForTimeout(LONG_PRESS_SETTLE_MS);
    await input.end();
    await expectReleasedSelection(page, 'ALPHA'.length, 1);

    const handleStart = await selectionHandleCenter(page, 'end');
    const handleEnd = {
      x: secondLine.right,
      // Keep the finger on the lower knob while placing its caret on the second line.
      y: secondLine.centerY + (handleStart.y - firstLine.centerY),
    };
    await input.start(handleStart);
    await moveTouchAlongPath(input, handleStart, handleEnd);
    await input.end();

    await expectReleasedSelection(page, SAME_FLOW_SELECTION_TEXT.length, 2);
    expect(await copySelection(page)).toBe(SAME_FLOW_SELECTION_TEXT);
  });

  test('rolls a cancelled handle drag back to its retained baseline', async ({ page }) => {
    const firstLine = requireBand(await requireTextBands(page, 2), 0);
    const input = requireTouchInput(touchInput);

    await input.start(pointInsideFirstWord(firstLine));
    await page.waitForTimeout(LONG_PRESS_SETTLE_MS);
    await input.end();
    await expectReleasedSelection(page, 'ALPHA'.length, 1);

    const handleStart = await selectionHandleCenter(page, 'end');
    await input.start(handleStart);
    await moveTouchAlongPath(input, handleStart, {
      x: firstLine.right,
      y: handleStart.y,
    });
    await expect.poll(() => selectionTextLength(page)).toBeGreaterThan('ALPHA'.length);
    await input.cancel();

    await expectReleasedSelection(page, 'ALPHA'.length, 1);
    expect(await selectionTextLength(page)).toBe('ALPHA'.length);
    expect(await copySelection(page)).toBe('ALPHA');
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

test.describe('reader touch selection edge autoscroll acceptance', () => {
  let touchInput: ReaderTouchInput | null = null;

  test.beforeEach(async ({ page }) => {
    touchInput = await createReaderTouchInput(page);
    await openEmptyReader(page);
    await loadEdgeSelectionFixture(page);
    await prepareEdgeSelectionFixture(page);
  });

  test.afterEach(async () => {
    await touchInput?.dispose();
    touchInput = null;
  });

  test('autoscrolls a captured end handle into the next spread', async ({ page }) => {
    const input = requireTouchInput(touchInput);
    const firstLine = requireBand(await requireTextBands(page, 1), 0);
    await selectTouchWord(page, input, firstLine, EDGE_FIRST_PAGE_TEXT);

    const handleStart = await selectionHandleCenter(page, 'end');
    const surface = await readerSurfaceBounds(page);
    const edgePoint = { x: surface.right - EDGE_INSET_PX, y: handleStart.y };
    const knobOffsetY = handleStart.y - firstLine.centerY;
    await input.start(handleStart);
    await moveTouchAlongPath(input, handleStart, edgePoint);

    await expect.poll(() => currentReaderSpread(page), { timeout: 5_000 }).toBe(1);
    await waitForVisibleDocumentText(page, EDGE_SECOND_PAGE_TEXT);
    await stableReaderCanvasChecksum(page);
    const secondLine = requireBand(await requireTextBands(page, 1), 0);
    const handleEnd = {
      x: secondLine.right,
      y: secondLine.centerY + knobOffsetY,
    };
    await moveTouchAlongPath(input, edgePoint, handleEnd);
    await input.end();

    await expectReleasedSelection(page, EDGE_SELECTION_TEXT.length, 1);
    expect(await currentReaderSpread(page)).toBe(1);
    expect(await copySelection(page)).toBe(EDGE_SELECTION_TEXT);
  });

  test('autoscrolls a captured start handle into the previous spread', async ({ page }) => {
    const input = requireTouchInput(touchInput);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => currentReaderSpread(page)).toBe(1);
    await waitForReaderTransitionEnd(page);
    await waitForVisibleDocumentText(page, EDGE_SECOND_PAGE_TEXT);
    await stableReaderCanvasChecksum(page);
    const secondLine = requireBand(await requireTextBands(page, 1), 0);
    await selectTouchWord(page, input, secondLine, EDGE_SECOND_PAGE_TEXT);

    const handleStart = await selectionHandleCenter(page, 'start');
    const surface = await readerSurfaceBounds(page);
    const edgePoint = { x: surface.left + EDGE_INSET_PX, y: handleStart.y };
    const knobOffsetY = handleStart.y - secondLine.centerY;
    await input.start(handleStart);
    await moveTouchAlongPath(input, handleStart, edgePoint);

    await expect.poll(() => currentReaderSpread(page), { timeout: 5_000 }).toBe(0);
    await waitForVisibleDocumentText(page, EDGE_FIRST_PAGE_TEXT);
    await stableReaderCanvasChecksum(page);
    const firstLine = requireBand(await requireTextBands(page, 1), 0);
    const handleEnd = {
      x: Math.max(surface.left + EDGE_INSET_PX, firstLine.left - 8),
      y: firstLine.centerY + knobOffsetY,
    };
    await moveTouchAlongPath(input, edgePoint, handleEnd);
    await input.end();

    await expectReleasedSelection(page, EDGE_SELECTION_TEXT.length, 1);
    expect(await currentReaderSpread(page)).toBe(0);
    expect(await copySelection(page)).toBe(EDGE_SELECTION_TEXT);
  });
});

function requireTouchInput(input: ReaderTouchInput | null): ReaderTouchInput {
  if (!input) throw new Error('Reader touch input is unavailable');
  return input;
}

async function selectTouchWord(
  page: Page,
  input: ReaderTouchInput,
  line: { readonly left: number; readonly centerY: number },
  expectedText: string,
): Promise<void> {
  await input.start({ x: line.left + 10, y: line.centerY });
  await page.waitForTimeout(LONG_PRESS_SETTLE_MS);
  await expect(page.getByTestId('reader-shell')).toHaveAttribute(
    'data-selection-text-length',
    String(expectedText.length),
  );
  await input.end();
  await expectReleasedSelection(page, expectedText.length, 1);
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

async function prepareEdgeSelectionFixture(page: Page): Promise<void> {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Reader Settings/ }).click();
  const heading = page.getByRole('heading', { name: 'Reader Settings' });
  await expect(heading).toBeVisible();
  await page.getByRole('button', { name: 'Single Page' }).click();
  await page.keyboard.press('Escape');
  await expect(heading).toBeHidden();

  const shell = page.getByTestId('reader-shell');
  await expect(shell).toHaveAttribute('data-spread-mode', 'single');
  await expect(shell).toHaveAttribute('data-pagination-complete', 'false');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBe(2);
  await expect(shell).toHaveAttribute('data-pagination-complete', 'true');
  await expect.poll(() => currentReaderSpread(page)).toBe(1);
  await waitForReaderTransitionEnd(page);
  await page.keyboard.press('Home');
  await expect.poll(() => currentReaderSpread(page)).toBe(0);
  await waitForReaderTransitionEnd(page);
  await waitForVisibleDocumentText(page, EDGE_FIRST_PAGE_TEXT);
  await stableReaderCanvasChecksum(page);
}

async function readerNumberAttribute(page: Page, name: string): Promise<number> {
  return Number((await page.getByTestId('reader-shell').getAttribute(name)) ?? '0');
}

async function selectionHandleCenter(
  page: Page,
  edge: 'start' | 'end',
): Promise<{ readonly x: number; readonly y: number }> {
  const handle = page.getByTestId(`selection-handle-${edge}`);
  await expect(handle).toBeVisible();
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error(`Selection ${edge} handle has no bounds`);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
