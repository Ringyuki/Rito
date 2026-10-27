// Stacks each pen's render of a scrolled window on its render of the next
// window and diffs the stack against the same pen's render of the pair
// painted as one run (`seam-<case>-…-a`, `-b`, `-ab`, written by the
// engine's seam lowering). Windows tile a chapter row for row, so every
// lane's budget is zero. Writes <outRoot>/seam-report.md and a red-overlay
// diff PNG per divergent pair; exits 1 on any differing pixel.
//
//   node tools/paint-parity/seam-diff.mjs [outRoot]
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const { PNG } = createRequire(`${REPO}package.json`)('pngjs');

const outRoot = process.argv[2] ?? path.join(HERE, 'out-seams');
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

/** Differing pixels between the stacked windows and the pair. */
function stackDiff(top, bottom, pair) {
  if (top.width !== pair.width || bottom.width !== pair.width) {
    return { error: `widths ${top.width}/${bottom.width} vs ${pair.width}` };
  }
  if (top.height + bottom.height !== pair.height) {
    return { error: `heights ${top.height}+${bottom.height} vs ${pair.height}` };
  }
  const overlay = new PNG({ width: pair.width, height: pair.height });
  let count = 0;
  for (let y = 0; y < pair.height; y += 1) {
    const [source, row] = y < top.height ? [top, y] : [bottom, y - top.height];
    for (let x = 0; x < pair.width; x += 1) {
      const at = (y * pair.width + x) * 4;
      const from = (row * pair.width + x) * 4;
      let differs = false;
      for (let c = 0; c < 4; c += 1) differs ||= source.data[from + c] !== pair.data[at + c];
      if (differs) count += 1;
      for (let c = 0; c < 3; c += 1) {
        overlay.data[at + c] = differs ? [255, 0, 0][c] : 192 + (pair.data[at + c] >> 2);
      }
      overlay.data[at + 3] = 255;
    }
  }
  return { count, overlay };
}

const lines = ['# Scroll seams: stacked windows vs the pair painted as one', ''];
let failures = 0;
for (const lane of LANES) {
  if (!existsSync(path.join(outRoot, lane))) continue;
  const diffDir = path.join(outRoot, `seam-diff-${lane}`);
  mkdirSync(diffDir, { recursive: true });
  const bad = [];
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
      bad.push(`${pair}: ${result.count} px`);
      writeFileSync(path.join(diffDir, `${pair}.png`), PNG.sync.write(result.overlay));
    }
  }
  failures += bad.length;
  lines.push(`## ${lane}: ${pairs.length - bad.length}/${pairs.length} pairs seamless`, '');
  for (const entry of bad) lines.push(`- ${entry}`);
  lines.push('');
}
writeFileSync(path.join(outRoot, 'seam-report.md'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
process.exit(failures === 0 ? 0 : 1);
