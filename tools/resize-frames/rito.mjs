// The reader under a window being resized at 1000 Hz with no frame-rate
// limit: a new width every millisecond on the longest chapter of a book,
// and for each width that reaches the canvas, how long after it was asked.
// The page is the demo reader (pnpm dev:reader).
//
// BOOK=<path to an .epub> node rito.mjs
// Optional: URL (http://localhost:5173/), DRAG_MS (2000), DPR (1).
import { readFileSync } from 'node:fs';
import { describe, launchUnthrottled, stats } from './shared.mjs';

const BOOK = process.env.BOOK;
if (!BOOK) throw new Error('BOOK is required');
const URL_ = process.env.URL ?? 'http://localhost:5173/';
const DRAG_MS = Number(process.env.DRAG_MS ?? 2000);

const browser = await launchUnthrottled();
const page = await browser.newPage({
  viewport: { width: 1200, height: 900 },
  deviceScaleFactor: Number(process.env.DPR ?? 1),
});
await page.goto(URL_);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => typeof window.__ritoLoad === 'function');
await page.evaluate(async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  await window.__ritoLoad(bytes.buffer);
}, readFileSync(BOOK).toString('base64'));
await page.waitForSelector('[data-testid=reader-shell][data-loaded=true]', { timeout: 120000 });
const bookScope = () =>
  page.waitForFunction(() => window.__ritoReaderDiagnostics?.layout().scope === 'book', null, {
    timeout: 180000,
  });
await bookScope();
// A few pages into the book's longest chapter.
await page.evaluate(() => {
  const controller = window.__ritoController;
  let best;
  for (const [, range] of controller.reader.chapterMap) {
    const pages = range.endPage - range.startPage;
    if (!best || pages > best.pages) best = { pages, startPage: range.startPage };
  }
  const spread = controller.spreads.find((s) => s.pageIndexes.includes(best.startPage + 4));
  controller.jumpToSpread(spread.index);
});
await page.waitForTimeout(1500);
await bookScope();
const result = await page.evaluate(async (DRAG_MS) => {
  const controller = window.__ritoController;
  const canvas = [...document.querySelectorAll('canvas')].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  )[0];
  // The width the canvas shows, in CSS pixels, read without a layout: a
  // canvas zoomed out by the ratio shows part of a larger drawing buffer;
  // one that is not shows all of it.
  const shownWidth = () =>
    canvas.style.zoom
      ? Math.round(parseFloat(canvas.style.width) * parseFloat(canvas.style.zoom))
      : Math.round(canvas.width / devicePixelRatio);
  const base = shownWidth();
  // A pixel changed every frame: Chromium paces frames that change nothing
  // at 60 Hz whatever its flags.
  const tick = document.createElement('div');
  tick.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;z-index:99999';
  document.body.appendChild(tick);
  const askedAt = new Map();
  const frames = [];
  const shown = [];
  let asks = 0;
  let lastAsked;
  let lastShown = shownWidth();
  const started = performance.now();
  await new Promise((done) => {
    let previous;
    const step = (now) => {
      if (previous !== undefined) frames.push(now - previous);
      previous = now;
      tick.style.background = frames.length % 2 ? '#fff' : '#fefefe';
      const width = shownWidth();
      if (width !== lastShown) {
        shown.push({ width, at: now, asked: askedAt.get(width) });
        lastShown = width;
      }
      if (now - started >= DRAG_MS) return done();
      // A new width every millisecond, 400 px down and back: a width comes
      // again no sooner than 800 ms on.
      const k = Math.floor(now - started) % 800;
      const asked = base - (k < 400 ? k : 800 - k);
      if (asked !== lastAsked) {
        askedAt.set(asked, now);
        asks += 1;
        lastAsked = asked;
        controller.resize(asked, 900);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  tick.remove();
  return { frames, shown, asks, ms: performance.now() - started };
}, DRAG_MS);
await browser.close();
const perSecond = (n) => (n / (result.ms / 1000)).toFixed(0);
const latency = result.shown.filter((s) => s.asked !== undefined).map((s) => s.at - s.asked);
console.log(`main-thread frame: ${describe(stats(result.frames))}`);
console.log(
  `${perSecond(result.asks)} sizes asked a second, ${perSecond(result.shown.length)} reached the canvas`,
);
if (latency.length) console.log(`ask to canvas: ${describe(stats(latency))}`);
