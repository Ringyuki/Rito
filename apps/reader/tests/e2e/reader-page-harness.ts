import { expect, type Page } from '@playwright/test';

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
  return page.locator('canvas').evaluateAll((canvases) => {
    for (const canvas of canvases) {
      if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) {
        continue;
      }
      const context = canvas.getContext('2d');
      if (!context) continue;
      const stepX = Math.max(1, Math.floor(canvas.width / 40));
      const stepY = Math.max(1, Math.floor(canvas.height / 40));
      for (let y = 0; y < canvas.height; y += stepY) {
        for (let x = 0; x < canvas.width; x += stepX) {
          const pixel = context.getImageData(x, y, 1, 1).data;
          if ((pixel[3] ?? 0) === 0) continue;
          const distanceFromWhite =
            Math.abs((pixel[0] ?? 255) - 255) +
            Math.abs((pixel[1] ?? 255) - 255) +
            Math.abs((pixel[2] ?? 255) - 255);
          if (distanceFromWhite > 24) return true;
        }
      }
    }
    return false;
  });
}
