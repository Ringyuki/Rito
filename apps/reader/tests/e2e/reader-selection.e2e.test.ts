import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stableReaderCanvasChecksum } from './reader-page-harness';
import {
  imageDecodeComplete,
  imageDecodePending,
  installDelayedImageDecode,
  releaseImageDecode,
} from './reader-image-decode-harness';
import {
  chromiumSelectionOracle,
  copySelection,
  currentReaderSpread,
  dragSelection,
  loadEdgeSelectionFixture,
  loadSelectionFixture,
  pointInsideFirstWord,
  prepareEdgeSelectionFixture,
  readSelectionHighlightBands,
  readerSurfaceBounds,
  requireBand,
  requireTextBands,
  selectionRectCount,
  selectionTextLength,
  waitForReaderTransitionEnd,
  waitForVisibleDocumentText,
  type CanvasTextBand,
  type ChromiumSelectionOracle,
} from './reader-selection-harness';
import {
  CJK_FIRST_LINE,
  CJK_SELECTION_TEXT,
  CROSS_FLOW_LINE,
  CROSS_FLOW_SELECTION_TEXT,
  EDGE_FIRST_PAGE_TEXT,
  EDGE_SECOND_PAGE_TEXT,
  EDGE_SELECTION_TEXT,
  SAME_FLOW_FIRST_LINE,
  SAME_FLOW_PARAGRAPH_SELECTION_TEXT,
  SAME_FLOW_SECOND_LINE,
  SAME_FLOW_SELECTION_TEXT,
} from './selection-fixture';

const TINOS_PINNED_FAMILY = pinnedFamily('Tinos-Regular.ttf');
const SOURCE_HAN_PINNED_FAMILY = pinnedFamily('SourceHanSerifCN-Regular.otf');
const EDGE_INSET_PX = 4;

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('reader native text selection acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await openEmptyReader(page);
    await loadSelectionFixture(page);
  });

  test('selects across visual lines in one paragraph and keeps the highlight after release', async ({
    page,
  }) => {
    const cleanCanvas = await stableReaderCanvasChecksum(page);
    const bands = await requireTextBands(page, 2);
    const firstLine = requireBand(bands, 0);
    const secondLine = requireBand(bands, 1);

    await dragSelection(page, firstLine, secondLine);

    const shell = page.getByTestId('reader-shell');
    await expect(shell).toHaveAttribute('data-selection-active', 'true');
    await expect
      .poll(() => selectionTextLength(page))
      .toBeGreaterThanOrEqual(SAME_FLOW_FIRST_LINE.length + SAME_FLOW_SECOND_LINE.length);
    await expect.poll(() => selectionRectCount(page)).toBeGreaterThanOrEqual(2);
    await expect
      .poll(async () => (await readSelectionHighlightBands(page)).length)
      .toBeGreaterThanOrEqual(2);

    const selectedTextLength = await selectionTextLength(page);
    const selectedCanvas = await stableReaderCanvasChecksum(page);
    expect(selectedCanvas).not.toBe(cleanCanvas);

    await page.waitForTimeout(300);
    await expect(shell).toHaveAttribute('data-selection-active', 'true');
    expect(await selectionTextLength(page)).toBe(selectedTextLength);
    expect(await stableReaderCanvasChecksum(page)).toBe(selectedCanvas);
    expect(await copySelection(page)).toBe(SAME_FLOW_SELECTION_TEXT);
  });

  test('extends one native selection across adjacent paragraphs', async ({ page }) => {
    const bands = await requireTextBands(page, 4);
    await dragSelection(page, requireBand(bands, 0), requireBand(bands, 3));

    const shell = page.getByTestId('reader-shell');
    await expect(shell).toHaveAttribute('data-selection-active', 'true');
    await expect
      .poll(() => selectionTextLength(page))
      .toBeGreaterThanOrEqual(
        SAME_FLOW_FIRST_LINE.length + SAME_FLOW_SECOND_LINE.length + CROSS_FLOW_LINE.length,
      );
    await expect.poll(() => selectionRectCount(page)).toBeGreaterThanOrEqual(4);
    expect(await copySelection(page)).toBe(CROSS_FLOW_SELECTION_TEXT);
  });

  test('paints the same vertical font box as Chromium native selection', async ({ page }) => {
    const bands = await requireTextBands(page, 2);
    const firstBand = requireBand(bands, 0);
    await dragSelection(page, firstBand, requireBand(bands, 1));
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-selection-active', 'true');

    const oracle = await chromiumSelectionOracle(page, TINOS_PINNED_FAMILY);
    await expectSelectionFontBox(page, firstBand, oracle);
  });

  test('keeps the original anchor when one drag crosses it and reverses direction', async ({
    page,
  }) => {
    const bands = await requireTextBands(page, 4);
    const firstLine = requireBand(bands, 0);
    const anchorLine = requireBand(bands, 1);
    const forwardLine = requireBand(bands, 3);

    await page.mouse.move(anchorLine.right, anchorLine.centerY);
    await page.mouse.down();
    await page.mouse.move(forwardLine.right, forwardLine.centerY, { steps: 8 });
    await page.mouse.move(firstLine.left, firstLine.centerY, { steps: 12 });
    await page.mouse.up();

    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-selection-active', 'true');
    await expect.poll(() => selectionRectCount(page)).toBeGreaterThanOrEqual(2);
    expect(await copySelection(page)).toBe(SAME_FLOW_SELECTION_TEXT);
  });

  test('uses native word and paragraph granularity for repeated mouse clicks', async ({ page }) => {
    const firstLine = requireBand(await requireTextBands(page, 2), 0);
    const point = pointInsideFirstWord(firstLine);

    await page.mouse.dblclick(point.x, point.y);
    await expect(page.getByTestId('reader-shell')).toHaveAttribute(
      'data-selection-text-length',
      String('ALPHA'.length),
    );
    expect(await copySelection(page)).toBe('ALPHA');

    await page.mouse.click(point.x, point.y, { clickCount: 3 });
    await expect.poll(() => selectionRectCount(page)).toBeGreaterThanOrEqual(2);
    expect(await copySelection(page)).toBe(SAME_FLOW_PARAGRAPH_SELECTION_TEXT);

    const lastParagraph = pointInsideFirstWord(requireBand(await requireTextBands(page, 4), 3));
    await page.mouse.click(lastParagraph.x, lastParagraph.y, { clickCount: 3 });
    expect(await copySelection(page)).toBe(CROSS_FLOW_LINE);
  });

  test('extends a double-click word selection across paragraph flows', async ({ page }) => {
    const bands = await requireTextBands(page, 4);
    const start = pointInsideFirstWord(requireBand(bands, 0));
    const end = requireBand(bands, 3);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.move(end.right, end.centerY, { steps: 12 });
    await page.mouse.up({ clickCount: 2 });

    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-selection-active', 'true');
    expect(await copySelection(page)).toBe(CROSS_FLOW_SELECTION_TEXT);
  });
});

