// Acceptance probe: open, page-number, font size, font family and page-turn
// latency in the real reader, judged only by public controller calls and
// canvas pixels, and the same font-size change made through the settings
// panel.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/reader/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const READER_URL = process.env.URL ?? 'http://127.0.0.1:4317/';
const BOOK = process.env.BOOK;
const VIEW = process.env.VIEW ?? 'phone';
const viewport =
  VIEW === 'phone' ? { width: 393, height: 760, dsf: 3 } : { width: 1280, height: 860, dsf: 2 };
const RUNS = Number(process.env.RUNS ?? 3);

const browser = await chromium.launch();
const out = [];
for (let run = 0; run < RUNS; run++) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dsf,
  });
  await page.addInitScript(() => {
    // Samples the reader canvas on every frame; resolves when it differs from the sample taken at arm time.
    window.__sig = () => {
      const c =
        document.querySelector('canvas[data-rito-reader-surface]') ??
        document.querySelector('canvas');
      if (!c || c.width === 0) return 'none';
      const ctx = c.getContext('2d');
      const w = c.width,
        h = c.height;
      const d = ctx.getImageData(
        Math.floor(w * 0.1),
        Math.floor(h * 0.15),
        Math.floor(w * 0.8),
        Math.floor(h * 0.7),
      ).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 97) s = (s * 31 + d[i]) | 0;
      return `${w}x${h}:${s}`;
    };
    window.__waitChange = (startedAt) =>
      new Promise((resolve) => {
        const before = window.__sig();
        const tick = () => {
          const now = window.__sig();
          if (now !== before && !now.startsWith('none'))
            resolve(Math.round(performance.now() - startedAt));
          else if (performance.now() - startedAt > 15000) resolve(-1);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
  });
  await page.goto(READER_URL);
  await page.waitForTimeout(800);
  // Open: from handing the file over to the first painted page. Page
  // numbers: from that page to the layout that covers the whole book.
  const opened = page.evaluate(async () => {
    const t = performance.now();
    const open = await window.__waitChange(t);
    const pageNumbers = await new Promise((resolve) => {
      const tick = () => {
        const reader = window.__ritoController?.reader;
        if (reader && reader.layoutScope !== 'chapter') {
          resolve(Math.max(0, Math.round(performance.now() - t) - open));
        } else if (performance.now() - t > 15000) resolve(-1);
        else requestAnimationFrame(tick);
      };
      tick();
    });
    return { open, pageNumbers };
  });
  await page.locator('input[type=file][accept=".epub"]').first().setInputFiles(BOOK);
  const { open, pageNumbers } = await opened;
  await page.waitForFunction(() => window.__ritoController, null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  // Measure on a text page in the middle of the book, never on the cover.
  await page.evaluate(() => {
    const c = window.__ritoController;
    c.jumpToSpread(Math.floor(c.reader.totalSpreads * 0.45));
  });
  await page.waitForTimeout(2500);
  const typography = (patch) =>
    page.evaluate((patch) => {
      const t = performance.now();
      const done = window.__waitChange(t);
      window.__ritoController.setTypography(patch);
      return done;
    }, patch);
  const size1 = await typography({ fontSize: 18 });
  await page.waitForTimeout(2500);
  const size2 = await typography({ fontSize: 20 });
  await page.waitForTimeout(2500);
  const family = await typography({ fontFamily: 'sans-serif', fontFamilyForce: true });
  await page.waitForTimeout(2500);
  const familyBack = await typography({ fontFamily: null });
  await page.waitForTimeout(2500);
  // Turn: key press to the first changed frame.
  await page
    .locator('canvas')
    .first()
    .focus()
    .catch(() => {});
  const turns = [];
  for (let i = 0; i < 3; i++) {
    const r = page.evaluate(() => {
      const t = performance.now();
      return window.__waitChange(t);
    });
    await page.keyboard.press('ArrowRight');
    turns.push(await r);
    await page.waitForTimeout(900);
  }
  const pages = await page.evaluate(() => window.__ritoController.reader.pageCount);
  // Through the settings panel: one step of the font-size slider, key press
  // to the first changed frame.
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Reader Settings/ }).click();
  await page.getByRole('slider').first().focus();
  await page.waitForTimeout(800);
  const panel = [];
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowRight']) {
    const r = page.evaluate(() => {
      const t = performance.now();
      return window.__waitChange(t);
    });
    await page.keyboard.press(key);
    panel.push(await r);
    await page.waitForTimeout(2500);
  }
  out.push({ open, pageNumbers, size1, size2, family, familyBack, turns, panel, pages });
  await page.close();
}
await browser.close();
const med = (k) => {
  const v = out.map((o) => o[k]).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};
const turnMed = out.flatMap((o) => o.turns).sort((a, b) => a - b);
const panelMed = out.flatMap((o) => o.panel).sort((a, b) => a - b);
console.log(
  JSON.stringify({
    book: BOOK.split('/').pop(),
    view: VIEW,
    open: med('open'),
    pageNumbers: med('pageNumbers'),
    fontSize: [med('size1'), med('size2')],
    family: med('family'),
    familyBack: med('familyBack'),
    turn: turnMed[Math.floor(turnMed.length / 2)],
    panelFontSize: panelMed[Math.floor(panelMed.length / 2)],
    pages: out[0].pages,
  }),
);
