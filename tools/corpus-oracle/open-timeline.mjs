// Times one book's open in the real browser reader, stage by stage: every
// request the page sends its reader session and how long it took, on one
// clock.
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
// The timeline is the reader's own log: every request it sent its session,
// when, how long it took and what it answered.
const timeline = () =>
  page.evaluate(() =>
    (window.__ritoReaderDiagnostics?.log() ?? []).filter((entry) => entry.at >= window.__t0),
  );
await page.goto(url);
await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.__t0 = performance.now();
});
const load = async (which = bookPath) => {
  const started = Date.now();
  await page.setInputFiles('input[type=file]', which);
  await page.waitForSelector('[data-testid=reader-shell][data-loaded=true]', { timeout: 300000 });
  return Date.now() - started;
};
// A layout is asked for when a session opens and on every artifact request.
const layoutRequests = async () =>
  (await timeline()).filter(
    (entry) => entry.kind === 'openSession' || entry.kind === 'requestArtifact',
  ).length;
const wall = await load();
if (process.env.RITO_TIMELINE_TWICE === '1') {
  const paginations = await layoutRequests();
  await load(process.env.RITO_TIMELINE_OTHER);
  await page.evaluate(() => {
    window.__t0 = performance.now();
  });
  const second = await load();
  const secondPaginations = await layoutRequests();
  console.log(`first open: ${wall} ms, ${paginations} layout requests`);
  console.log(`second open of the same book: ${second} ms, ${secondPaginations} layout requests`);
  await browser.close();
  process.exit(0);
}
const marks = await timeline();
const { t0, spreads } = await page.evaluate(() => ({
  t0: window.__t0,
  spreads: document.querySelector('[data-testid=reader-shell]')?.dataset.totalSpreads,
}));
console.log(`file selected -> data-loaded=true: ${wall} ms   (${spreads} spreads)`);
console.log('  at(ms)  gap    took  kind');
let prev = t0;
for (const m of marks) {
  const at = m.at - t0;
  const took = m.ms === undefined ? '' : m.ms.toFixed(1);
  const times = m.times === undefined ? '' : ` ×${m.times}`;
  console.log(
    `${at.toFixed(0).padStart(8)} ${(m.at - prev).toFixed(0).padStart(6)} ${took.padStart(7)}  ${m.kind}${times} ${m.result ?? ''}`,
  );
  prev = m.at;
}
await browser.close();
