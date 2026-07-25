// Joins the engine's box dump with Chromium ground truth by element id
// and reports per-cluster geometry agreement. This is the quantitative
// benchmark for layout algorithms: a capability cluster is "certified"
// only while its agreement holds; regressions fail the run (exit 1).
//
// Usage: node tools/conformance/compare.mjs <outDir>
//   <outDir> is generate.mjs's output dir (cases.epub + truth.json);
//   the engine dump is produced here by running the native probe.

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const [, , outDirArg] = process.argv;
const outDir = outDirArg ?? '/tmp/rito-conformance';
const TOLERANCE_PX = 0.5;
// Thresholds a certified cluster must hold. Uncertified clusters report
// numbers without failing the run — they are the work queue.
const CERTIFIED = {
  // Certified 2026-07-24 at 100.0% / max 0.2px (host-injected normal
  // line metrics). Regressing below this fails the run.
  'vertical-rhythm': { minRate: 0.99, maxDelta: 0.5 },
  // Certified 2026-07-25 at 100.0% / max 0.0px (line-box exclusion,
  // float escape out of non-root containers, and inward stacking).
  floats: { minRate: 0.99, maxDelta: 0.5 },
};

const { cases, truth, hostMetrics } = JSON.parse(
  readFileSync(path.join(outDir, 'truth.json'), 'utf8'),
);

execSync('cargo build --release --example layout_conformance_probe -p rito-core', {
  cwd: REPO,
  stdio: ['ignore', 'ignore', 'inherit'],
});
const request = JSON.stringify({
  epubPath: path.join(outDir, 'cases.epub'),
  serifFontPath: path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf'),
  serifLanguage: 'zh',
  contentWidth: 500,
  hostLineMetrics: hostMetrics ?? [],
});
const probeOut = execFileSync(
  path.join(REPO, 'target/release/examples/layout_conformance_probe'),
  [],
  { input: request, maxBuffer: 256 * 1024 * 1024 },
);
const engineChapters = JSON.parse(probeOut.toString());
const engineByCase = new Map(engineChapters.map((c) => [c.idref.replace(/\.xhtml$/, ''), c]));

const clusters = {};
const offenders = [];
for (const c of cases) {
  const cluster = (clusters[c.cluster] ??= {
    boxes: 0,
    matched: 0,
    within: 0,
    missing: 0,
    maxDelta: 0,
    degraded: 0,
    errors: 0,
  });
  const engine = engineByCase.get(c.name);
  const truthBoxes = truth[c.name];
  if (!engine || engine.error) {
    cluster.errors += 1;
    offenders.push({ case: c.name, cluster: c.cluster, problem: engine?.error ?? 'no dump' });
    continue;
  }
  if (engine.degradations.length > 0) {
    cluster.degraded += 1;
    offenders.push({
      case: c.name,
      cluster: c.cluster,
      problem: `degraded: ${engine.degradations.join('; ')}`,
    });
  }
  const engineBoxes = new Map(engine.boxes.map((b) => [b.id, b]));
  for (const [boxId, ref] of Object.entries(truthBoxes)) {
    cluster.boxes += 1;
    const mine = engineBoxes.get(boxId);
    if (!mine) {
      cluster.missing += 1;
      offenders.push({
        case: c.name,
        cluster: c.cluster,
        problem: `missing box #${boxId} <${ref.tag}>`,
      });
      continue;
    }
    cluster.matched += 1;
    const deltas = {
      x: Math.abs(mine.x - ref.x),
      y: Math.abs(mine.y - ref.y),
      width: Math.abs(mine.width - ref.width),
      height: Math.abs(mine.height - ref.height),
    };
    const worstAxis = Object.entries(deltas).sort((a, b) => b[1] - a[1])[0];
    cluster.maxDelta = Math.max(cluster.maxDelta, worstAxis[1]);
    if (worstAxis[1] <= TOLERANCE_PX) {
      cluster.within += 1;
    } else {
      offenders.push({
        case: c.name,
        cluster: c.cluster,
        problem: `#${boxId} <${ref.tag}> ${worstAxis[0]} off by ${worstAxis[1].toFixed(1)}px (engine ${mine[worstAxis[0]].toFixed(1)} vs chromium ${ref[worstAxis[0]].toFixed(1)})`,
        delta: worstAxis[1],
      });
    }
  }
}

const lines = ['# Geometry conformance report', ''];
let failed = false;
for (const [name, s] of Object.entries(clusters)) {
  const rate = s.boxes > 0 ? s.within / s.boxes : 0;
  const certified = CERTIFIED[name];
  if (certified && (rate < certified.minRate || s.maxDelta > certified.maxDelta)) failed = true;
  lines.push(
    `- ${name}${certified ? ' [certified]' : ''}: ${(rate * 100).toFixed(1)}% within ${TOLERANCE_PX}px ` +
      `(${s.within}/${s.boxes} boxes, ${s.missing} missing, max delta ${s.maxDelta.toFixed(1)}px, ` +
      `${s.degraded} degraded cases, ${s.errors} errored cases)`,
  );
}
lines.push('', '## Worst offenders', '');
offenders.sort((a, b) => (b.delta ?? Infinity) - (a.delta ?? Infinity));
for (const o of offenders.slice(0, 40)) {
  lines.push(`- [${o.cluster}] ${o.case}: ${o.problem}`);
}
writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
writeFileSync(
  path.join(outDir, 'report.json'),
  JSON.stringify({ clusters, offenders: offenders.slice(0, 500) }, null, 1),
);
console.log(lines.slice(0, 60).join('\n'));
if (failed) {
  console.error('\ncertified cluster regressed');
  process.exit(1);
}
