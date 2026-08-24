// What geometry is the reader actually using? Shell/canvas/revision config.
// usage: node geometry-check.mjs <book.epub>
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');

const [, , bookPath] = process.argv;
const BASE = process.env.RITO_READER_URL ?? 'http://localhost:5173/';
const VIEWPORT = { width: 740, height: 950 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
await page.goto(BASE);
let lastNav = Date.now();
page.on('load', () => {
  lastNav = Date.now();
});
await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
while (Date.now() - lastNav < 2000) await page.waitForTimeout(250);
await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
await page.setInputFiles('input[type=file]', path.resolve(bookPath));
await page.waitForSelector('[data-testid=reader-shell][data-loaded=true]', { timeout: 300000 });
await page.waitForFunction(
  () => document.querySelector('[data-testid=reader-shell]')?.dataset.paginationComplete === 'true',
  { timeout: 300000 },
);
await page.waitForTimeout(1500);
const geometry = await page.evaluate(() => {
  const shell = document.querySelector('[data-testid=reader-shell]');
  const canvas = document.querySelector('canvas');
  const revision = globalThis.__ritoReaderDiagnostics?.revision?.();
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    shell: shell ? shell.getBoundingClientRect().toJSON() : null,
    canvas: canvas
      ? {
          rect: canvas.getBoundingClientRect().toJSON(),
          buffer: { width: canvas.width, height: canvas.height },
        }
      : null,
    revisionKeys: revision ? Object.keys(revision) : null,
    presentation: revision?.presentation ?? null,
    layout: revision?.layout ?? revision?.layoutConfig ?? null,
  };
});
console.log(JSON.stringify(geometry, null, 2));
await browser.close();
