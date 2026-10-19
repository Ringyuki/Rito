// Turn trace: what the main thread does between a key press and the first
// changed frame. Prints one timeline per turn — the key event, every session
// request and how long it took, every animation-frame callback with its
// cost and the Canvas calls it made, and the frame the canvas changed in —
// with times in ms from the moment the probe armed.
//
// ACTION=size traces a font-size change through the controller instead of a
// page turn, alternating between two sizes; ACTION=panel makes the change
// with the settings panel's slider.
//
// SAMPLE=full reads the canvas the way accept.mjs does (a readback of most
// of it on every frame); SAMPLE=light reads one row; SAMPLE=none reads
// nothing and prints the frames of the first quarter second, to tell the
// cost of watching from the cost of turning.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/reader/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const READER_URL = process.env.URL ?? 'http://127.0.0.1:4317/';
const BOOK = process.env.BOOK;
const VIEW = process.env.VIEW ?? 'desktop';
const viewport =
  VIEW === 'phone' ? { width: 393, height: 760, dsf: 3 } : { width: 1280, height: 860, dsf: 2 };
const TURNS = Number(process.env.TURNS ?? 5);
const SAMPLE = process.env.SAMPLE ?? 'full';
const ACTION = process.env.ACTION ?? 'turn';
// RASTER_FIRST=1 makes the browser raster every canvas drawn into before each
// turn, the control that tells a first frame paying for deferred raster from
// one paying for something else.
const RASTER_FIRST = process.env.RASTER_FIRST === '1';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: viewport.width, height: viewport.height },
  deviceScaleFactor: viewport.dsf,
});
await page.addInitScript((sample) => {
  const log = [];
  window.__turnTrace = log;
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const span = (kind, startedAt, what) => {
    log.push({ kind, at: startedAt, ms: performance.now() - startedAt, what });
  };
  // Every Canvas 2D call, counted by method, so a frame says what it drew.
  const calls = new Map();
  const drawnInto = new Set();
  let flushing = false;
  for (const context of [CanvasRenderingContext2D, OffscreenCanvasRenderingContext2D]) {
    for (const name of Object.getOwnPropertyNames(context.prototype)) {
      const method = Object.getOwnPropertyDescriptor(context.prototype, name).value;
      if (typeof method !== 'function' || name === 'constructor') continue;
      context.prototype[name] = function (...args) {
        calls.set(name, (calls.get(name) ?? 0) + 1);
        if (!flushing) drawnInto.add(this.canvas);
        return method.apply(this, args);
      };
    }
  }
  // Uses every canvas drawn into since the last call as an image source
  // once, which makes the browser raster what it had only recorded.
  window.__rasterDrawnCanvases = () => {
    const startedAt = performance.now();
    const scratch = new OffscreenCanvas(1, 1).getContext('2d');
    flushing = true;
    for (const canvas of drawnInto) {
      if (canvas.width > 0 && canvas.height > 0) scratch.drawImage(canvas, 0, 0, 1, 1);
    }
    flushing = false;
    const count = drawnInto.size;
    drawnInto.clear();
    return { count, ms: performance.now() - startedAt };
  };
  const drawn = (before) =>
    [...calls]
      .map(([name, count]) => [name, count - (before.get(name) ?? 0)])
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => `${name}×${String(count)}`)
      .join(' ');
  window.requestAnimationFrame = (callback) =>
    nativeFrame((time) => {
      const startedAt = performance.now();
      const before = new Map(calls);
      try {
        callback(time);
      } finally {
        span('frame', startedAt, drawn(before));
      }
    });
  // Every request the reader sent its session since `armedAt`, from the
  // reader's own log: the engine runs on the page's thread, so a request's
  // time is time the page spent in it.
  const withSessionRequests = (armedAt) =>
    [
      ...log,
      ...(window.__ritoReaderDiagnostics?.log() ?? [])
        .filter((entry) => entry.at >= armedAt && entry.ms !== undefined)
        .map((entry) => ({ kind: 'request', at: entry.at, ms: entry.ms, what: entry.kind })),
    ].sort((a, b) => a.at - b.at);
  window.addEventListener(
    'keydown',
    (event) => {
      log.push({ kind: 'key', at: performance.now(), ms: 0, what: event.key });
    },
    true,
  );
  window.__sig = () => {
    const c =
      document.querySelector('canvas[data-rito-reader-surface]') ??
      document.querySelector('canvas');
    if (!c || c.width === 0) return 'none';
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    const d =
      sample === 'light'
        ? ctx.getImageData(Math.floor(w * 0.1), Math.floor(h * 0.5), Math.floor(w * 0.8), 1).data
        : ctx.getImageData(
            Math.floor(w * 0.1),
            Math.floor(h * 0.15),
            Math.floor(w * 0.8),
            Math.floor(h * 0.7),
          ).data;
    let s = 0;
    for (let i = 0; i < d.length; i += sample === 'light' ? 4 : 97) s = (s * 31 + d[i]) | 0;
    return `${w}x${h}:${s}`;
  };
  window.__armTurn = () => {
    const armedAt = performance.now();
    log.length = 0;
    if (sample === 'none') {
      // No readback at all: the frames of the first quarter second, as they cost unwatched.
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ armedAt, changedAt: performance.now(), log: withSessionRequests(armedAt) });
        }, 250);
      });
    }
    return new Promise((resolve) => {
      const before = window.__sig();
      const tick = () => {
        const startedAt = performance.now();
        const now = window.__sig();
        span('watch', startedAt);
        if (now !== before) {
          resolve({ armedAt, changedAt: performance.now(), log: withSessionRequests(armedAt) });
        } else if (performance.now() - armedAt > 5000) {
          resolve({ armedAt, changedAt: -1, log: withSessionRequests(armedAt) });
        } else nativeFrame(tick);
      };
      nativeFrame(tick);
    });
  };
}, SAMPLE);
await page.goto(READER_URL);
await page.waitForTimeout(800);
await page.locator('input[type=file][accept=".epub"]').first().setInputFiles(BOOK);
await page.waitForFunction(() => window.__ritoController, null, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const c = window.__ritoController;
  c.jumpToSpread(Math.floor(c.reader.totalSpreads * 0.45));
});
await page.waitForTimeout(2500);
await page
  .locator('canvas')
  .first()
  .focus()
  .catch(() => {});

