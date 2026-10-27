// Stacks each pen's render of a scrolled window on its render of the next
// window and diffs the stack against the same pen's render of the pair
// painted as one run (`seam-<case>-…-a`, `-b`, `-ab`, written by the
// engine's seam lowering). That a window draws what the pair draws is the
// engine's own test (`a_window_draws_its_content_as_the_pair_…`); what
// this reports is how the pens raster the two: a canvas picks its
// antialiasing mode from everything a frame holds, and a scaled image cut
// by the window edge samples only what is visible, so a window and the
// pair can raster an edge a few levels apart, now and then a pixel past
// the floor. Writes <outRoot>/seam-report.md and a red-overlay diff PNG
// per divergent pair; exits 1 only when the stack is not the pair's size
// or a render is missing.
//
//   node tools/paint-parity/seam-diff.mjs [outRoot]
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const { PNG } = createRequire(`${REPO}package.json`)('pngjs');

const outRoot = process.argv[2] ?? path.join(HERE, 'out-seams');
/** The walk's raster floor: the report counts the pixels past it apart. */
const FLOOR = 13;
const LANES = [
  'browser',
  'browser-offscreen',
  'browser-gl-software',
  'browser-gpu',
  'browser-gl',
  'flutter',
];

const pairs = readdirSync(path.join(outRoot, 'lowered'))
  .filter((file) => file.startsWith('seam-') && file.endsWith('-ab.json'))
  .map((file) => file.slice(0, -'-ab.json'.length))
  .sort();

const read = (dir, name) => {
  const file = path.join(outRoot, dir, `${name}.png`);
  return existsSync(file) ? PNG.sync.read(readFileSync(file)) : undefined;
};

/** Pixels the stacked windows and the pair differ in, and those beyond the floor. */
function stackDiff(top, bottom, pair) {
  if (top.width !== pair.width || bottom.width !== pair.width) {
    return { error: `widths ${top.width}/${bottom.width} vs ${pair.width}` };
  }
  if (top.height + bottom.height !== pair.height) {
    return { error: `heights ${top.height}+${bottom.height} vs ${pair.height}` };
  }
  const overlay = new PNG({ width: pair.width, height: pair.height });
  let count = 0;
  let beyond = 0;
  for (let y = 0; y < pair.height; y += 1) {
    const [source, row] = y < top.height ? [top, y] : [bottom, y - top.height];
    for (let x = 0; x < pair.width; x += 1) {
      const at = (y * pair.width + x) * 4;
      const from = (row * pair.width + x) * 4;
      let delta = 0;
      for (let c = 0; c < 4; c += 1) {
        delta = Math.max(delta, Math.abs(source.data[from + c] - pair.data[at + c]));
      }
      const differs = delta > 0;
      if (differs) count += 1;
      if (delta > FLOOR) beyond += 1;
      for (let c = 0; c < 3; c += 1) {
        overlay.data[at + c] = differs ? [255, 0, 0][c] : 192 + (pair.data[at + c] >> 2);
      }
      overlay.data[at + 3] = 255;
    }
  }
  return { count, beyond, overlay };
}

const lines = [
  '# Scroll seams: stacked windows vs the pair painted as one',
  '',
  `Pixels a stacked pair differs in, and those beyond the raster floor (>${FLOOR}/channel).`,
  '',
];
let failures = 0;
for (const lane of LANES) {
  if (!existsSync(path.join(outRoot, lane))) continue;
  const diffDir = path.join(outRoot, `seam-diff-${lane}`);
  mkdirSync(diffDir, { recursive: true });
  const bad = [];
  const raster = [];
  for (const pair of pairs) {
    const [top, bottom, whole] = ['a', 'b', 'ab'].map((part) => read(lane, `${pair}-${part}`));
    if (!top || !bottom || !whole) {
      bad.push(`${pair}: missing render`);
      continue;
    }
    const result = stackDiff(top, bottom, whole);
    if (result.error) {
      bad.push(`${pair}: ${result.error}`);
    } else if (result.count > 0) {
      raster.push(`${pair}: ${result.count} px, ${result.beyond} beyond the floor`);
      writeFileSync(path.join(diffDir, `${pair}.png`), PNG.sync.write(result.overlay));
    }
  }
  failures += bad.length;
  const identical = pairs.length - bad.length - raster.length;
  lines.push(`## ${lane}: ${identical}/${pairs.length} pairs raster identically`, '');
  for (const entry of [...bad, ...raster]) lines.push(`- ${entry}`);
  lines.push('');
}
writeFileSync(path.join(outRoot, 'seam-report.md'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
process.exit(failures === 0 ? 0 : 1);
