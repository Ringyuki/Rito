// Replicates the pixel-walk truth page (multicol columns, pin rewrite)
// for ONE chapter and reports each block's border-box and line-box
// geometry with the column it landed in — the oracle for fragmentainer
// break decisions (which entry opens column 2, and by how much the
// straddler missed). Line rects come from Range, not box math.
//
// Usage: node toc-break-probe.mjs <chapter.xhtml> [selector]
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${new URL('../..', import.meta.url).pathname}package.json`)(
  '@playwright/test',
);

const REPO = new URL('../..', import.meta.url).pathname;
const PIN_LATIN = path.join(REPO, 'apps/reader/src/assets/fonts/Tinos-Regular.ttf');
const PIN_CJK = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');
const contentW = 640;
const contentH = 850;

const [, , chapterFile, selector = 'p'] = process.argv;
if (!chapterFile) {
  console.error('usage: node toc-break-probe.mjs <chapter.xhtml> [selector]');
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: contentW + 200, height: contentH },
  deviceScaleFactor: 1,
  javaScriptEnabled: false,
});
const page = await context.newPage();
await page.goto(`file://${path.resolve(chapterFile)}`, { timeout: 30000 });
await page.evaluate(
  async ({ contentW, contentH, pinLatin, pinCjk }) => {
    const s = document.createElement('style');
    s.textContent = `@font-face { font-family: "__rito_pin_latin"; src: url("${pinLatin}"); }
@font-face { font-family: "__rito_pin_cjk"; src: url("${pinCjk}"); }
html { margin:0; padding:0; width:${contentW}px; height:${contentH}px; column-width:${contentW}px; column-gap:3000px; column-fill:auto; }
body { margin:0; padding:0; }
img, svg { max-height: ${contentH}px !important; max-width: 100%; }`;
    document.head.insertBefore(s, document.head.firstChild);
    await document.fonts.load('16px "__rito_pin_latin"', 'H');
    await document.fonts.load('16px "__rito_pin_cjk"', '试');
    await document.fonts.ready;
    const generic = new Set([
      'serif',
      'sans-serif',
      'monospace',
      'cursive',
      'fantasy',
      'system-ui',
    ]);
    const bookFaces = new Set(
      [...document.fonts]
        .map((face) => face.family.replaceAll('"', '').toLowerCase())
        .filter((name) => !name.startsWith('__rito_pin')),
    );
    const pins = ['"__rito_pin_latin"', '"__rito_pin_cjk"'];
    for (const element of [document.documentElement, ...document.querySelectorAll('*')]) {
      const list = getComputedStyle(element).fontFamily;
      const parts = [];
      let pinsAdded = false;
      for (const raw of list
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0)) {
        const lower = raw.replaceAll('"', '').toLowerCase();
        if (generic.has(lower)) {
          if (!pinsAdded) {
            parts.push(...pins);
            pinsAdded = true;
          }
          parts.push(lower);
          continue;
        }
        if (!bookFaces.has(lower)) continue;
        parts.push(raw);
      }
      if (!pinsAdded) parts.push(...pins);
      const tail = parts.at(-1);
      if (tail === undefined || !generic.has(tail)) parts.push('serif');
      element.style.setProperty('font-family', parts.join(', '), 'important');
    }
    await document.fonts.ready;
  },
  { contentW, contentH, pinLatin: PIN_LATIN, pinCjk: PIN_CJK },
);
await page.waitForTimeout(250);

const report = await page.evaluate(
  ({ contentW, selector }) => {
    const pitch = contentW + 3000; // column width + gap
    const rows = [];
    for (const el of document.querySelectorAll(selector)) {
      const box = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const lineRects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      const column = Math.floor((box.left + 1) / pitch);
      rows.push({
        text: (el.textContent ?? '').trim().slice(0, 20),
        column,
        boxTop: box.top,
        boxBottom: box.bottom,
        lines: lineRects.map((r) => ({
          column: Math.floor((r.left + 1) / pitch),
          top: r.top,
          bottom: r.bottom,
          left: r.left - Math.floor((r.left + 1) / pitch) * pitch,
        })),
      });
    }
    return rows;
  },
  { contentW, selector },
);
for (const row of report) {
  const lines = row.lines
    .map((l) => `col ${l.column} top ${l.top.toFixed(6)} bottom ${l.bottom.toFixed(6)}`)
    .join(' | ');
  console.log(
    `col ${row.column} box ${row.boxTop.toFixed(6)}..${row.boxBottom.toFixed(6)}  [${lines}]  ${row.text}`,
  );
}
await browser.close();
