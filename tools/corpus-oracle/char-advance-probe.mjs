// Per-character advance forensics on the walk's truth replica: loads one
// chapter with the pixel-walk pin rewrite (multicol, 640x850) and reports
// each character's Range left edge for the Nth <p> — x-DELTAS are the
// advances (box widths drift; deltas do not). The oracle for razor-fit
// line-break divergence: where exactly does the accumulated advance cross
// the column width?
//
// usage: node char-advance-probe.mjs <chapter.xhtml> [pIndex] [maxChars]
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

const [, , chapterFile, pIndexArg = '0', maxCharsArg = '90'] = process.argv;
if (!chapterFile) {
  console.error('usage: node char-advance-probe.mjs <chapter.xhtml> [pIndex] [maxChars]');
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
img, svg { max-height: ${contentH}px !important; max-width: 100%; }
img { object-fit: contain; }`;
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
  ({ pIndex, maxChars }) => {
    const p = document.querySelectorAll('p')[pIndex];
    if (!p) return { error: 'no such <p>' };
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const rows = [];
    let count = 0;
    let node;
    while ((node = walker.nextNode()) && count < maxChars) {
      const text = node.textContent ?? '';
      for (let i = 0; i < text.length && count < maxChars; i += 1) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        rows.push({ ch: text[i], left: rect.left, top: rect.top, width: rect.width });
        count += 1;
      }
    }
    const style = getComputedStyle(p);
    return {
      rows,
      pRect: p.getBoundingClientRect().toJSON(),
      font: style.fontSize,
      indent: style.textIndent,
      family: style.fontFamily.slice(0, 60),
    };
  },
  { pIndex: Number(pIndexArg), maxChars: Number(maxCharsArg) },
);
if (report.error) {
  console.error(report.error);
} else {
  console.log(
    `p rect x ${report.pRect.x} w ${report.pRect.width} font ${report.font} indent ${report.indent}`,
  );
  const rows = report.rows;
  for (let i = 0; i < rows.length; i += 1) {
    const cur = rows[i];
    const next = rows[i + 1];
    // Advance = next left − this left while on the same line; the line's
    // last char falls back to its own Range width.
    const sameLine = next && Math.abs(next.top - cur.top) < 2;
    const advance = sameLine ? next.left - cur.left : cur.width;
    console.log(
      `${String(i).padStart(3)} ${cur.ch === '　' ? '□' : cur.ch} left ${cur.left.toFixed(6)} adv ${advance.toFixed(6)}${sameLine ? '' : '  <LINE END>'}`,
    );
  }
}
await browser.close();
