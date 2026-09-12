// Dumps the reader's text primitives for one spread, filtered to the
// `text` / `ruby` primitives whose JSON matches a needle: run text, rect,
// paint, and the per-cluster origins the engine placed — to compare run
// geometry against Blink Range measurements of the same text.
// usage: node text-cmd-dump.mjs <book.epub> <spread> <needle...>
//   env RITO_READER_URL (default http://localhost:5173/)
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');

const [, , bookPath, spreadArg, ...needles] = process.argv;
if (!bookPath || !spreadArg || needles.length === 0) {
  console.error('usage: node text-cmd-dump.mjs <book.epub> <spread> <needle...>');
  process.exit(1);
}
const SPREAD = Number(spreadArg);
const BASE = process.env.RITO_READER_URL ?? 'http://localhost:5173/';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1500, height: 950 },
  deviceScaleFactor: 1,
});
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

// Warm traversal so lazy font registrations have reflowed, like the walk.
const total = await page.evaluate(() => window.__ritoController.reader.spreads.length);
for (let s = 0; s < total; s += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(60);
}
await page.waitForTimeout(2000);
// Walk back ONTO the target spread: frames far from the current one may
// be evicted, and the diagnostics read the cached frame.
for (let s = total - 1; s > SPREAD; s -= 1) {
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(60);
}
await page.waitForTimeout(1500);

const dump = await page.evaluate(
  async ({ spread, needles }) => {
    const frame = await globalThis.__ritoReaderDiagnostics.frame(spread);
    if (!frame) return { error: `no frame for spread ${spread}` };
    const hits = [];
    for (const command of frame.commands) {
      if (command.kind !== 'text' && command.kind !== 'ruby') continue;
      const json = JSON.stringify(command, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      if (needles.some((needle) => json.includes(needle))) hits.push(JSON.parse(json));
    }
    return { spread, ratio: frame.ratio, commandCount: frame.commands.length, hits };
  },
  { spread: SPREAD, needles },
);

console.log(JSON.stringify(dump, null, 1));
await browser.close();
