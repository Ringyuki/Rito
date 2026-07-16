import { expect, type Page } from '@playwright/test';
import {
  createSelectionFixtureEpub,
  SAME_FLOW_FIRST_LINE,
  type SelectionFixtureOptions,
} from './selection-fixture';

const READER_LOAD_TIMEOUT_MS = 90_000;

export interface CanvasTextBand {
  readonly left: number;
  readonly right: number;
  readonly centerY: number;
  readonly logicalCenterY: number;
}

export interface CanvasHighlightBand {
  readonly top: number;
  readonly height: number;
}

export interface ReaderSurfaceBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface ChromiumSelectionOracle {
  readonly height: number;
  readonly topFromCanvasInkCenter: number;
}

export async function loadSelectionFixture(
  page: Page,
  options: SelectionFixtureOptions = {},
): Promise<void> {
  await uploadSelectionFixture(page, options);
  await expect.poll(() => visibleParagraphCount(page)).toBe(2);
}

export async function loadEdgeSelectionFixture(page: Page): Promise<void> {
  await uploadSelectionFixture(page, { layout: 'edge-pages' });
}

async function uploadSelectionFixture(page: Page, options: SelectionFixtureOptions): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('open-file-button').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'native-selection-fixture.epub',
    mimeType: 'application/epub+zip',
    buffer: createSelectionFixtureEpub(options),
  });
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-loaded', 'true', {
    timeout: READER_LOAD_TIMEOUT_MS,
  });
}

export function chromiumSelectionOracle(
  page: Page,
  family: string,
  content = SAME_FLOW_FIRST_LINE,
  fontSize = 32,
  lineHeight = 48,
): Promise<ChromiumSelectionOracle> {
  return page.evaluate(
    ({ family, fontSize, lineHeight, content }) => {
      const quotedFamily = JSON.stringify(family);
      const font = `${String(fontSize)}px ${quotedFamily}`;
      const registered = [...document.fonts].some(
        (face) => face.family === family && face.status === 'loaded',
      );
      if (!registered || !document.fonts.check(font, content)) {
        throw new Error(`Chromium selection oracle font is unavailable: ${family}`);
      }
      const span = document.createElement('span');
      span.textContent = content;
      Object.assign(span.style, {
        position: 'absolute',
        left: '-10000px',
        top: '0',
        fontFamily: quotedFamily,
        fontSize: `${String(fontSize)}px`,
        lineHeight: `${String(lineHeight)}px`,
      });
      document.body.append(span);
      const textNode = span.firstChild;
      if (!textNode) throw new Error('Chromium selection oracle has no text node');
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rangeRect = range.getClientRects()[0];
      const spanRect = span.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Chromium selection oracle has no Canvas context');
      context.font = font;
      context.textBaseline = 'top';
      const metrics = context.measureText(content);
      span.remove();
      if (!rangeRect) throw new Error('Chromium selection oracle has no rectangle');
      const canvasInkCenter =
        (-metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) / 2;
      return {
        height: rangeRect.height,
        topFromCanvasInkCenter: rangeRect.top - spanRect.top - canvasInkCenter,
      };
    },
    { family, fontSize, lineHeight, content },
  );
}

export async function dragSelection(
  page: Page,
  startBand: CanvasTextBand,
  endBand: CanvasTextBand,
): Promise<void> {
  await page.mouse.move(startBand.left, startBand.centerY);
  await page.mouse.down();
  await page.mouse.move(endBand.right, endBand.centerY, { steps: 12 });
  await page.mouse.up();
}

export async function requireTextBands(
  page: Page,
  count: number,
): Promise<readonly CanvasTextBand[]> {
  const bands = await readCanvasTextBands(page);
  expect(bands.length).toBeGreaterThanOrEqual(count);
  return bands.slice(0, count);
}

export function requireBand<T>(bands: readonly T[], index: number): T {
  const band = bands[index];
  if (!band) throw new Error(`Missing Canvas band ${String(index)}`);
  return band;
}

export function pointInsideFirstWord(band: CanvasTextBand): {
  readonly x: number;
  readonly y: number;
} {
  return { x: band.left + 10, y: band.centerY };
}

export function currentReaderSpread(page: Page): Promise<number> {
  return readerNumberAttribute(page, 'data-current-spread');
}

