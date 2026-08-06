// Dumps the reader's paint commands for one spread, filtered to commands
// whose text matches a needle — rect + spacing fields, to compare run
// geometry against Blink Range measurements.
// usage: node text-cmd-dump.mjs <book.epub> <spread> <needle...>
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
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
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

const dump = await page.evaluate(
  async ({ spread, needles }) => {
    const frame = await globalThis.__ritoReaderDiagnostics.frame(spread);
    const hits = [];
    const scan = (obj, label) => {
      const commands = obj?.commands ?? obj?.displayCommands ?? null;
      if (!Array.isArray(commands)) return false;
      for (const cmd of commands) {
        const text = JSON.stringify(cmd);
        if (needles.some((n) => text.includes(n))) hits.push({ label, cmd });
      }
      return true;
    };
    if (!scan(frame, 'frame')) {
      for (const key of Object.keys(frame ?? {})) {
        const value = frame[key];
        if (Array.isArray(value)) value.forEach((entry, i) => scan(entry, `${key}[${i}]`));
        else if (value && typeof value === 'object') scan(value, key);
      }
    }
    return hits;
  },
  { spread: SPREAD, needles },
);

console.log(JSON.stringify(dump, null, 1));
await browser.close();
