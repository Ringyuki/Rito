import { test } from '@playwright/test';
import { loadSelectionFixture, readCanvasTextBands } from './reader-selection-harness';

test('diag: fixture metrics', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await loadSelectionFixture(page);
  const bands = await readCanvasTextBands(page);
  const info = await page.evaluate(() => ({
    fonts: [...document.fonts]
      .map((f) => `${f.family.slice(0, 24)}:${f.status}`)
      .sort(),
    dpr: window.devicePixelRatio,
    canvas: (() => {
      const c = document.querySelector('canvas');
      return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null;
    })(),
  }));
  console.log('DIAG', JSON.stringify({ bands, ...info }, null, 1));
});