test('paints Chinese Source Han selection with Chromium native font geometry', async ({ page }) => {
  await openEmptyReader(page);
  await loadSelectionFixture(page, { locale: 'cjk' });
  const bands = await requireTextBands(page, 2);
  const firstBand = requireBand(bands, 0);
  await dragSelection(page, firstBand, requireBand(bands, 1));
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-selection-active', 'true');

  const oracle = await chromiumSelectionOracle(page, SOURCE_HAN_PINNED_FAMILY, CJK_FIRST_LINE);
  await expectSelectionFontBox(page, firstBand, oracle);
  expect(await copySelection(page)).toBe(CJK_SELECTION_TEXT);
});

test.describe('reader native selection resource invalidation', () => {
  test('keeps a released visual selection when an image finishes decoding', async ({ page }) => {
    await installDelayedImageDecode(page);
    await openEmptyReader(page);
    await loadSelectionFixture(page, { includeImage: true });
    await expect.poll(() => imageDecodePending(page)).toBe(true);

    const bands = await requireTextBands(page, 2);
    await dragSelection(page, requireBand(bands, 0), requireBand(bands, 1));
    const shell = page.getByTestId('reader-shell');
    await expect(shell).toHaveAttribute('data-selection-active', 'true');
    const selectedTextLength = await selectionTextLength(page);
    const pendingImageCanvas = await stableReaderCanvasChecksum(page);
    const pendingHighlight = requireBand(await readSelectionHighlightBands(page), 0);

    await releaseImageDecode(page);
    await expect.poll(() => imageDecodeComplete(page)).toBe(true);
    await page.waitForTimeout(300);
    const decodedImageCanvas = await stableReaderCanvasChecksum(page);
    const decodedHighlight = requireBand(await readSelectionHighlightBands(page), 0);

    await expect(shell).toHaveAttribute('data-selection-active', 'true');
    expect(decodedImageCanvas).not.toBe(pendingImageCanvas);
    expect(decodedHighlight.top).toBeCloseTo(pendingHighlight.top, 6);
    expect(decodedHighlight.height).toBeCloseTo(pendingHighlight.height, 6);
    expect(await selectionTextLength(page)).toBe(selectedTextLength);
    expect(await copySelection(page)).toBe(SAME_FLOW_SELECTION_TEXT);
  });
});

