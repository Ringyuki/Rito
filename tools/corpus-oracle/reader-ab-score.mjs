// Scores a reader-ab-walk capture pair without any mid-book realignment.
//
// Two first-class signals, kept separate so neither can mask the other:
//   1. Pagination integrity — spread totals and per-chapter spread counts
//      (fragment vs retained). Drift is reported, never corrected away.
//   2. Page fidelity — within each chapter, the n-th fragment spread is
//      paired with the n-th retained spread and pixel-diffed. The score
//      is diff pixels over the union of inked pixels on either side, so
//      blank paper cannot dilute a wrecked title block.
//
// Every pair above the gallery threshold gets a side-by-side composite
// PNG under <outDir>/gallery/, ranked report in <outDir>/report.md.
// Numbers from this tool are only quotable together with a human (or
// model) pass over that gallery — that rule is the point of this tool.
//
// Usage: node reader-ab-score.mjs <walkOutDir>

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const [, , walkDir] = process.argv;
if (!walkDir) {
  console.error('usage: node reader-ab-score.mjs <walkOutDir>');
  process.exit(1);
}
const GALLERY_THRESHOLD = 0.02;
const CHANNEL_TOLERANCE = 24;
const INK_TOLERANCE = 16; // distance from the page ground color that counts as ink

const fragment = JSON.parse(readFileSync(path.join(walkDir, 'fragment', 'walk.json'), 'utf8'));
const retained = JSON.parse(readFileSync(path.join(walkDir, 'retained', 'walk.json'), 'utf8'));

function chapterRuns(meta) {
  const runs = [];
  for (const spread of meta.spreads) {
    const last = runs[runs.length - 1];
    if (last && last.chapterHref === spread.chapterHref) last.spreads.push(spread);
    else runs.push({ chapterHref: spread.chapterHref, spreads: [spread] });
  }
  return runs;
}

// Pair chapter runs in document order. Chapter attribution comes from the
// shell and can disagree across modes when a mode mispaginates, so pair
// runs by href sequence, tolerating runs present in only one mode.
function pairRuns(a, b) {
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].chapterHref === b[j].chapterHref) {
      pairs.push({ a: a[i], b: b[j] });
      i += 1;
      j += 1;
      continue;
    }
    const aNext = b.findIndex((run, k) => k > j && run.chapterHref === a[i].chapterHref);
    const bNext = a.findIndex((run, k) => k > i && run.chapterHref === b[j].chapterHref);
    if (aNext === -1 && bNext === -1) {
      pairs.push({ a: a[i], b: null });
      pairs.push({ a: null, b: b[j] });
      i += 1;
      j += 1;
    } else if (bNext !== -1 && (aNext === -1 || bNext - i <= aNext - j)) {
      while (i < bNext) pairs.push({ a: a[i++], b: null });
    } else {
      while (j < aNext) pairs.push({ a: null, b: b[j++] });
    }
  }
  while (i < a.length) pairs.push({ a: a[i++], b: null });
  while (j < b.length) pairs.push({ a: null, b: b[j++] });
  return pairs;
}

const runPairs = pairRuns(chapterRuns(fragment), chapterRuns(retained));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
mkdirSync(path.join(walkDir, 'gallery'), { recursive: true });