export async function waitForReaderTransitionEnd(page: Page): Promise<void> {
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-transitioning', 'false', {
    timeout: READER_LOAD_TIMEOUT_MS,
  });
}

export async function waitForVisibleDocumentText(page: Page, text: string): Promise<void> {
  await expect(accessibilityDocument(page)).toContainText(text, {
    timeout: READER_LOAD_TIMEOUT_MS,
  });
}

export async function readerSurfaceBounds(page: Page): Promise<ReaderSurfaceBounds> {
  const surface = readerSurface(page);
  await expect(surface).toBeVisible();
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error('Reader surface has no bounds');
  return {
    left: bounds.x,
    right: bounds.x + bounds.width,
    top: bounds.y,
    bottom: bounds.y + bounds.height,
  };
}

export async function readSelectionHighlightBands(
  page: Page,
): Promise<readonly CanvasHighlightBand[]> {
  return readerSurface(page).evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Reader Canvas is unavailable');
    const canvas = element;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Reader Canvas context is unavailable');
    const bounds = canvas.getBoundingClientRect();
    const renderScale = Number(
      canvas.closest('[data-render-scale]')?.getAttribute('data-render-scale'),
    );
    if (!Number.isFinite(renderScale) || renderScale <= 0) {
      throw new Error('Reader render scale is unavailable');
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rows: number[] = [];
    for (let y = 0; y < canvas.height; y += 1) {
      let selectedPixels = 0;
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        const red = pixels[offset] ?? 0;
        const green = pixels[offset + 1] ?? 0;
        const blue = pixels[offset + 2] ?? 0;
        const alpha = pixels[offset + 3] ?? 0;
        if (alpha > 32 && blue - red > 25 && blue - green > 12 && blue > 70) {
          selectedPixels += 1;
        }
      }
      if (selectedPixels >= 8) rows.push(y);
    }
    const groups: { top: number; bottom: number }[] = [];
    for (const y of rows) {
      const previous = groups.at(-1);
      if (previous && y === previous.bottom + 1) previous.bottom = y;
      else groups.push({ top: y, bottom: y });
    }
    const logicalPixelHeight = bounds.height / canvas.height / renderScale;
    return groups
      .filter((group) => group.bottom - group.top >= 2)
      .map((group) => ({
        top: group.top * logicalPixelHeight,
        height: (group.bottom - group.top + 1) * logicalPixelHeight,
      }));
  });
}

export async function selectionTextLength(page: Page): Promise<number> {
  return Number(
    (await page.getByTestId('reader-shell').getAttribute('data-selection-text-length')) ?? '0',
  );
}

export async function selectionRectCount(page: Page): Promise<number> {
  return Number(
    (await page.getByTestId('reader-shell').getAttribute('data-selection-rect-count')) ?? '0',
  );
}

export async function copySelection(page: Page): Promise<string> {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Copy/ }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

async function readCanvasTextBands(page: Page): Promise<readonly CanvasTextBand[]> {
  return readerSurface(page).evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Reader Canvas is unavailable');
    const canvas = element;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Reader Canvas context is unavailable');
    const bounds = canvas.getBoundingClientRect();
    const renderScale = Number(
      canvas.closest('[data-render-scale]')?.getAttribute('data-render-scale'),
    );
    if (!Number.isFinite(renderScale) || renderScale <= 0) {
      throw new Error('Reader render scale is unavailable');
    }
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
      .map((group) => {
        const centerY = (group.top + group.bottom + 1) / 2;
        return {
          left: bounds.left + (group.left + 2) * scaleX,
          right: bounds.left + (group.right - 2) * scaleX,
          centerY: bounds.top + centerY * scaleY,
          logicalCenterY: (centerY * scaleY) / renderScale,
        };
      });
  });
}

function visibleParagraphCount(page: Page): Promise<number> {
  return accessibilityDocument(page).locator('p').count();
}

function accessibilityDocument(page: Page) {
  return page.locator('[role="document"][aria-live="polite"]');
}

function readerSurface(page: Page) {
  return page.getByTestId('reader-shell').locator('canvas[data-rito-reader-surface="true"]');
}

async function readerNumberAttribute(page: Page, name: string): Promise<number> {
  return Number((await page.getByTestId('reader-shell').getAttribute(name)) ?? '0');
}
