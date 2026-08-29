import { expect, type Page } from '@playwright/test';
import {
  createSelectionFixtureEpub,
  DOCUMENT_FIRST_CHAPTER_TEXT,
  EDGE_FIRST_PAGE_TEXT,
  PAGE_MOVEMENT_FIRST_TOP,
  SAME_FLOW_FIRST_LINE,
  type SelectionFixtureOptions,
} from './selection-fixture';
import { stableReaderCanvasChecksum } from './reader-page-harness';

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

export async function loadDocumentSelectionFixture(page: Page): Promise<void> {
  await uploadSelectionFixture(page, { layout: 'cross-chapter' });
}

export async function loadPageMovementSelectionFixture(page: Page): Promise<void> {
  await uploadSelectionFixture(page, { layout: 'page-movement' });
}

export async function prepareEdgeSelectionFixture(page: Page): Promise<void> {
  await prepareSinglePageFixture(page, EDGE_FIRST_PAGE_TEXT, 2);
}

export async function prepareDocumentSelectionFixture(page: Page): Promise<void> {
  await prepareSinglePageFixture(page, DOCUMENT_FIRST_CHAPTER_TEXT, 2);
}

export async function preparePageMovementSelectionFixture(page: Page): Promise<void> {
  await prepareSinglePageFixture(page, PAGE_MOVEMENT_FIRST_TOP, 3);
}

async function prepareSinglePageFixture(
  page: Page,
  firstPageText: string,
  totalSpreads: number,
): Promise<void> {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Reader Settings/ }).click();
  const heading = page.getByRole('heading', { name: 'Reader Settings' });
  await expect(heading).toBeVisible();
  await page.getByRole('button', { name: 'Single Page' }).click();
  await page.keyboard.press('Escape');
  await expect(heading).toBeHidden();

  const shell = page.getByTestId('reader-shell');
  await expect(shell).toHaveAttribute('data-spread-mode', 'single');
  // One-pass pagination lays the whole book out up front, so the settled
  // state is complete with every spread already published; the old lazy
  // window between mode switch and completion no longer exists to observe.
  await expect(shell).toHaveAttribute('data-pagination-complete', 'true');
  await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBe(totalSpreads);
  await expect.poll(() => currentReaderSpread(page)).toBe(0);
  await waitForVisibleDocumentText(page, firstPageText);
  await stableReaderCanvasChecksum(page);
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
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Chromium selection oracle has no Canvas context');
      context.font = font;
      context.textBaseline = 'top';
      const metrics = context.measureText(content);
      span.remove();
      if (!rangeRect) throw new Error('Chromium selection oracle has no rectangle');
      // With textBaseline 'top' the canvas anchor is the EM top, which
      // sits fontBoundingBoxAscent BELOW the font-box top a native
      // selection rect starts at (probed: Tinos 32px anchor gap 4.59px,
      // Range top = line top + 6 = font-box top). The ink center is
      // therefore fontBoundingBoxAscent + inkCenter below the font-box
      // top; the DOM range backs the height oracle.
      const canvasInkCenter =
        (-metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) / 2;
      return {
        height: rangeRect.height,
        topFromCanvasInkCenter: -(metrics.fontBoundingBoxAscent + canvasInkCenter),
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

export async function focusReaderSurface(page: Page): Promise<void> {
  const surface = readerSurface(page);
  await surface.focus();
  await expect(surface).toBeFocused();
}

export async function copyFocusedSelection(page: Page): Promise<string> {
  const surface = readerSurface(page);
  await expect(surface).toBeFocused();
  const marker = `__rito_selection_clipboard_${String(Date.now())}__`;
  await page.evaluate((value) => navigator.clipboard.writeText(value), marker);
  const modifier = (await usesAppleKeyboardPlatform(page)) ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+c`);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe(marker);
  return page.evaluate(() => navigator.clipboard.readText());
}

export function usesAppleKeyboardPlatform(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`),
  );
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
    const highlightRows = new Set<number>();
    const inkRows: number[] = [];
    for (let y = 0; y < canvas.height; y += 1) {
      let selectedPixels = 0;
      let inkPixels = 0;
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        const red = pixels[offset] ?? 0;
        const green = pixels[offset + 1] ?? 0;
        const blue = pixels[offset + 2] ?? 0;
        const alpha = pixels[offset + 3] ?? 0;
        if (alpha > 32 && blue - red > 25 && blue - green > 12 && blue > 70) {
          selectedPixels += 1;
        }
        if (alpha > 32 && red < 96 && green < 96 && blue < 128) {
          inkPixels += 1;
        }
      }
      if (selectedPixels >= 8) highlightRows.add(y);
      if (inkPixels >= 4) inkRows.push(y);
    }
    // One band per highlighted TEXT line, split on glyph-ink line bands
    // rather than on gaps between the highlight rectangles themselves:
    // adjacent lines' highlights may touch (the built app's line boxes
    // stack seamlessly) and a gap-based split would fuse them into one.
    const inkGroups: { top: number; bottom: number }[] = [];
    for (const y of inkRows) {
      const previous = inkGroups.at(-1);
      if (previous && y - previous.bottom <= 2) previous.bottom = y;
      else inkGroups.push({ top: y, bottom: y });
    }
    const logicalPixelHeight = bounds.height / canvas.height / renderScale;
    const bands: { top: number; height: number }[] = [];
    for (const group of inkGroups) {
      // Seed on a highlighted row inside the ink band, then take the whole
      // contiguous highlight run around it: the painted band spans the
      // line's FONT box, which reaches past the glyph ink but never
      // touches the neighbouring line's band (the line pitch exceeds the
      // font-box height), so the contiguous run IS one line's band.
      let seed = -1;
      for (let y = group.top; y <= group.bottom; y += 1) {
        if (highlightRows.has(y)) {
          seed = y;
          break;
        }
      }
      if (seed < 0) continue;
      let top = seed;
      while (top - 1 >= 0 && highlightRows.has(top - 1)) top -= 1;
      let bottom = seed;
      while (bottom + 1 < canvas.height && highlightRows.has(bottom + 1)) bottom += 1;
      if (bottom - top >= 2 && bands.at(-1)?.top !== top * logicalPixelHeight) {
        bands.push({
          top: top * logicalPixelHeight,
          height: (bottom - top + 1) * logicalPixelHeight,
        });
      }
    }
    return bands;
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

export async function readCanvasTextBands(page: Page): Promise<readonly CanvasTextBand[]> {
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

export function readerSurface(page: Page) {
  return page.getByTestId('reader-shell').locator('canvas[data-rito-reader-surface="true"]');
}

async function readerNumberAttribute(page: Page, name: string): Promise<number> {
  return Number((await page.getByTestId('reader-shell').getAttribute(name)) ?? '0');
}
