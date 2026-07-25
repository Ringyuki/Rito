// Real-book geometry conformance.
//
// The synthetic clusters certify capabilities in isolation; a book combines
// them, and a page can be visibly wrong while every cluster reads 100%. This
// turns any real EPUB into a conformance corpus: every element in every
// chapter gets an id, Chromium records its border box at the engine's flow
// width, the engine lays the same (stamped) book out continuously, and the
// two are joined element by element. What comes out is a per-chapter list of
// the boxes that disagree — the defect list, ranked, without anyone having to
// spot it on screen first.
//
// Usage: node tools/conformance/real-book.mjs <book.epub> [outDir] [flowWidth]

import { createRequire } from 'node:module';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');
const [, , bookArg, outDirArg, widthArg] = process.argv;
if (!bookArg) throw new Error('usage: real-book.mjs <book.epub> [outDir] [flowWidth]');
const outDir = outDirArg ?? '/tmp/rito-real-book';
const FLOW_WIDTH = Number(widthArg ?? 500);
const TOLERANCE_PX = 0.5;

rmSync(outDir, { recursive: true, force: true });
const buildDir = path.join(outDir, 'build');
mkdirSync(buildDir, { recursive: true });
execFileSync('unzip', ['-q', path.resolve(bookArg), '-d', buildDir]);
// The engine resolves every generic family to its pinned serif. The truth
// browser must do the same, or text the book leaves unstyled is measured in
// the browser's own default face — a different font with different metrics,
// which reads as a one-pixel layout defect on every line it touches.
const PINNED_SERIF = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');
copyFileSync(PINNED_SERIF, path.join(buildDir, '__rito_pinned_serif.otf'));

// ---- Spine order, straight from the OPF ---------------------------------

const container = readFileSync(path.join(buildDir, 'META-INF/container.xml'), 'utf8');
const opfHref = /full-path="([^"]+)"/.exec(container)?.[1];
if (!opfHref) throw new Error('container.xml has no rootfile');
const opfPath = path.join(buildDir, opfHref);
const opf = readFileSync(opfPath, 'utf8');
const manifest = new Map(
  [...opf.matchAll(/<item\b[^>]*>/g)].flatMap((match) => {
    const id = /\bid="([^"]+)"/.exec(match[0])?.[1];
    const href = /\bhref="([^"]+)"/.exec(match[0])?.[1];
    return id && href ? [[id, decodeURIComponent(href)]] : [];
  }),
);
const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/g)]
  .map((match) => manifest.get(match[1]))
  .filter((href) => href !== undefined && /\.x?html?$/i.test(href));

const opfDir = path.dirname(opfPath);
const chapters = spine.map((href) => ({ href, file: path.join(opfDir, href) }));

// ---- Stamp ids, then record Chromium truth on the stamped documents -----

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: FLOW_WIDTH + 100, height: 800 },
  deviceScaleFactor: 1,
});

