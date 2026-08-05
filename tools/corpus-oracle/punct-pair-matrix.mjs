// Empirical Blink adjacent-punctuation compression matrix: for each pair
// (A, B) of fullwidth punctuation classes, measure A's and B's rendered
// advances inside 中A B中 at 2000px (no wrapping, no justify) under the
// pinned CJK face. 15.2 = full, ~7.6 = compressed half.
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');
const PIN_CJK = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');

const CLASSES = {
  open: ['「', '『', '（', '《'],
  close: ['」', '』', '）', '》'],
  dot: ['。', '．'],
  comma: ['、', '，'],
  middle: ['・', '：', '；'],
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2400, height: 400 } });
const reps = Object.entries(CLASSES).flatMap(([cls, chars]) => chars.map((ch) => [cls, ch]));
const pairs = [];
for (const [ca, a] of reps) for (const [cb, b] of reps) pairs.push({ ca, a, cb, b });

await page.setContent(`<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "__pin_cjk"; src: url("file://${PIN_CJK}"); }
body { margin:0; font: 15.2px "__pin_cjk"; }
p { margin:0; white-space:nowrap; }
</style>${pairs.map(({ a, b }, i) => `<p id="p${i}">中${a}${b}中</p>`).join('')}`);
await page.evaluate(async () => {
  await document.fonts.ready;
});
const rows = await page.evaluate((count) => {
  const out = [];
  for (let i = 0; i < count; i++) {
    const node = document.getElementById(`p${i}`).firstChild;
    const range = document.createRange();
    const w = (s, e) => {
      range.setStart(node, s);
      range.setEnd(node, e);
      return +range.getBoundingClientRect().width.toFixed(2);
    };
    out.push({ a: w(1, 2), b: w(2, 3) });
  }
  return out;
}, pairs.length);
const label = (w) => (w < 11 ? 'HALF' : 'full');
const seen = new Map();
pairs.forEach(({ ca, a, cb, b }, i) => {
  const key = `${ca}+${cb}`;
  const verdict = `A:${label(rows[i].a)} B:${label(rows[i].b)}`;
  if (!seen.has(key)) seen.set(key, new Map());
  const m = seen.get(key);
  m.set(verdict, (m.get(verdict) ?? 0) + 1);
  if (rows[i].a > 11 !== (label(rows[i].a) === 'full'))
    console.log('odd', a, b, rows[i]);
});
for (const [key, verdicts] of seen) {
  const parts = [...verdicts.entries()].map(([v, n]) => `${v}(${n})`).join(' ');
  console.log(key.padEnd(14), parts);
}
await browser.close();
