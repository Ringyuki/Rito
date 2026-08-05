// Dumps the reader's per-spread paint commands that reference images,
// to see WHICH src each page actually paints.
// usage: node image-cmd-dump.mjs <book.epub> <spreadCount>
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');

const [, , bookPath, spreadCountArg] = process.argv;
const SPREADS = Number(spreadCountArg ?? 8);
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

const dump = await page.evaluate(async (spreads) => {
  const out = [];
  for (let s = 0; s < spreads; s += 1) {
    try {
      const frame = await globalThis.__ritoReaderDiagnostics.frame(s);
      const summary = { spread: s, keys: Object.keys(frame ?? {}), images: [] };
      const scan = (obj, pageLabel) => {
        const commands = obj?.commands ?? obj?.displayCommands ?? null;
        if (!Array.isArray(commands)) return false;
        for (const cmd of commands) {
          const text = JSON.stringify(cmd);
          if (text.includes('.jpg') || text.includes('.png') || text.includes('image')) {
            const m = /"src"\s*:\s*"([^"]+)"|"href"\s*:\s*"([^"]+)"/.exec(text);
            if (m) summary.images.push({ page: pageLabel, src: m[1] ?? m[2] });
          }
        }
        return true;
      };
      if (!scan(frame, 'frame')) {
        for (const key of Object.keys(frame ?? {})) {
          const value = frame[key];
          if (Array.isArray(value)) {
            value.forEach((entry, i) => scan(entry, `${key}[${i}]`));
          } else if (value && typeof value === 'object') {
            scan(value, key);
          }
        }
      }
      out.push(summary);
    } catch (error) {
      out.push({ spread: s, error: String(error) });
    }
  }
  return out;
}, SPREADS);
console.log(JSON.stringify(dump, null, 1));
await browser.close();
