// Natural (unjustified, unconstrained) per-char advances of the
// melancholy paragraph: real chapter file (with pixel-walk pin rewrite)
// vs synthetic replica (pins directly). Prints the first advances that
// differ — the char whose measurement diverges between the two stacks.
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');
const PIN_CJK = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');
const PIN_LATIN = path.join(REPO, 'apps/reader/src/assets/fonts/Tinos-Regular.ttf');
const CHAPTER = path.resolve('walk-b20-v7/book/OEBPS/Text/chapter3.xhtml');

const MARKER = 'melancholy';

async function measureReal(browser) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 900 },
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto(`file://${CHAPTER}`);
  await page.evaluate(
    async ({ pinLatin, pinCjk }) => {
      const s = document.createElement('style');
      s.textContent = `@font-face { font-family: "__rito_pin_latin"; src: url("${pinLatin}"); }
@font-face { font-family: "__rito_pin_cjk"; src: url("${pinCjk}"); }
html { margin:0; padding:0; width:5000px !important; column-width:5000px !important; column-gap:3000px; }
body { margin:0; padding:0; }
p { text-align:left !important; }`;
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
    { pinLatin: PIN_LATIN, pinCjk: PIN_CJK },
  );
  await page.waitForTimeout(200);
  const data = await page.evaluate((marker) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.includes(marker)) {
        node = walker.currentNode;
        break;
      }
    }
    const text = node.textContent;
    const range = document.createRange();
    const out = [];
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      out.push(+range.getBoundingClientRect().width.toFixed(3));
    }
    return { text, widths: out, font: getComputedStyle(node.parentElement).fontFamily };
  }, MARKER);
  await context.close();
  return data;
}

async function measureReplica(browser, text) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.setContent(
    `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><style>
@font-face { font-family: "__rito_pin_latin"; src: url("file://${PIN_LATIN}"); }
@font-face { font-family: "__rito_pin_cjk"; src: url("file://${PIN_CJK}"); }
html { margin:0; padding:0; width:5000px; }
body { margin:0; font-size:16px; font-family:"__rito_pin_latin","__rito_pin_cjk",sans-serif; }
p { text-align:left; font-size:0.95em; margin:0; white-space:nowrap; }
</style></head><body><p id="t">${text}</p></body></html>`,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const data = await page.evaluate(() => {
    const node = document.getElementById('t').firstChild;
    const text = node.textContent;
    const range = document.createRange();
    const out = [];
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      out.push(+range.getBoundingClientRect().width.toFixed(3));
    }
    return out;
  });
  await page.close();
  return data;
}

const browser = await chromium.launch();
const real = await measureReal(browser);
console.log('real font stack:', real.font);
const replica = await measureReplica(browser, real.text);
let diffs = 0;
let realSum = 0;
let replicaSum = 0;
for (let i = 0; i < real.widths.length; i++) {
  realSum += real.widths[i];
  replicaSum += replica[i];
  if (Math.abs(real.widths[i] - replica[i]) > 0.05) {
    diffs += 1;
    if (diffs <= 20)
      console.log(
        `[${i}] ${JSON.stringify(real.text[i])} real=${real.widths[i]} replica=${replica[i]}`,
      );
  }
}
console.log(
  `${diffs} differing chars; total real=${realSum.toFixed(2)} replica=${replicaSum.toFixed(2)}`,
);
await browser.close();
