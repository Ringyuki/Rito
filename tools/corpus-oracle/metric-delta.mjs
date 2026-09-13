// Same book, same viewport, engine with and without the host's measured
// `line-height: normal`: compares page counts and the y of every text
// primitive on the first spreads.
import { createRequire } from 'node:module';
const require2 = createRequire(new URL('../../packages/rito/package.json', import.meta.url));
const { chromium } = require2('@playwright/test');

const [bookPath, url = 'http://127.0.0.1:4174/'] = process.argv.slice(2);
const SPREADS = 6;

async function run(dropMetrics) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: 1280, height: 900 },
  });
  await page.addInitScript((drop) => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(data, ...rest) {
        if (drop && data && data.kind === 'setHostLineMetrics') {
          // Answer the client so its promise settles, without telling the engine.
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent('message', { data: { id: data.id, ok: true, result: undefined } }),
              ),
            0,
          );
          return undefined;
        }
        return super.postMessage(data, ...rest);
      }
    };
  }, dropMetrics);
  await page.goto(url);
  await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.setInputFiles('input[type=file]', bookPath);
  await page.waitForSelector('[data-testid=reader-shell][data-loaded=true]', { timeout: 300000 });
  await page.waitForTimeout(1500);
  const out = await page.evaluate(async (n) => {
    const d = window.__ritoReaderDiagnostics;
    const shell = document.querySelector('[data-testid=reader-shell]');
    const ys = [];
    for (let s = 0; s < n; s += 1) {
      const frame = await d.frame(s);
      if (!frame) break;
      for (const c of frame.commands ?? []) {
        if (c.rect && (c.text !== undefined || c.clusters)) ys.push(Number(c.rect.y.toFixed(3)));
      }
    }
    return { spreads: Number(shell.dataset.totalSpreads), ys };
  }, SPREADS);
  await browser.close();
  return out;
}

const withMetrics = await run(false);
const without = await run(true);
console.log(`spreads   with host metrics: ${withMetrics.spreads}   without: ${without.spreads}`);
console.log(
  `text primitives sampled     with: ${withMetrics.ys.length}   without: ${without.ys.length}`,
);
const n = Math.min(withMetrics.ys.length, without.ys.length);
let diff = 0,
  max = 0;
const deltas = [];
for (let i = 0; i < n; i += 1) {
  const dy = without.ys[i] - withMetrics.ys[i];
  if (dy !== 0) {
    diff += 1;
    deltas.push(dy);
  }
  max = Math.max(max, Math.abs(dy));
}
console.log(`y differs on ${diff}/${n} sampled text primitives, worst |dy| = ${max.toFixed(3)} px`);
if (deltas.length) {
  const uniq = [...new Set(deltas.map((d) => d.toFixed(3)))].slice(0, 12);
  console.log(`distinct deltas (first 12): ${uniq.join(', ')}`);
}
