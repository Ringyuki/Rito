// Dumps the reader's `draw-image` primitives for the first N spreads —
// which `src` each spread actually paints, and where (`dest` rect in
// device pixels).
// usage: node image-cmd-dump.mjs <book.epub> [spreadCount=8]
//   env RITO_READER_URL (default http://localhost:5173/)
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');

const [, , bookPath, spreadCountArg] = process.argv;
if (!bookPath) {
  console.error('usage: node image-cmd-dump.mjs <book.epub> [spreadCount=8]');
  process.exit(1);
}
const SPREADS = Number(spreadCountArg ?? 8);
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
await page.waitForTimeout(1500);

const dump = await page.evaluate(async (spreads) => {
  const out = [];
  for (let s = 0; s < spreads; s += 1) {
    try {
      const frame = await globalThis.__ritoReaderDiagnostics.frame(s);
      if (!frame) {
        out.push({ spread: s, error: 'no frame' });
        continue;
      }
      out.push({
        spread: s,
        commandCount: frame.commands.length,
        resourceImages: frame.resourceRefs.images,
        images: frame.commands
          .filter((command) => command.kind === 'draw-image')
          .map((command) => ({ src: command.src, dest: command.dest })),
      });
    } catch (error) {
      out.push({ spread: s, error: String(error) });
    }
  }
  return out;
}, SPREADS);
console.log(JSON.stringify(dump, null, 1));
await browser.close();
