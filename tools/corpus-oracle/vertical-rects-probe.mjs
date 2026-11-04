// What Chromium gives as the client rects of vertical-rl text: for each
// paragraph of a page laid out the way the engine lays out the vertical
// fixture (content box at the page's margins, the pinned serif), the rects
// of every character's range and the caret rect before it, in page
// coordinates. The engine's page records, mapped to the display list, are
// compared against these: the thickness of a run's rect across its column,
// where it sits, and a caret's shape.
//
// Usage: node tools/corpus-oracle/vertical-rects-probe.mjs <out.json>
//   env RITO_PROBE_WIDTH / RITO_PROBE_HEIGHT / RITO_PROBE_MARGIN (420 / 640 / 24)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchOracleChromium } from '../oracle-chromium.mjs';

const REPO = new URL('../..', import.meta.url).pathname;
const [, , out] = process.argv;
if (!out) {
  console.error('usage: node vertical-rects-probe.mjs <out.json>');
  process.exit(1);
}
const width = Number(process.env.RITO_PROBE_WIDTH ?? 420);
const height = Number(process.env.RITO_PROBE_HEIGHT ?? 640);
const margin = Number(process.env.RITO_PROBE_MARGIN ?? 24);
const font = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');
// The vertical fixture's paragraphs (runtime/tests/fixture.rs), under the
// user agent's own paragraph margins as the engine's are.
const text = '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。'.repeat(6);
const paragraphs = Array.from({ length: 3 }, (_, index) => `<p id="p${index}">${text}</p>`);

// A page loaded from file://, not set as content: an about:blank page cannot
// load the file:// face, and the truth would be a fallback font.
const htmlPath = `${out}.html`;
writeFileSync(
  htmlPath,
  `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Pinned Serif"; src: url("file://${font}"); }
html { writing-mode: vertical-rl; font-family: "Pinned Serif"; font-size: 16px; }
html, body { margin: 0; padding: 0; }
body { position: absolute; top: ${margin}px; right: ${margin}px; height: ${height - 2 * margin}px; }
</style></head><body>${paragraphs.join('')}</body></html>`,
);
const browser = await launchOracleChromium();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
await page.goto(`file://${path.resolve(htmlPath)}`);
await page.evaluate(() => document.fonts.ready);
const loaded = await page.evaluate(() => document.fonts.check('16px "Pinned Serif"'));
if (!loaded) throw new Error('the pinned serif did not load: the truth would be a fallback font');
const rects = await page.evaluate(() => {
  const box = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  return [...document.querySelectorAll('p')].map((p) => {
    const node = p.firstChild;
    const characters = [];
    for (let offset = 0; offset < node.length; offset += 1) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const caret = document.createRange();
      caret.setStart(node, offset);
      caret.collapse(true);
      characters.push({
        offset,
        rects: [...range.getClientRects()].map(box),
        caret: [...caret.getClientRects()].map(box),
      });
    }
    return { id: p.id, characters };
  });
});
writeFileSync(out, JSON.stringify({ width, height, margin, rects }, null, 1));
console.log(`wrote ${rects.length} paragraphs to ${out}`);
await browser.close();
