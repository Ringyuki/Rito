import { expect, type Page } from '@playwright/test';

const READER_PAINT_TIMEOUT_MS = 90_000;

interface ReaderCanvasSample {
  readonly checksum: string;
  readonly nonBlank: boolean;
}

export async function resetToFirstSpread(page: Page): Promise<void> {
  await page.keyboard.press('Home');
  await expect.poll(() => currentSpread(page)).toBe(0);
  await page.waitForTimeout(100);
}

export async function currentSpread(page: Page): Promise<number> {
  return readerNumberAttribute(page, 'data-current-spread');
}

export async function readerAttribute(page: Page, name: string): Promise<string> {
  return (await page.getByTestId('reader-shell').getAttribute(name)) ?? '';
}

export async function readerNumberAttribute(page: Page, name: string): Promise<number> {
  return Number(await readerAttribute(page, name));
}

export async function hasNonBlankCanvas(page: Page): Promise<boolean> {
  return (await readReaderCanvasSample(page))?.nonBlank ?? false;
}

export async function waitForReaderSpreadPaint(
  page: Page,
  expectedSpread: number,
  previousChecksum?: string,
): Promise<string> {
  await expect
    .poll(() => currentSpread(page), {
      timeout: READER_PAINT_TIMEOUT_MS,
      intervals: [10],
    })
    .toBe(expectedSpread);
  let checksum = '';
  await expect
    .poll(
      async () => {
        const sample = await readReaderCanvasSample(page);
        if (!sample?.nonBlank) return false;
        checksum = sample.checksum;
        return previousChecksum === undefined || sample.checksum !== previousChecksum;
      },
      { timeout: READER_PAINT_TIMEOUT_MS, intervals: [10] },
    )
    .toBe(true);
  return checksum;
}

export async function waitForReaderTransitionEnd(page: Page): Promise<void> {
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-transitioning', 'false', {
    timeout: READER_PAINT_TIMEOUT_MS,
  });
}

export async function stableReaderCanvasChecksum(page: Page): Promise<string> {
  return stableReaderChecksum(page, readerCanvasChecksum);
}

export async function stableReaderCanvasSampleChecksum(page: Page): Promise<string> {
  return stableReaderChecksum(page, readerCanvasSampleChecksum);
}

async function stableReaderChecksum(
  page: Page,
  checksum: (page: Page) => Promise<string>,
): Promise<string> {
  let previous = '';
  let stableSamples = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(100);
    const current = await checksum(page);
    if (current === previous) {
      stableSamples += 1;
      if (stableSamples >= 2) return current;
    } else {
      previous = current;
      stableSamples = 0;
    }
  }
  throw new Error('Reader canvas did not reach a stable checksum');
}

export async function readerCanvasChecksum(page: Page): Promise<string> {
  return page
    .getByTestId('reader-shell')
    .locator('canvas')
    .evaluateAll((canvases) => {
      const canvas = canvases
        .filter(
          (candidate): candidate is HTMLCanvasElement => candidate instanceof HTMLCanvasElement,
        )
        .sort((left, right) => right.width * right.height - left.width * left.height)[0];
      if (!canvas) throw new Error('Reader canvas is unavailable');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Reader canvas context is unavailable');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2_166_136_261;
      for (let index = 0; index < pixels.length; index += 1) {
        hash ^= pixels[index] ?? 0;
        hash = Math.imul(hash, 16_777_619);
      }
      return `${String(canvas.width)}x${String(canvas.height)}:${String(hash >>> 0)}`;
    });
}

export async function readerCanvasSampleChecksum(page: Page): Promise<string> {
  const sample = await readReaderCanvasSample(page);
  if (!sample) throw new Error('Reader canvas is unavailable');
  return sample.checksum;
}

async function readReaderCanvasSample(page: Page): Promise<ReaderCanvasSample | null> {
  return page
    .getByTestId('reader-shell')
    .locator('canvas')
    .evaluateAll((canvases) => {
      const canvas = canvases
        .filter(
          (candidate): candidate is HTMLCanvasElement => candidate instanceof HTMLCanvasElement,
        )
        .sort((left, right) => right.width * right.height - left.width * left.height)[0];
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
      const sampleSize = 64;
      const sample = document.createElement('canvas');
      sample.width = sampleSize;
      sample.height = sampleSize;
      const context = sample.getContext('2d');
      if (!context) throw new Error('Reader canvas context is unavailable');
      context.drawImage(canvas, 0, 0, sampleSize, sampleSize);
      const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
      let hash = 2_166_136_261;
      let nonBlank = false;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        const alpha = pixels[index + 3] ?? 0;
        hash ^= red;
        hash = Math.imul(hash, 16_777_619);
        hash ^= green;
        hash = Math.imul(hash, 16_777_619);
        hash ^= blue;
        hash = Math.imul(hash, 16_777_619);
        hash ^= alpha;
        hash = Math.imul(hash, 16_777_619);
        if (alpha > 0 && Math.abs(red - 255) + Math.abs(green - 255) + Math.abs(blue - 255) > 24) {
          nonBlank = true;
        }
      }
      return {
        checksum: `${String(canvas.width)}x${String(canvas.height)}:${String(hash >>> 0)}`,
        nonBlank,
      };
    });
}
