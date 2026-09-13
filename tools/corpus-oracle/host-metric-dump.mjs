// Dumps what the browser measured for `line-height: normal`: the metric
// entries the reader injected into the engine, keyed by family stack and
// size. The Flutter host has no such channel, so this is the value the
// two hosts disagree about.
import { createRequire } from 'node:module';
const require2 = createRequire(new URL('../../packages/rito/package.json', import.meta.url));
const { chromium } = require2('@playwright/test');

const [bookPath, url = 'http://127.0.0.1:4174/'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: { width: 1280, height: 900 },
});
await page.goto(url);
await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(1200);
await page.setInputFiles('input[type=file]', bookPath);
await page.waitForSelector('[data-testid=reader-shell][data-loaded=true]', { timeout: 300000 });
await page.waitForTimeout(2000);
const entries = await page.evaluate(() => window.__ritoReaderDiagnostics.hostLineMetrics());
console.log(`measured entries: ${entries.length}`);
const shown = entries.filter((e) => (e.sample ?? '') !== '').slice(0, 16);
console.log('family | size | height | ascent | descent   (strut entries, empty sample)');
for (const e of shown) {
  console.log(
    `${String(e.family).slice(0, 26).padEnd(28)} ${String(e.size).padStart(6)} sample=${JSON.stringify(e.sample)} height=${String(e.height ?? e.metric?.height)}`,
  );
}
console.log(
  'sample keys used:',
  [...new Set(entries.map((e) => JSON.stringify(e.sample ?? '')))].slice(0, 10).join(' '),
);
await browser.close();
