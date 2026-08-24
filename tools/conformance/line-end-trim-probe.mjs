// Line-end fullwidth-punctuation probe against the pinned truth Chromium.
//
// Blink (main, 2026-07) extends a line past its first overflowing character
// when that character is a fullwidth closing bracket or closing quote
// (HanKerningCharType kClose / kCloseQuote), a break opportunity exists
// after it, and the character fits once its blank right half is trimmed via
// the font's `halt` feature (`ShapingLineBreaker::ShapeLine`). The static
// gate excludes kDot (。、，．) and kColon/kSemicolon (：；), and the
// trimmed line must still fit: `width_to_last_safe + trimmed <= available`.
//
// The corpus measurement that motivated this (conformance.md, "line-end
// punctuation hanging") observed a half-width 。 advancing past the content
// edge without breaking — which main-Blink's algorithm cannot produce. One
// of the two is wrong for OUR pinned Chromium, and this probe asks it
// directly: for each candidate character and each width condition, does the
// line keep the character, and at what advance?
//
// Conditions per character (prefix of N=10 ideographs, 16px, so 160px):
//   full-fits      W = 160 + 18   full-width fits; expect no trim, stays
//   trim-fits      W = 160 + 10   full overflows, half fits; trim => stays
//   trim-overflows W = 160 + 5    even half overflows; trim => breaks,
//                                 hang => stays past the edge
// Plus a double-closer case (」」, trim-fits width) probing the
// break-after-candidate requirement, and a pair case (。」).
//
// Usage: node tools/conformance/line-end-trim-probe.mjs [outDir]

import { createRequire } from 'node:module';
import path from 'node:path';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');
const outDir = process.argv[2] ?? '/tmp/rito-line-end-trim-probe';
const outJson = path.join(outDir, 'probe.json');

const PINNED_SERIF = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
copyFileSync(PINNED_SERIF, path.join(outDir, 'pinned-serif.otf'));

const CANDIDATES = [
  // Blink kClose (fullwidth Pe): eligible in main.
  '」',
  '』',
  '）',
  '】',
  '〕',
  '》',
  '〉',
  '｝',
  '］',
  // Blink kCloseQuote: eligible in main.
  '’',
  '”',
  // Blink kDot: excluded in main; JLREQ hanging applies to exactly these.
  '。',
  '、',
  '，',
  '．',
  // Blink kColon / kSemicolon: excluded in main.
  '：',
  '；',
  // Never eligible anywhere; controls.
  '！',
  '？',
  '・',
];

const N = 10; // ideograph prefix count
const EM = 16;
const PREFIX = '永'.repeat(N);
const SUFFIX = '永'.repeat(6);
const CONDITIONS = [
  ['full-fits', N * EM + 18],
  ['trim-fits', N * EM + 10],
  ['trim-overflows', N * EM + 5],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 900, height: 700 },
  deviceScaleFactor: 1,
});
const version = browser.version();

const cases = [];
for (const character of CANDIDATES) {
  for (const [condition, width] of CONDITIONS) {
    cases.push({
      id: `c${cases.length}`,
      kind: 'single',
      character,
      condition,
      width,
      text: PREFIX + character + SUFFIX,
      probeIndex: N, // char offset of the candidate
    });
  }
}
// Double closer: break after the first 」 is prohibited, so main-Blink
// refuses the extension even at a width where one trimmed 」 would fit.
cases.push({
  id: `c${cases.length}`,
  kind: 'double-closer',
  character: '」」',
  condition: 'trim-fits',
  width: N * EM + 10,
  text: PREFIX + '」」' + SUFFIX,
  probeIndex: N,
});
// Adjacent pair ending the line: the 。 pair-trims against 」 regardless,
// and the 」 is then the line-end candidate.
cases.push({
  id: `c${cases.length}`,
  kind: 'pair',
  character: '。」',
  condition: 'pair-trim-fits',
  width: N * EM + 8 + 10,
  text: PREFIX + '。」' + SUFFIX,
  probeIndex: N + 1,
});

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: "__rito_serif"; src: url("pinned-serif.otf"); }
  html, body { margin: 0; padding: 0; }
  p {
    font-family: "__rito_serif";
    font-size: ${EM}px;
    line-height: 24px;
    margin: 0;
    text-indent: 0;
    word-break: normal;
    overflow-wrap: normal;
  }
  div { margin: 0 0 8px 0; }
</style></head><body>
${cases
  .map((c) => `<div style="width:${c.width}px"><p id="${c.id}">${c.text}</p></div>`)
  .join('\n')}
</body></html>`;

const htmlFile = path.join(outDir, 'probe.html');
writeFileSync(htmlFile, html);
await page.goto(`file://${htmlFile}`);
await page.evaluate(async () => {
  await document.fonts.load('16px "__rito_serif"', '永。」');
  await document.fonts.ready;
  const pinned = [...document.fonts].find((f) => f.family === '__rito_serif');
  if (pinned?.status !== 'loaded') {
    throw new Error(`pinned serif did not load (${pinned?.status ?? 'absent'})`);
  }
});

const results = await page.evaluate((cases) => {
  return cases.map((c) => {
    const p = document.getElementById(c.id);
    const text = p.firstChild;
    const charRect = (index) => {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      return rects[0] ?? range.getBoundingClientRect();
    };
    const pRect = p.getBoundingClientRect();
    const first = charRect(0);
    const probe = charRect(c.probeIndex);
    const lineOf = (rect) => Math.round((rect.top - pRect.top) / 24);
    // Line count from the paragraph's own height at line-height 24.
    const lines = Math.round(pRect.height / 24);
    return {
      id: c.id,
      kind: c.kind,
      character: c.character,
      condition: c.condition,
      width: c.width,
      lines,
      probeLine: lineOf(probe) - lineOf(first),
      probeAdvance: probe.width,
      probeRightVsBox: probe.right - pRect.left - c.width,
      stayedOnFirstLine: lineOf(probe) === lineOf(first),
    };
  });
}, cases);

const rows = results.map(
  (r) =>
    `${r.kind.padEnd(13)} ${r.character.padEnd(2)} ${r.condition.padEnd(15)} ` +
    `W=${String(r.width).padEnd(4)} lines=${r.lines} probeLine=${r.probeLine} ` +
    `advance=${r.probeAdvance.toFixed(2).padStart(6)} ` +
    `rightOverhang=${r.probeRightVsBox.toFixed(2).padStart(7)} ` +
    `${r.stayedOnFirstLine ? 'STAYED' : 'wrapped'}`,
);
console.log(`chromium ${version}`);
console.log(rows.join('\n'));
writeFileSync(outJson, JSON.stringify({ version, results }, null, 2));
console.log(`\nwritten: ${outJson}`);
