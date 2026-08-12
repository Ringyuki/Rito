// Does Blink compress a fullwidth stop before a closing bracket ONLY
// when the line would otherwise overflow? Reproduce the b20 shape: a
// block whose last line ends "…有點melancholy。」", at widths where the
// uncompressed line just misses. Measure 。's advance per width/align.
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');
const PIN_CJK = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');
const PIN_LATIN = path.join(REPO, 'apps/reader/src/assets/fonts/Tinos-Regular.ttf');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 2000 } });

// 35 CJK + melancholy + 。」 needs 618.2 with compress+trim, 625.8 with
// only end-trim, 633.4 raw. Sweep width around those thresholds.
const prefix = '意義。我不是不喜歡自己的名字，只是感覺很像古代悲劇裡會出現的人物，有點';
const cases = [];
for (const align of ['justify', 'left']) {
  for (const width of [640, 630, 626, 622, 621.16, 619, 617, 610]) {
    cases.push({ align, width });
  }
}
await page.setContent(`<!doctype html><html lang="zh-TW"><meta charset="utf-8"><style>
@font-face { font-family: "__pin_latin"; src: url("file://${PIN_LATIN}"); }
@font-face { font-family: "__pin_cjk"; src: url("file://${PIN_CJK}"); }
body { margin:0; font: 15.2px "__pin_latin","__pin_cjk",serif; }
div { margin:0 0 6px 0; overflow:hidden; }
p { margin:0; }
</style>${cases
  .map(
    ({ align, width }, i) =>
      `<div style="width:${width}px"><p id="p${i}" style="text-align:${align}">${prefix}melancholy。」</p></div>`,
  )
  .join('')}`);
await page.evaluate(async () => {
  await document.fonts.ready;
});
const rows = await page.evaluate((count) => {
  const out = [];
  for (let i = 0; i < count; i++) {
    const node = document.getElementById(`p${i}`).firstChild;
    const text = node.textContent;
    const range = document.createRange();
    const stop = text.indexOf('。');
    const meas = (s, e) => {
      range.setStart(node, s);
      range.setEnd(node, e);
      const r = range.getBoundingClientRect();
      return { w: +r.width.toFixed(2), top: +r.top.toFixed(0) };
    };
    const dot = meas(stop, stop + 1);
    const bracket = meas(stop + 1, stop + 2);
    const m = meas(text.indexOf('m'), text.indexOf('m') + 1);
    out.push({
      dotW: dot.w,
      bracketW: bracket.w,
      sameLine: dot.top === m.top,
      lines: meas(0, text.length),
    });
  }
  return out;
}, cases.length);
cases.forEach(({ align, width }, i) => {
  const r = rows[i];
  console.log(
    `${align.padEnd(7)} w=${String(width).padEnd(7)} dot=${r.dotW} bracket=${r.bracketW} wordOnDotLine=${r.sameLine}`,
  );
});
await browser.close();