const truth = {};
const metricRequests = new Map();
for (const chapter of chapters) {
  const pinnedSerif = path.relative(
    path.dirname(chapter.file),
    path.join(buildDir, '__rito_pinned_serif.otf'),
  );
  await page.goto(`file://${chapter.file}`, { timeout: 30000 }).catch(() => null);
  await page.evaluate(() => document.fonts.ready);
  // Serialize the stamped DOM back over the source so the engine parses
  // exactly the document Chromium measured. XMLSerializer keeps XHTML
  // well-formed; a regex pass over the markup would not.
  const stamped = await page.evaluate(() => {
    let next = 0;
    for (const element of document.querySelectorAll('*')) {
      if (element.id) continue;
      if (element.tagName === 'HTML' || element.tagName === 'HEAD') continue;
      element.id = `rc${next}`;
      next += 1;
    }
    return new XMLSerializer().serializeToString(document);
  });
  writeFileSync(chapter.file, stamped);
  // Reload so the recorded geometry comes from the stamped file itself,
  // not from a DOM that only exists in this tab.
  await page.goto(`file://${chapter.file}`, { timeout: 30000 }).catch(() => null);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    async ({ width, pinnedSerif }) => {
      const normalize = document.createElement('style');
      // The flow the engine lays out: one continuous column at the content
      // width. No page exists in this pass, so the reader's page-fit image
      // policy must not be injected here either — it is a pagination rule,
      // and the pixel oracle is what measures it. Injecting it on one side
      // only would report every full-page image as a 100px defect.
      normalize.textContent =
        `@font-face { font-family: "__rito_serif"; src: url("${pinnedSerif}"); }\n` +
        `html { margin: 0; padding: 0; width: ${width}px; font-family: "__rito_serif"; }\n` +
        `body { margin: 0; padding: 0; width: ${width}px; }`;
      document.head.appendChild(normalize);
      // The face has to be resolved before anything is measured: rects read
      // while it is still loading come from the browser's default font.
      await document.fonts.load('16px "__rito_serif"', '试');
      await document.fonts.ready;
      // Assert the face actually resolved. A 404'd pin silently leaves the
      // truth browser measuring its own default font, which is exactly how
      // a broken page once scored 100%.
      const pinned = [...document.fonts].find((face) => face.family === '__rito_serif');
      if (pinned?.status !== 'loaded') {
        throw new Error(`pinned serif did not load (status ${pinned?.status ?? 'absent'})`);
      }
    },
    { width: FLOW_WIDTH, pinnedSerif },
  );
  const recorded = await page.evaluate(() => {
    const boxes = {};
    const families = new Set();
    // Elements that generate no box at all: they would count as
    // "missing" forever and drag every rate down without naming a defect.
    const boxless = new Set(['HEAD', 'META', 'LINK', 'TITLE', 'STYLE', 'SCRIPT', 'BASE']);
    for (const element of document.querySelectorAll('[id]')) {
      if (boxless.has(element.tagName)) continue;
      const rect = element.getBoundingClientRect();
      boxes[element.id] = {
        tag: element.tagName.toLowerCase(),
        // Anchors for local geometry. Block advance is measured from the
        // previous sibling's bottom (or the parent's top for a first
        // child), so one early mistake is reported where it happens
        // instead of repainting every box below it as broken.
        parent: element.parentElement?.closest('[id]')?.id ?? null,
        prev: element.previousElementSibling?.id || null,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
      const style = getComputedStyle(element);
      families.add(`${style.fontFamily} ${style.fontSize}`);
    }
    return { boxes, families: [...families] };
  });
  truth[chapter.href] = recorded.boxes;
  for (const key of recorded.families) metricRequests.set(key, chapter.file);
}

// ---- Repack the stamped book -------------------------------------------

const stampedEpub = path.join(outDir, 'stamped.epub');
execFileSync('zip', ['-X', '-0', stampedEpub, 'mimetype'], { cwd: buildDir });
execFileSync('zip', ['-rq', stampedEpub, '.', '-x', 'mimetype'], { cwd: buildDir });

// ---- Engine side, with demand-driven host line metrics ------------------

execSync('cargo build --release --example layout_conformance_probe -p rito-core', {
  cwd: REPO,
  stdio: ['ignore', 'ignore', 'inherit'],
});

let metrics = [];
let engineChapters;
for (let round = 0; ; round += 1) {
  const probe = runProbe(metrics);
  const stdout = probe.stdout.toString();
  try {
    engineChapters = JSON.parse(stdout);
  } catch {
    throw new Error(`probe produced no dump:\n${probe.stderr.toString().slice(-2000)}`);
  }
  const unmet = parseUnmetMetrics(probe.stderr.toString());
  if (unmet.length === 0 || round >= 4) break;
  metrics = [...metrics, ...(await measureHostMetrics(unmet))];
}
// The metrics this run converged on, so a failing chapter can be re-run
// against exactly the numbers the comparison used.
writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 1));

