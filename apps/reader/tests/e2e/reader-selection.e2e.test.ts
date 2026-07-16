import { expect, test, type Page } from '@playwright/test';
import { stableReaderCanvasChecksum } from './reader-page-harness';
import {
  createSelectionFixtureEpub,
  CROSS_FLOW_LINE,
  CROSS_FLOW_SELECTION_TEXT,
  SAME_FLOW_FIRST_LINE,
  SAME_FLOW_PARAGRAPH_SELECTION_TEXT,
  SAME_FLOW_SECOND_LINE,
  SAME_FLOW_SELECTION_TEXT,
} from './selection-fixture';

const READER_LOAD_TIMEOUT_MS = 90_000;

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

interface CanvasTextBand {
  readonly left: number;
  readonly right: number;
  readonly centerY: number;
}

test.describe('reader native text selection acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
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

    const selectedTextLength = await selectionTextLength(page);
    const selectedCanvas = await stableReaderCanvasChecksum(page);
    expect(selectedCanvas).not.toBe(cleanCanvas);

    await page.waitForTimeout(300);
    await expect(shell).toHaveAttribute('data-selection-active', 'true');
    expect(await selectionTextLength(page)).toBe(selectedTextLength);
    expect(await stableReaderCanvasChecksum(page)).toBe(selectedCanvas);

    const copied = await copySelection(page);
    expect(copied).toBe(SAME_FLOW_SELECTION_TEXT);
  });

  test('extends one native selection across adjacent paragraphs', async ({ page }) => {
    const bands = await requireTextBands(page, 4);
    const firstLine = requireBand(bands, 0);
    const nextParagraphLastLine = requireBand(bands, 3);

    await dragSelection(page, firstLine, nextParagraphLastLine);

    const shell = page.getByTestId('reader-shell');
    await expect(shell).toHaveAttribute('data-selection-active', 'true');
    await expect
      .poll(() => selectionTextLength(page))
      .toBeGreaterThanOrEqual(
        SAME_FLOW_FIRST_LINE.length + SAME_FLOW_SECOND_LINE.length + CROSS_FLOW_LINE.length,
      );
    await expect.poll(() => selectionRectCount(page)).toBeGreaterThanOrEqual(4);

    const copied = await copySelection(page);
    expect(copied).toBe(CROSS_FLOW_SELECTION_TEXT);
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

    const shell = page.getByTestId('reader-shell');
    await expect(shell).toHaveAttribute('data-selection-active', 'true');
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

async function loadSelectionFixture(page: Page): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('open-file-button').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'native-selection-fixture.epub',
    mimeType: 'application/epub+zip',
    buffer: createSelectionFixtureEpub(),
  });
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-loaded', 'true', {
    timeout: READER_LOAD_TIMEOUT_MS,
  });
  await expect.poll(() => visibleParagraphCount(page)).toBe(2);
}

async function dragSelection(
  page: Page,
  startBand: CanvasTextBand,
  endBand: CanvasTextBand,
): Promise<void> {
  await page.mouse.move(startBand.left, startBand.centerY);
  await page.mouse.down();
  await page.mouse.move(endBand.right, endBand.centerY, { steps: 12 });
  await page.mouse.up();
}

async function requireTextBands(page: Page, count: number): Promise<readonly CanvasTextBand[]> {
  const bands = await readCanvasTextBands(page);
  expect(bands.length).toBeGreaterThanOrEqual(count);
  return bands.slice(0, count);
}

function requireBand(bands: readonly CanvasTextBand[], index: number): CanvasTextBand {
  const band = bands[index];
  if (!band) throw new Error(`Missing Canvas text band ${String(index)}`);
  return band;
}

function pointInsideFirstWord(band: CanvasTextBand): { readonly x: number; readonly y: number } {
  return { x: band.left + 10, y: band.centerY };
}

async function readCanvasTextBands(page: Page): Promise<readonly CanvasTextBand[]> {
  return page
    .getByTestId('reader-shell')
    .locator('canvas')
    .evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Reader canvas is unavailable');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Reader canvas context is unavailable');
      const bounds = canvas.getBoundingClientRect();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const rows: { y: number; left: number; right: number }[] = [];
      for (let y = 0; y < canvas.height; y += 1) {
        let left = canvas.width;
        let right = -1;
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const alpha = pixels[offset + 3] ?? 0;
          const luminance =
            (pixels[offset] ?? 255) + (pixels[offset + 1] ?? 255) + (pixels[offset + 2] ?? 255);
          if (alpha > 32 && luminance < 570) {
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
        if (right >= left) rows.push({ y, left, right });
      }

      const groups: { top: number; bottom: number; left: number; right: number }[] = [];
      const backingScaleY = canvas.height / bounds.height;
      const adjacentRowGap = Math.max(2, Math.round(3 * backingScaleY));
      for (const row of rows) {
        const previous = groups.at(-1);
        if (previous && row.y <= previous.bottom + adjacentRowGap) {
          previous.bottom = row.y;
          previous.left = Math.min(previous.left, row.left);
          previous.right = Math.max(previous.right, row.right);
        } else {
          groups.push({ top: row.y, bottom: row.y, left: row.left, right: row.right });
        }
      }

      const scaleX = bounds.width / canvas.width;
      const scaleY = bounds.height / canvas.height;
      return groups
        .filter((group) => group.bottom - group.top >= 8 && group.right - group.left >= 40)
        .map((group) => ({
          left: bounds.left + (group.left + 2) * scaleX,
          right: bounds.left + (group.right - 2) * scaleX,
          centerY: bounds.top + ((group.top + group.bottom) / 2) * scaleY,
        }));
    });
}

async function selectionTextLength(page: Page): Promise<number> {
  return Number(
    (await page.getByTestId('reader-shell').getAttribute('data-selection-text-length')) ?? '0',
  );
}

async function selectionRectCount(page: Page): Promise<number> {
  return Number(
    (await page.getByTestId('reader-shell').getAttribute('data-selection-rect-count')) ?? '0',
  );
}

async function visibleParagraphCount(page: Page): Promise<number> {
  return page.locator('[role="document"][aria-live="polite"] p').count();
}

async function copySelection(page: Page): Promise<string> {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Copy/ }).click();
  return readClipboard(page);
}

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}
