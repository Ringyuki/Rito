// Truth-geometry probe: reproduce the pixel-walk truth EXACTLY for one
// chapter and Range-measure the wrap line around a marker string, to
// find where Blink saves width that naive advance sums do not predict.
// usage: node melancholy-probe.mjs <chapterFile> <marker>
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');

const [, , chapterFile, marker] = process.argv;
const PIN_LATIN = path.join(REPO, 'apps/reader/src/assets/fonts/Tinos-Regular.ttf');
const PIN_CJK = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');
const contentW = 640;
const contentH = 850;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: contentW + 200, height: contentH },
  deviceScaleFactor: 1,
  javaScriptEnabled: false,
});
const truth = await context.newPage();
await truth.goto(`file://${path.resolve(chapterFile)}`, { timeout: 30000 });
// javaScriptEnabled:false blocks page scripts but not evaluate()… actually
// it blocks evaluate too in Playwright? No: evaluate works via CDP.
await truth.evaluate(
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
await truth.waitForTimeout(300);

const data = await truth.evaluate((marker) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = null;
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.includes(marker)) {
      node = walker.currentNode;
      break;
    }
  }
  if (!node) return { error: `marker not found: ${marker}` };
  const text = node.textContent;
  const range = document.createRange();
  const chars = [];
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    chars.push({
      ch: text[i],
      x: +r.left.toFixed(3),
      w: +r.width.toFixed(3),
      top: +r.top.toFixed(1),
    });
  }
  const paragraph = node.parentElement;
  const cs = getComputedStyle(paragraph);
  return {
    paragraphFont: cs.fontFamily,
    fontSize: cs.fontSize,
    textAlign: cs.textAlign,
    paraRect: paragraph.getBoundingClientRect().toJSON(),
    chars,
  };
}, marker);

if (data.error) {
  console.error(data.error);
} else {
  console.log(`font: ${data.paragraphFont} size ${data.fontSize} align ${data.textAlign}`);
  console.log(`para rect x=${data.paraRect.x} w=${data.paraRect.width}`);
  // Group chars into visual lines by top
  let prevTop = null;
  for (const c of data.chars) {
    if (prevTop === null || Math.abs(c.top - prevTop) > 2) {
      console.log(`--- line top ${c.top}`);
      prevTop = c.top;
    }
    console.log(`  ${JSON.stringify(c.ch)} x=${c.x} w=${c.w}`);
  }
}
await browser.close();