function runProbe(hostLineMetrics) {
  const input = JSON.stringify({
    epubPath: stampedEpub,
    serifFontPath: path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf'),
    serifLanguage: 'zh',
    contentWidth: FLOW_WIDTH,
    hostLineMetrics,
  });
  return spawnSync(path.join(REPO, 'target/release/examples/layout_conformance_probe'), [], {
    input,
    maxBuffer: 512 * 1024 * 1024,
  });
}

function parseUnmetMetrics(stderr) {
  const seen = new Set();
  const pairs = [];
  for (const match of stderr.matchAll(/unmet host line metrics: (\[.*\])/g)) {
    for (const [family, size, sample] of JSON.parse(match[1])) {
      const key = `${family} ${size} ${sample}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ family, size, sample });
    }
  }
  return pairs;
}

// Measured inside a chapter of the book itself: the book's @font-face rules
// must be live, or every family would silently measure the fallback font.
async function measureHostMetrics(pairs) {
  await page.goto(`file://${chapters[0].file}`, { timeout: 30000 }).catch(() => null);
  await page.evaluate(() => document.fonts.ready);
  // The same pinned serif the geometry was recorded through: `familyList`
  // maps every generic family onto it, so the face has to exist here too or
  // every generic key silently measures the browser's default font.
  await page.evaluate(
    async (pinnedSerif) => {
      const face = document.createElement('style');
      face.textContent = `@font-face { font-family: "__rito_serif"; src: url("${pinnedSerif}"); }`;
      document.head.appendChild(face);
      await document.fonts.load('16px "__rito_serif"', '试');
      await document.fonts.ready;
      const pinned = [...document.fonts].find((entry) => entry.family === '__rito_serif');
      if (pinned?.status !== 'loaded') {
        throw new Error(
          `pinned serif did not load for measurement (${pinned?.status ?? 'absent'})`,
        );
      }
    },
    path.relative(path.dirname(chapters[0].file), path.join(buildDir, '__rito_pinned_serif.otf')),
  );
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
  return page.evaluate((requests) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1000px;visibility:hidden;';
    document.body.appendChild(host);
    const generic = new Set([
      'serif',
      'sans-serif',
      'monospace',
      'cursive',
      'fantasy',
      'system-ui',
    ]);
    const familyList = (key) =>
      key
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        // The engine serves every generic family from its pinned serif;
        // measuring `serif` against the browser's default face would hand
        // the engine one font's numbers for another font's glyphs.
        .map((name) => (generic.has(name) ? '"__rito_serif"' : `"${name.replaceAll('"', '\\"')}"`))
        .join(', ');
    const measured = requests.map(({ family, size, sample }) => {
      const p = document.createElement('p');
      p.setAttribute(
        'style',
        `margin:0;padding:0;border:0;line-height:normal;white-space:pre;` +
          `font-family:${familyList(family)};font-size:${size}px;`,
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
    host.remove();
    return measured;
  }, pairs);
}

await browser.close();

// ---- Join ---------------------------------------------------------------

// The engine sanitizes separators out of chapter ids (a space becomes an
// underscore), so join on a basename with every separator canonicalized
// rather than on the raw href.
const chapterKey = (href) =>
  path.basename(decodeURIComponent(href)).replaceAll(/[^A-Za-z0-9.-]/g, '_');
const engineByChapter = new Map(engineChapters.map((c) => [chapterKey(c.idref), c]));
const perChapter = [];
const offenders = [];
for (const chapter of chapters) {
  const engine = engineByChapter.get(chapterKey(chapter.href));
  const truthBoxes = truth[chapter.href] ?? {};
  const stats = { chapter: chapter.href, boxes: 0, matched: 0, within: 0, missing: 0, maxDelta: 0 };
  if (!engine || engine.error) {
    stats.error = engine?.error ?? 'no dump';
    perChapter.push(stats);
    continue;
  }
  const engineBoxes = new Map(engine.boxes.map((b) => [b.id, b]));
  for (const [id, ref] of Object.entries(truthBoxes)) {
    stats.boxes += 1;
    const mine = engineBoxes.get(id);
    if (!mine) {
      stats.missing += 1;
      continue;
    }
    stats.matched += 1;
    // Local geometry: horizontal offset from the containing box, vertical
    // advance from the previous sibling's bottom edge, plus the box's own
    // size. Absolute coordinates would report one early mistake once per
    // box below it; this reports it where it is introduced.
    const pairOf = (anchorId) => {
      if (!anchorId) return undefined;
      const t = truthBoxes[anchorId];
      const e = engineBoxes.get(anchorId);
      return t && e ? { truth: t, engine: e } : undefined;
    };
    const parent = pairOf(ref.parent);
    const previous = pairOf(ref.prev);
    const anchorY = previous ?? parent;
    const top = (box) => (previous ? box.y + box.height : box.y);
    const deltas = {
      x: Math.abs(
        mine.x - (parent ? parent.engine.x : 0) - (ref.x - (parent ? parent.truth.x : 0)),
      ),
      y: Math.abs(
        mine.y - (anchorY ? top(anchorY.engine) : 0) - (ref.y - (anchorY ? top(anchorY.truth) : 0)),
      ),
      width: Math.abs(mine.width - ref.width),
      height: Math.abs(mine.height - ref.height),
    };
    const [axis, delta] = Object.entries(deltas).sort((a, b) => b[1] - a[1])[0];
    stats.maxDelta = Math.max(stats.maxDelta, delta);
    if (delta <= TOLERANCE_PX) {
      stats.within += 1;
    } else {
      const local = (box, side) => {
        if (axis === 'x') return box.x - (parent ? parent[side].x : 0);
        if (axis === 'y') return box.y - (anchorY ? top(anchorY[side]) : 0);
        return box[axis];
      };
      offenders.push({
        chapter: chapter.href,
        id,
        tag: ref.tag,
        anchor: ref.prev ?? ref.parent,
        axis,
        delta,
        engine: local(mine, 'engine'),
        chromium: local(ref, 'truth'),
      });
    }
  }
  perChapter.push(stats);
}

perChapter.sort((a, b) => a.within / (a.matched || 1) - b.within / (b.matched || 1));
const lines = ['# Real-book geometry conformance', '', `book: ${path.basename(bookArg)}`, ''];
let totalBoxes = 0;
let totalWithin = 0;
for (const s of perChapter) {
  totalBoxes += s.matched;
  totalWithin += s.within;
  // Rate over boxes the engine actually produced: a box it never emitted is
  // a different defect (reported as `missing`) than one it placed wrongly.
  const rate = s.matched > 0 ? ((s.within / s.matched) * 100).toFixed(1) : 'n/a';
  lines.push(
    `- ${s.chapter}: ${rate}% (${s.within}/${s.matched}, ${s.missing} missing, ` +
      `max ${s.maxDelta.toFixed(1)}px)${s.error ? ` ERROR ${s.error}` : ''}`,
  );
}
lines.splice(
  3,
  0,
  `overall: ${totalBoxes > 0 ? ((totalWithin / totalBoxes) * 100).toFixed(1) : 'n/a'}% ` +
    `within ${TOLERANCE_PX}px (${totalWithin}/${totalBoxes} boxes)`,
  '',
);
offenders.sort((a, b) => b.delta - a.delta);
lines.push('', '## Worst boxes', '');
for (const o of offenders.slice(0, 60)) {
  lines.push(
    `- ${o.chapter} #${o.id} <${o.tag}> ${o.axis} off by ${o.delta.toFixed(1)}px ` +
      `(engine ${o.engine.toFixed(1)} vs chromium ${o.chromium.toFixed(1)})`,
  );
}
writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
writeFileSync(
  path.join(outDir, 'report.json'),
  JSON.stringify({ perChapter, offenders: offenders.slice(0, 2000) }, null, 1),
);
console.log(lines.join('\n'));
