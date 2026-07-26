// Joins the engine's box dump with Chromium ground truth by element id
// and reports per-cluster geometry agreement. This is the quantitative
// benchmark for layout algorithms: a capability cluster is "certified"
// only while its agreement holds; regressions fail the run (exit 1).
//
// Usage: node tools/conformance/compare.mjs <outDir>
//   <outDir> is generate.mjs's output dir (cases.epub + truth.json);
//   the engine dump is produced here by running the native probe.

import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');
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
  // Certified 2026-07-25 at 100.0% / max 0.0px (CSS sizing plus the
  // strut space an atomic inline reserves below the baseline).
  images: { minRate: 0.99, maxDelta: 0.5 },
  // Certified 2026-07-25 at 100.0% / max 0.0px (CSS tables width
  // distribution: both percentage constraints, then the four guesses).
  'table-percent': { minRate: 0.99, maxDelta: 0.5 },
  // Certified 2026-07-26 at 100.0% / max 0.0px (conditional line-end
  // closer trim per Blink ShapeLine, incl. the curly-quote classes).
  'line-end-trim': { minRate: 0.99, maxDelta: 0.5 },
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
// Host metrics are demand-driven, exactly as the browser binding drives
// them: run the engine, measure whatever (family, size) pairs it asked for
// and could not find, inject, run again. A fixed list of sizes would leave
// derived sizes (`font-size: 0.7em` inside a smaller table) measured by
// nothing, and the engine would silently fall back to shaped metrics.
let metrics = hostMetrics ?? [];
let engineChapters;
for (let round = 0; ; round += 1) {
  const probe = runProbe(metrics);
  engineChapters = JSON.parse(probe.stdout.toString());
  const unmet = parseUnmetMetrics(probe.stderr.toString());
  if (unmet.length === 0 || round >= 3) break;
  metrics = [...metrics, ...(await measureHostMetrics(unmet))];
}
// The metrics this run converged on, so a failing case can be re-run
// against exactly the numbers the comparison used.
writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 1));

function runProbe(hostLineMetrics) {
  const input = JSON.stringify({ ...JSON.parse(request), hostLineMetrics });
  return spawnSync(path.join(REPO, 'target/release/examples/layout_conformance_probe'), [], {
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
}

function parseUnmetMetrics(stderr) {
  const match = /unmet host line metrics: (\[.*\])/.exec(stderr);
  if (!match) return [];
  return JSON.parse(match[1]).map(([family, size, sample]) => ({ family, size, sample }));
}

async function measureHostMetrics(pairs) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
  await page.goto(`file://${path.join(outDir, 'build/OEBPS/Text', `${cases[0].name}.xhtml`)}`);
  await page.evaluate(() => document.fonts.ready);
  // Faces the document has not painted yet are `unloaded`; measuring one
  // without loading it first silently returns fallback metrics.
  await page.evaluate(
    (requests) =>
      Promise.all(
        requests.map((request) =>
          document.fonts
            .load(
              `${request.size}px "${request.family.split(',')[0].trim()}"`,
              request.sample || 'x',
            )
            .catch(() => undefined),
        ),
      ),
    pairs,
  );
  const measured = await page.evaluate((requests) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Empty sample: the inline box's own strut. One character: whichever
    // font the host resolves for it, which is what sizes a run the
    // declared family cannot serve.
    return requests.map(({ family, size, sample }) => {
      const p = document.createElement('p');
      p.setAttribute(
        'style',
        `margin:0;line-height:normal;white-space:pre;` +
          `font-family:"${family}";font-size:${size}px;`,
      );
      p.textContent = sample ?? '';
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:0;height:0';
      p.appendChild(marker);
      host.appendChild(p);
      const box = p.getBoundingClientRect();
      return {
        family,
        size,
        sample: sample ?? '',
        height: box.height,
        baseline: marker.getBoundingClientRect().top - box.top,
      };
    });
  }, pairs);
  await browser.close();
  return measured;
}
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
