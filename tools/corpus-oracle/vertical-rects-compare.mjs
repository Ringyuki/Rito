// Compares the engine's vertical-rl records with Chromium's: the JSON
// `vertical-rects-probe.mjs` writes for the fixture's paragraphs against the
// one the engine's `dump_vertical_records` test writes for the same page.
// For each character the engine draws, it reports how far the engine's range
// rect and caret sit from Chromium's, and the worst of each over the page.
//
// Usage: node tools/corpus-oracle/vertical-rects-compare.mjs <chrome.json> <engine.json>
import { readFileSync } from 'node:fs';

const [, , chromePath, enginePath] = process.argv;
if (!chromePath || !enginePath) {
  console.error('usage: node vertical-rects-compare.mjs <chrome.json> <engine.json>');
  process.exit(1);
}
const chrome = JSON.parse(readFileSync(chromePath, 'utf8'));
const engine = JSON.parse(readFileSync(enginePath, 'utf8'));

/** The largest difference of any edge of two rects. */
function apart(a, b) {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.x + a.width - (b.x + b.width)),
    Math.abs(a.y + a.height - (b.y + b.height)),
  );
}

const worst = { rect: { apart: 0 }, caret: { apart: 0 } };
let compared = 0;
const samples = [];
for (const paragraph of engine.rects) {
  const truth = chrome.rects.find((each) => each.id === paragraph.id);
  if (!truth) continue;
  for (const character of paragraph.characters) {
    const engineRect = character.rects[0];
    const chromeCharacter = truth.characters.find((each) => each.offset === character.offset);
    const chromeRect = chromeCharacter?.rects[0];
    if (!engineRect || !chromeRect) continue;
    compared += 1;
    const rectApart = apart(engineRect, chromeRect);
    if (rectApart > worst.rect.apart) {
      worst.rect = {
        apart: rectApart,
        id: paragraph.id,
        offset: character.offset,
        engineRect,
        chromeRect,
      };
    }
    const engineCaret = character.caret[0];
    const chromeCaret = chromeCharacter.caret[0];
    if (engineCaret && chromeCaret) {
      const caretApart = apart(engineCaret, chromeCaret);
      if (caretApart > worst.caret.apart) {
        worst.caret = {
          apart: caretApart,
          id: paragraph.id,
          offset: character.offset,
          engineCaret,
          chromeCaret,
        };
      }
    }
    if (samples.length < 3)
      samples.push({
        id: paragraph.id,
        offset: character.offset,
        engineRect,
        chromeRect,
        engineCaret,
        chromeCaret,
      });
  }
}
console.log(JSON.stringify({ compared, worst, samples }, null, 2));