async function diffPair(fileA, fileB, compositePath) {
  const toDataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  return page
    .evaluate(
      async ({ srcA, srcB, channelTolerance, inkTolerance }) => {
        const load = (src) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
          });
        const [imgA, imgB] = await Promise.all([load(srcA), load(srcB)]);
        const width = Math.min(imgA.width, imgB.width);
        const height = Math.min(imgA.height, imgB.height);
        const read = (img) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, width, height).data;
        };
        const dataA = read(imgA);
        const dataB = read(imgB);
        // Ground color: the most common pixel of the retained side's corners.
        const corner = (data, x, y) => {
          const k = (y * width + x) * 4;
          return [data[k], data[k + 1], data[k + 2]];
        };
        const ground = corner(dataB, 1, 1);
        let inked = 0;
        let diff = 0;
        const isInk = (data, k) =>
          Math.abs(data[k] - ground[0]) > inkTolerance ||
          Math.abs(data[k + 1] - ground[1]) > inkTolerance ||
          Math.abs(data[k + 2] - ground[2]) > inkTolerance;
        for (let k = 0; k < width * height * 4; k += 4) {
          const inkEither = isInk(dataA, k) || isInk(dataB, k);
          if (inkEither) inked += 1;
          if (
            Math.abs(dataA[k] - dataB[k]) > channelTolerance ||
            Math.abs(dataA[k + 1] - dataB[k + 1]) > channelTolerance ||
            Math.abs(dataA[k + 2] - dataB[k + 2]) > channelTolerance
          ) {
            diff += 1;
          }
        }
        // Side-by-side composite for the gallery.
        const composite = document.createElement('canvas');
        composite.width = width * 2 + 8;
        composite.height = height;
        const cctx = composite.getContext('2d');
        cctx.fillStyle = '#ff00ff';
        cctx.fillRect(0, 0, composite.width, composite.height);
        cctx.drawImage(imgA, 0, 0);
        cctx.drawImage(imgB, width + 8, 0);
        return {
          inked,
          diff,
          score: inked > 0 ? diff / inked : 0,
          composite: composite.toDataURL('image/png'),
        };
      },
      {
        srcA: toDataUrl(fileA),
        srcB: toDataUrl(fileB),
        channelTolerance: CHANNEL_TOLERANCE,
        inkTolerance: INK_TOLERANCE,
      },
    )
    .then((result) => {
      if (compositePath && result.score >= GALLERY_THRESHOLD) {
        writeFileSync(compositePath, Buffer.from(result.composite.split(',')[1], 'base64'));
        return { ...result, compositeWritten: true };
      }
      return { ...result, compositeWritten: false };
    });
}

const chapterReport = [];
const pageScores = [];
for (const pair of runPairs) {
  const href = pair.a?.chapterHref ?? pair.b?.chapterHref ?? '';
  const countA = pair.a?.spreads.length ?? 0;
  const countB = pair.b?.spreads.length ?? 0;
  chapterReport.push({ chapterHref: href, fragmentSpreads: countA, retainedSpreads: countB });
  if (!pair.a || !pair.b) continue;
  const n = Math.min(countA, countB);
  for (let k = 0; k < n; k += 1) {
    const a = pair.a.spreads[k];
    const b = pair.b.spreads[k];
    const name = `p${String(a.index).padStart(3, '0')}-vs-${String(b.index).padStart(3, '0')}.png`;
    const result = await diffPair(
      path.join(walkDir, 'fragment', a.file),
      path.join(walkDir, 'retained', b.file),
      path.join(walkDir, 'gallery', name),
    );
    pageScores.push({
      chapterHref: href,
      chapterPage: k,
      fragmentSpread: a.index,
      retainedSpread: b.index,
      score: result.score,
      inked: result.inked,
      gallery: result.compositeWritten ? `gallery/${name}` : null,
    });
  }
}
await browser.close();

pageScores.sort((a, b) => b.score - a.score);
const driftChapters = chapterReport.filter((c) => c.fragmentSpreads !== c.retainedSpreads);
const clean = pageScores.filter((p) => p.score < GALLERY_THRESHOLD).length;

const lines = [];
lines.push(`# Reader A/B walk report`);
lines.push('');
lines.push(`Book: ${fragment.book}`);
lines.push(
  `Spread totals: fragment ${fragment.walked} (attr ${fragment.totalSpreadsAttr}), retained ${retained.walked} (attr ${retained.totalSpreadsAttr})`,
);
lines.push(`Scored pairs: ${pageScores.length}; clean (<${GALLERY_THRESHOLD}): ${clean}`);
lines.push('');
lines.push(`## Pagination drift (chapters whose spread counts differ)`);
lines.push('');
if (driftChapters.length === 0) lines.push('None.');
for (const c of driftChapters) {
  lines.push(
    `- ${c.chapterHref || '(unattributed)'}: fragment ${c.fragmentSpreads} vs retained ${c.retainedSpreads}`,
  );
}
lines.push('');
lines.push(`## Worst pages (inked-area-weighted diff)`);
lines.push('');
for (const p of pageScores.slice(0, 25)) {
  lines.push(
    `- ${(p.score * 100).toFixed(1)}% — ${p.chapterHref} page ${p.chapterPage} (fragment s${p.fragmentSpread} / retained s${p.retainedSpread})${p.gallery ? ` → ${p.gallery}` : ''}`,
  );
}
lines.push('');
writeFileSync(path.join(walkDir, 'report.md'), lines.join('\n'));
writeFileSync(
  path.join(walkDir, 'report.json'),
  JSON.stringify({ chapterReport, pageScores }, null, 2),
);
console.log(lines.slice(0, 40).join('\n'));