if (ACTION === 'panel') {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Reader Settings/ }).click();
  await page.getByRole('slider').first().focus();
  await page.waitForTimeout(800);
}
const round = (value) => Math.round(value * 10) / 10;
const totals = [];
for (let turn = 0; turn < TURNS; turn++) {
  if (RASTER_FIRST) {
    const rastered = await page.evaluate(() => window.__rasterDrawnCanvases());
    console.log(
      `rastered ${String(rastered.count)} canvases in ${String(round(rastered.ms))} ms before the turn`,
    );
    await page.waitForTimeout(200);
  }
  const armed =
    ACTION === 'size'
      ? page.evaluate(
          (fontSize) => {
            const done = window.__armTurn();
            window.__ritoController.setTypography({ fontSize });
            return done;
          },
          18 + 2 * (turn % 2),
        )
      : page.evaluate(() => window.__armTurn());
  if (ACTION === 'panel') await page.keyboard.press(turn % 2 === 0 ? 'ArrowRight' : 'ArrowLeft');
  else if (ACTION !== 'size') await page.keyboard.press('ArrowRight');
  const { armedAt, changedAt, log } = await armed;
  totals.push(round(changedAt - armedAt));
  console.log(`${ACTION} ${String(turn + 1)}: changed at ${String(round(changedAt - armedAt))} ms`);
  for (const entry of log) {
    if (entry.at > changedAt) break;
    const cost = entry.ms > 0 ? ` (${String(round(entry.ms))} ms)` : '';
    const what = entry.what === undefined ? '' : ` ${String(entry.what)}`;
    console.log(`  ${String(round(entry.at - armedAt)).padStart(6)}  ${entry.kind}${what}${cost}`);
  }
  await page.waitForTimeout(ACTION === 'turn' ? 900 : 2500);
}
console.log(
  JSON.stringify({
    book: BOOK.split('/').pop(),
    view: VIEW,
    action: ACTION,
    sample: SAMPLE,
    totals,
  }),
);
await browser.close();
