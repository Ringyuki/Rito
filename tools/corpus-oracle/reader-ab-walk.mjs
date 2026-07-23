// Full-book sequential A/B walk of the real reader app.
//
// Drives apps/reader (vite) twice — fragment engine and the retained
// browser pipeline (?fragmentPagination=0) — paging with ArrowRight from
// spread 0 to the end exactly like a human reader. No mid-walk
// realignment: pagination drift must survive into the data. Captures one
// screenshot per spread plus the shell's chapter attribution, so the
// scorer can pair pages chapter-by-chapter and report drift separately.
//
// Usage: node reader-ab-walk.mjs <book.epub> <outDir> [maxSpreads]
// Output: <outDir>/{fragment,retained}/sNNN.png + walk.json per mode.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const [, , bookPath, outDir, maxSpreadsArg] = process.argv;
if (!bookPath || !outDir) {
  console.error('usage: node reader-ab-walk.mjs <book.epub> <outDir> [maxSpreads]');
  process.exit(1);
}
const maxSpreads = Number(maxSpreadsArg ?? 400);
const BASE_URL = process.env.RITO_READER_URL ?? 'http://localhost:5199/';
const VIEWPORT = { width: 1500, height: 950 };

async function walkMode(browser, mode) {
  const url = mode === 'fragment' ? BASE_URL : `${BASE_URL}?fragmentPagination=0`;
  const dir = path.join(outDir, mode);
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
  await page.setInputFiles('input[type=file]', bookPath);
  await page.waitForSelector('[data-testid=reader-shell][data-loaded=true]', { timeout: 300000 });
  await page.waitForTimeout(5000);
  const shell = page.locator('[data-testid=reader-shell]');
  const spreads = [];
  let stuck = 0;
  for (let s = 0; s < maxSpreads; s += 1) {
    const before = await shell.getAttribute('data-current-spread');
    if (Number(before) !== s) {
      await page.keyboard.press('ArrowRight');
      const advanced = await page
        .waitForFunction(
          (prev) =>
            document
              .querySelector('[data-testid=reader-shell]')
              ?.getAttribute('data-current-spread') !== prev,
          before,
          { timeout: 8000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!advanced) {
        stuck += 1;
        if (stuck >= 3) break; // end of book (or navigation wedged: visible as short walk)
        continue;
      }
      stuck = 0;
      await page
        .waitForFunction(
          () =>
            document
              .querySelector('[data-testid=reader-shell]')
              ?.getAttribute('data-transitioning') !== 'true',
          null,
          { timeout: 10000 },
        )
        .catch(() => {});
    }
    await page.waitForTimeout(450);
    const file = `s${String(s).padStart(3, '0')}.png`;
    await page.screenshot({ path: path.join(dir, file) });
    spreads.push({
      index: s,
      file,
      chapterHref: (await shell.getAttribute('data-active-chapter-href')) ?? '',
    });
  }
  const meta = {
    mode,
    book: path.basename(bookPath),
    totalSpreadsAttr: Number(await shell.getAttribute('data-total-spreads')),
    walked: spreads.length,
    viewport: VIEWPORT,
    spreads,
  };
  writeFileSync(path.join(dir, 'walk.json'), JSON.stringify(meta, null, 2));
  await page.close();
  return meta;
}

const browser = await chromium.launch();
try {
  const fragment = await walkMode(browser, 'fragment');
  console.log(`fragment: walked ${fragment.walked}, total ${fragment.totalSpreadsAttr}`);
  const retained = await walkMode(browser, 'retained');
  console.log(`retained: walked ${retained.walked}, total ${retained.totalSpreadsAttr}`);
} finally {
  await browser.close();
}
