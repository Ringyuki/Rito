// Acceptance probe for scrolled reading in the reader app: opens the demo
// paged, turns the layout setting to Scrolled through the context menu,
// scrolls, follows a contents entry, and turns back to double pages, writing
// a screenshot of each step to OUT and printing where each mode reads and
// what the page logged as errors or warnings.
//
// Usage: OUT=<dir> node tools/reader-accept/app-scroll-accept.mjs
//   env URL (default http://localhost:5173/)
import { launchOracleChromium } from '../oracle-chromium.mjs';
const OUT = process.env.OUT;
const browser = await launchOracleChromium();
const page = await browser.newPage({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
});
await page.goto(process.env.URL ?? 'http://localhost:5173/');
await page.waitForTimeout(800);
await page.getByRole('button', { name: /demo/i }).first().click();
await page.waitForSelector('[data-testid="reader-shell"][data-loaded="true"]', { timeout: 60000 });
await page.waitForTimeout(1500);
const pagedBefore = await page.evaluate(
  () => window.__ritoController?.position?.sourceLocator ?? null,
);
await page.screenshot({ path: `${OUT}/1-paged.png` });
// Settings → Scrolled
await page.keyboard.press('Escape');
await page.mouse.click(640, 430, { button: 'right' });
await page.waitForTimeout(400);
await page.getByText('Reader Settings', { exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/2-settings.png` });
await page.getByText('Scrolled', { exact: true }).click();
await page.waitForSelector('[data-spread-mode="scrolled"][data-loaded="true"]', { timeout: 60000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/3-scrolled.png` });
const progress1 = await page.getAttribute('[data-spread-mode="scrolled"]', 'data-scroll-progress');
await page.mouse.move(640, 430);
await page.mouse.wheel(0, 2400);
await page.waitForTimeout(1200);
const progress2 = await page.getAttribute('[data-spread-mode="scrolled"]', 'data-scroll-progress');
await page.screenshot({ path: `${OUT}/4-scrolled-down.png` });
// TOC
await page.getByRole('button', { name: 'Table of contents' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/5-toc.png` });
const entries = page.locator('[role="dialog"] button, [role="dialog"] a');
const count = await entries.count();
if (count > 2) await entries.nth(2).click();
await page.waitForTimeout(1200);
const progress3 = await page.getAttribute('[data-spread-mode="scrolled"]', 'data-scroll-progress');
await page.screenshot({ path: `${OUT}/6-after-toc.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
// Back to pages
await page.getByRole('button', { name: 'Settings' }).click();
await page.waitForTimeout(500);
await page.getByText('Double Page', { exact: true }).click();
await page.keyboard.press('Escape');
await page.waitForSelector('[data-testid="reader-shell"]:not([data-spread-mode="scrolled"])', {
  timeout: 30000,
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/7-paged-again.png` });
const pagedAfter = await page.evaluate(
  () => window.__ritoController?.position?.sourceLocator ?? null,
);
console.log(
  JSON.stringify(
    { pagedBefore, progress1, progress2, tocEntries: count, progress3, pagedAfter, errors },
    null,
    1,
  ),
);
await browser.close();