test.describe('reader primary selection edge autoscroll acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await openEmptyReader(page);
    await loadEdgeSelectionFixture(page);
    await prepareEdgeSelectionFixture(page);
  });

  test('continues a mouse drag through lazy pagination and preserves exact copy', async ({
    page,
  }) => {
    const shell = page.getByTestId('reader-shell');
    const firstLine = requireBand(await requireTextBands(page, 1), 0);
    const surface = await readerSurfaceBounds(page);
    const edgePoint = { x: surface.right - EDGE_INSET_PX, y: firstLine.centerY };

    await page.mouse.move(firstLine.left, firstLine.centerY);
    await page.mouse.down();
    await page.mouse.move(edgePoint.x, edgePoint.y, { steps: 12 });

    await expect.poll(() => currentReaderSpread(page), { timeout: 5_000 }).toBe(1);
    await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBe(2);
    await expect(shell).toHaveAttribute('data-pagination-complete', 'true');
    await waitForVisibleDocumentText(page, EDGE_SECOND_PAGE_TEXT);
    await stableReaderCanvasChecksum(page);
    const secondLine = requireBand(await requireTextBands(page, 1), 0);
    await page.mouse.move(secondLine.right, secondLine.centerY, { steps: 12 });
    await page.mouse.up();

    await expectReleasedEdgeSelection(page);
    expect(await currentReaderSpread(page)).toBe(1);
    expect(await copySelection(page)).toBe(EDGE_SELECTION_TEXT);
  });

  test('continues a reverse mouse drag into the previous published spread', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBe(2);
    await expect.poll(() => currentReaderSpread(page)).toBe(1);
    await waitForReaderTransitionEnd(page);
    await waitForVisibleDocumentText(page, EDGE_SECOND_PAGE_TEXT);
    await stableReaderCanvasChecksum(page);
    const secondLine = requireBand(await requireTextBands(page, 1), 0);
    const surface = await readerSurfaceBounds(page);
    const edgePoint = { x: surface.left + EDGE_INSET_PX, y: secondLine.centerY };

    await page.mouse.move(secondLine.right, secondLine.centerY);
    await page.mouse.down();
    await page.mouse.move(edgePoint.x, edgePoint.y, { steps: 12 });

    await expect.poll(() => currentReaderSpread(page), { timeout: 5_000 }).toBe(0);
    await waitForVisibleDocumentText(page, EDGE_FIRST_PAGE_TEXT);
    await stableReaderCanvasChecksum(page);
    const firstLine = requireBand(await requireTextBands(page, 1), 0);
    await page.mouse.move(firstLine.left, firstLine.centerY, { steps: 12 });
    await page.mouse.up();

    await expectReleasedEdgeSelection(page);
    expect(await currentReaderSpread(page)).toBe(0);
    expect(await copySelection(page)).toBe(EDGE_SELECTION_TEXT);
  });
});

async function openEmptyReader(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
}

async function expectSelectionFontBox(
  page: Page,
  textBand: CanvasTextBand,
  oracle: ChromiumSelectionOracle,
): Promise<void> {
  const shell = page.getByTestId('reader-shell');
  const modelHeight = Number(await shell.getAttribute('data-selection-first-rect-height'));
  const modelTop = Number(await shell.getAttribute('data-selection-first-rect-y'));
  const visual = requireBand(await readSelectionHighlightBands(page), 0);

  expect(modelHeight).toBeGreaterThan(0);
  expect(Math.abs(modelHeight - oracle.height)).toBeLessThanOrEqual(0.25);
  const modelTopDelta = modelTop - textBand.logicalCenterY - oracle.topFromCanvasInkCenter;
  expect(
    Math.abs(modelTopDelta),
    JSON.stringify({ modelTop, textBand, oracle }),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(visual.top - modelTop), JSON.stringify({ visual, modelTop })).toBeLessThanOrEqual(
    1,
  );
  expect(
    Math.abs(visual.height - modelHeight),
    JSON.stringify({ visual, modelHeight }),
  ).toBeLessThanOrEqual(1);
}

async function expectReleasedEdgeSelection(page: Page): Promise<void> {
  const shell = page.getByTestId('reader-shell');
  await expect(shell).toHaveAttribute('data-selection-active', 'true');
  await expect.poll(() => selectionTextLength(page)).toBe(EDGE_SELECTION_TEXT.length);
  await expect.poll(() => selectionRectCount(page)).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300);
  await expect(shell).toHaveAttribute('data-selection-active', 'true');
  expect(await selectionTextLength(page)).toBe(EDGE_SELECTION_TEXT.length);
}

async function readerNumberAttribute(page: Page, name: string): Promise<number> {
  return Number((await page.getByTestId('reader-shell').getAttribute(name)) ?? '0');
}

function pinnedFamily(fileName: string): string {
  return `__RitoPinned_${createHash('sha256')
    .update(readFileSync(new URL(`../../src/assets/fonts/${fileName}`, import.meta.url)))
    .digest('hex')}`;
}
