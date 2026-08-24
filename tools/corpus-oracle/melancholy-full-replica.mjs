// Full-fidelity replica of the b20 melancholy paragraph: exact ancestor
// styles, multicol 640, pinned faces. Prints per-line text + the 。/」
// advances on the final line.
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');
const PIN_CJK = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');
const PIN_LATIN = path.join(REPO, 'apps/reader/src/assets/fonts/Tinos-Regular.ttf');

const para =
  '「我聽說日文的名字大多不是只有音，而是有含意的。像小春就是spring day，古泉就是old spring。呵呵，真有趣。長門就是long gate了吧。可是我的名字寫成日文好像也不會有什麼意義。我不是不喜歡自己的名字，只是感覺很像古代悲劇裡會出現的人物，有點melancholy。」';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 950 }, deviceScaleFactor: 1 });
await page.setContent(
  `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><style>
@font-face { font-family: "__rito_pin_latin"; src: url("file://${PIN_LATIN}"); }
@font-face { font-family: "__rito_pin_cjk"; src: url("file://${PIN_CJK}"); }
html { margin:0; padding:0; width:640px; height:850px; column-width:640px; column-gap:3000px; column-fill:auto; }
body { padding:0%; margin-top:0%; margin-bottom:0%; margin-left:1%; margin-right:1%; line-height:1.2; text-align:justify;
       font-size:16px; font-family:"__rito_pin_latin","__rito_pin_cjk",sans-serif; }
p { text-indent:2em; display:block; line-height:1.35; margin-top:0.5em; margin-bottom:0.5em; }
div { margin:0; padding:0; line-height:1.2; text-align:justify; }
.article { font-size:0.95em; padding:0.2em; line-height:0.25em; vertical-align:bottom; }
</style></head><body><div class="article"><p id="t">${para}</p></div></body></html>`,
);
await page.evaluate(async () => {
  await document.fonts.ready;
});
await page.waitForTimeout(200);
const data = await page.evaluate(() => {
  const node = document.getElementById('t').firstChild;
  const text = node.textContent;
  const range = document.createRange();
  const lines = [];
  let prevTop = null;
  let start = 0;
  const tops = [];
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    tops.push(r.top);
    if (prevTop === null) prevTop = r.top;
    else if (r.top > prevTop + 2) {
      lines.push(text.slice(start, i));
      start = i;
      prevTop = r.top;
    }
  }
  lines.push(text.slice(start));
  const meas = (idx) => {
    range.setStart(node, idx);
    range.setEnd(node, idx + 1);
    const r = range.getBoundingClientRect();
    return { w: +r.width.toFixed(3), x: +r.left.toFixed(3) };
  };
  const stop = text.lastIndexOf('。');
  const para = document.getElementById('t').getBoundingClientRect();
  return {
    lines,
    paraX: +para.x.toFixed(3),
    paraW: +para.width.toFixed(3),
    dot: meas(stop),
    bracket: meas(stop + 1),
    lastCharEnd: (() => {
      const b = meas(text.length - 1);
      return +(b.x + b.w).toFixed(3);
    })(),
  };
});
data.lines.forEach((l, i) => console.log(i, JSON.stringify(l)));
console.log(
  `para x=${data.paraX} w=${data.paraW} | dot w=${data.dot.w} | bracket w=${data.bracket.w} | line right edge=${data.lastCharEnd} (para right=${(data.paraX + data.paraW).toFixed(3)})`,
);
await browser.close();
