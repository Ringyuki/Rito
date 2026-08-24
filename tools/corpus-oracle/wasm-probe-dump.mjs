// Dumps the wasm pipeline's chapter fragment probe (page-by-page lines)
// for one chapter, after a full warm traversal like the pixel walk does.
// usage: node wasm-probe-dump.mjs <book.epub> <idref> <out.json> [--no-warm]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');

const [, , bookPath, idref, outPath, warmFlag] = process.argv;
if (!bookPath || !idref || !outPath) {
  console.error('usage: node wasm-probe-dump.mjs <book.epub> <idref> <out.json> [--no-warm]');
  process.exit(1);
}
const BASE = process.env.RITO_READER_URL ?? 'http://localhost:5173/';
const VIEWPORT = { width: 1500, height: 950 };

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

if (warmFlag !== '--no-warm') {
  // Lazy font registrations reflow; traverse everything first like the walk.
  const total = await page.evaluate(() => window.__ritoController.reader.spreads.length);
  for (let s = 0; s < total; s += 1) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2000);
}

const result = await page.evaluate(
  (chapterIdref) => globalThis.__ritoReaderDiagnostics.chapterFragmentProbe(chapterIdref),
  idref,
);
writeFileSync(outPath, JSON.stringify(result, null, 1));
const pages = new Map();
for (const line of result.lines) {
  pages.set(line.page, (pages.get(line.page) ?? 0) + 1);
}
console.log(
  `content ${result.contentWidth}x${result.contentHeight} fingerprint ${result.treeFingerprint}`,
);
console.log(
  `${result.lines.length} lines over ${pages.size} pages:`,
  [...pages.entries()].map(([p, n]) => `p${p}:${n}`).join(' '),
);
await browser.close();
