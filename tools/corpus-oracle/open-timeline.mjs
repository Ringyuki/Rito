// Times one book's open in the real browser reader, stage by stage:
// every worker message the page sends and receives, plus the resource
// fetches the page makes, on one clock.
import { createRequire } from 'node:module';

const require2 = createRequire(new URL('../../packages/rito/package.json', import.meta.url));
const { chromium } = require2('@playwright/test');

const [bookPath, url = 'http://127.0.0.1:4174/'] = process.argv.slice(2);
if (!bookPath) throw new Error('usage: open-timeline.mjs <epub> [url]');

const browser = await chromium.launch();
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: { width: 1280, height: 900 },
});
await page.addInitScript(() => {
  const marks = [];
  window.__timeline = marks;
  const label = (data) => {
    if (!data || typeof data !== 'object') return String(data);
    const kind = data.kind ?? data.type ?? Object.keys(data).slice(0, 2).join('+');
    if (data.result && Array.isArray(data.result)) return `${kind}[${data.result.length}]`;
    if (data.result && Array.isArray(data.result?.requests))
      return `${kind}[${data.result.requests.length}]`;
    return kind;
  };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      marks.push({ at: performance.now(), dir: 'new', kind: String(args[0]).split('/').pop() });
      this.addEventListener('message', (event) => {
        const d = event.data;
        let counts = '';
        try {
          const seen = new Set();
          const walk = (v, depth) => {
            if (counts || !v || typeof v !== 'object' || depth > 5 || seen.has(v)) return;
            seen.add(v);
            if (typeof v.pageCount === 'number' && typeof v.spreadCount === 'number') {
              counts = ` pages=${v.pageCount} spreads=${v.spreadCount}`;
              return;
            }
            for (const k of Object.keys(v)) walk(v[k], depth + 1);
          };
          walk(d, 0);
        } catch {
          // A payload shape this probe does not know about carries no
          // counts; the timeline entry is still worth recording.
        }
        marks.push({ at: performance.now(), dir: '<-', kind: label(d) + counts });
      });
    }
    postMessage(data, ...rest) {
      marks.push({ at: performance.now(), dir: '->', kind: label(data) });
      return super.postMessage(data, ...rest);
    }
  };
});
await page.goto(url);
await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.__timeline.length = 0;
  window.__t0 = performance.now();
});
const load = async (which = bookPath) => {
  const started = Date.now();
  await page.setInputFiles('input[type=file]', which);
  await page.waitForSelector('[data-testid=reader-shell][data-loaded=true]', { timeout: 300000 });
  return Date.now() - started;
};
const wall = await load();
if (process.env.RITO_TIMELINE_TWICE === '1') {
  const paginations = await page.evaluate(
    () => window.__timeline.filter((m) => m.dir === '->' && m.kind === 'createRevision').length,
  );
  await load(process.env.RITO_TIMELINE_OTHER);
  await page.evaluate(() => {
    window.__timeline.length = 0;
    window.__t0 = performance.now();
  });
  const second = await load();
  const secondPaginations = await page.evaluate(
    () => window.__timeline.filter((m) => m.dir === '->' && m.kind === 'createRevision').length,
  );
  console.log(`first open: ${wall} ms, ${paginations} createRevision`);
  console.log(
    `second open of the same book (metrics already measured): ${second} ms, ${secondPaginations} createRevision`,
  );
  await browser.close();
  process.exit(0);
}
const { marks, t0, spreads } = await page.evaluate(() => ({
  marks: window.__timeline,
  t0: window.__t0,
  spreads: document.querySelector('[data-testid=reader-shell]')?.dataset.totalSpreads,
}));
console.log(`file selected -> data-loaded=true: ${wall} ms   (${spreads} spreads)`);
console.log('  at(ms)  gap   dir  kind');
let prev = t0;
for (const m of marks) {
  const at = m.at - t0;
  console.log(
    `${at.toFixed(0).padStart(8)} ${(m.at - prev).toFixed(0).padStart(6)}  ${m.dir}   ${m.kind}`,
  );
  prev = m.at;
}
await browser.close();
