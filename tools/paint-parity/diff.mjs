// Pixel-diffs each lane's renders of the paint-parity corpus against the
// oracle (the browser pen's semantic render) and writes out/report.md
// sorted by mismatch count, plus a red-overlay diff PNG per divergent
// fixture. The report on disk is the verdict.
//
//   node tools/paint-parity/diff.mjs [outRoot]
//
// Lanes:
//   flutter          the Flutter pen on semantic commands   (budgets.json)
//   browser-lowered  the browser blitter on lowered bytes    (budgets.browser-lowered.json)
//   flutter-lowered  the Flutter blitter on lowered bytes    (budgets.flutter-lowered.json)
// A lane whose render directory is absent is skipped, so the semantic
// half of the instrument still verdicts on its own.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const { PNG } = createRequire(`${REPO}package.json`)('pngjs');

const outRoot = process.argv[2] ?? path.join(HERE, 'out');
const oracleDir = path.join(outRoot, 'browser');

const LANES = [
  { label: 'flutter', renders: 'flutter', diff: 'diff', budgets: 'budgets.json' },
  {
    label: 'browser-lowered',
    renders: 'browser-lowered',
    diff: 'diff-browser-lowered',
    budgets: 'budgets.browser-lowered.json',
  },
  {
    label: 'flutter-lowered',
    renders: 'flutter-lowered',
    diff: 'diff-flutter-lowered',
    budgets: 'budgets.flutter-lowered.json',
  },
];

const names = readdirSync(oracleDir)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.slice(0, -4))
  .sort();

function diffLane(lane) {
  const rendersDir = path.join(outRoot, lane.renders);
  if (!existsSync(rendersDir)) return undefined;
  const diffDir = path.join(outRoot, lane.diff);
  mkdirSync(diffDir, { recursive: true });
  const results = [];
  for (const name of names) {
    const candidatePath = path.join(rendersDir, `${name}.png`);
    if (!existsSync(candidatePath)) {
      results.push({ name, error: `missing ${lane.label} render` });
      continue;
    }
    const a = PNG.sync.read(readFileSync(path.join(oracleDir, `${name}.png`)));
    const b = PNG.sync.read(readFileSync(candidatePath));
    if (a.width !== b.width || a.height !== b.height) {
      results.push({ name, error: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` });
      continue;
    }
    const total = a.width * a.height;
    let diffCount = 0;
    let maxDelta = 0;
    let sumDelta = 0;
    const out = new PNG({ width: a.width, height: a.height });
    for (let i = 0; i < total * 4; i += 4) {
      let pixelDelta = 0;
      for (let c = 0; c < 4; c += 1) {
        pixelDelta = Math.max(pixelDelta, Math.abs(a.data[i + c] - b.data[i + c]));
      }
      if (pixelDelta > 0) {
        diffCount += 1;
        maxDelta = Math.max(maxDelta, pixelDelta);
        sumDelta += pixelDelta;
        out.data[i] = 255;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = 255;
      } else {
        // Faded oracle render as context under the red overlay.
        out.data[i] = 192 + (a.data[i] >> 2);
        out.data[i + 1] = 192 + (a.data[i + 1] >> 2);
        out.data[i + 2] = 192 + (a.data[i + 2] >> 2);
        out.data[i + 3] = 255;
      }
    }
    if (diffCount > 0) {
      writeFileSync(path.join(diffDir, `${name}.png`), PNG.sync.write(out));
    }
    results.push({
      name,
      diffCount,
      total,
      ratio: diffCount / total,
      maxDelta,
      meanDelta: diffCount === 0 ? 0 : sumDelta / diffCount,
    });
  }
  results.sort((x, y) => (y.diffCount ?? Infinity) - (x.diffCount ?? Infinity));
  return results;
}

// ---- Budget gate: the residual floor is a contract, not a trend. ----
// Each lane's budgets file pins each fixture's allowed diff-pixel count
// and channel delta (current floor plus modest headroom). A fixture over
// budget, an errored fixture, or a fixture with no budget at all fails
// the run, so pen drift and un-budgeted coverage both surface here
// instead of in a real book.
function laneViolations(lane, results) {
  const budgetsPath = path.join(HERE, lane.budgets);
  const budgets = existsSync(budgetsPath) ? JSON.parse(readFileSync(budgetsPath, 'utf8')) : {};
  const violations = [];
  for (const r of results) {
    if (r.error) {
      violations.push(`${lane.label} ${r.name}: ${r.error}`);
      continue;
    }
    const budget = budgets[r.name];
    if (!budget) {
      violations.push(
        `${lane.label} ${r.name}: no budget in ${lane.budgets} (add one consciously)`,
      );
      continue;
    }
    if (r.diffCount > budget.maxDiffPx) {
      violations.push(
        `${lane.label} ${r.name}: ${r.diffCount} diff px exceeds budget ${budget.maxDiffPx}`,
      );
    }
    if (r.maxDelta > budget.maxDelta) {
      violations.push(
        `${lane.label} ${r.name}: max delta ${r.maxDelta} exceeds budget ${budget.maxDelta}`,
      );
    }
  }
  return violations;
}

const lines = ['# paint-parity diff report', '', `- corpus: ${names.length} fixtures`];
lines.push('- oracle: browser/ (the browser pen on semantic commands)');
lines.push('- generated by tools/paint-parity/diff.mjs', '');
const violations = [];
for (const lane of LANES) {
  const results = diffLane(lane);
  if (results === undefined) {
    lines.push(`## ${lane.label}`, '', '_no renders; lane skipped_', '');
    continue;
  }
  lines.push(
    `## ${lane.label}`,
    '',
    '| fixture | diff px | ratio | max Δ | mean Δ |',
    '|---|---|---|---|---|',
  );
  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.name} | ERROR: ${r.error} | | | |`);
    } else {
      lines.push(
        `| ${r.name} | ${r.diffCount}/${r.total} | ${(r.ratio * 100).toFixed(3)}% | ${r.maxDelta} | ${r.meanDelta.toFixed(1)} |`,
      );
    }
  }
  lines.push('');
  violations.push(...laneViolations(lane, results));
}
writeFileSync(path.join(outRoot, 'report.md'), lines.join('\n'));
console.log(lines.join('\n'));

if (violations.length > 0) {
  console.error('\npaint-parity budget violations:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log('\nbudget gate: every lane within its budgets');
