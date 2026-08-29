// Full-book pixel oracle: every page of every chapter, engine canvas vs
// Chromium laying out the same chapter HTML untouched.
//
// Controlled variables — set identically on both sides: page geometry
// (600x750 page, 50px margin, 500px column, 100px gap), the pinned font
// mapping, and the reader's declared UA image policy (an image never
// exceeds one page — the engine states it, so the baseline must too, or
// the sides would run under different UA stylesheets). The book's own CSS
// is never amended. Chromium's multicol fragmentation is the pagination
// baseline.
//
// Two first-class signals, never allowed to mask each other:
//   1. Pagination drift: per-chapter page counts, engine vs Chromium.
//      Pages are paired k-th to k-th within a chapter; no realignment.
//   2. Page fidelity: mismatched pixels over the union of inked pixels
//      (distance from the page ground color), so blank paper cannot
//      dilute a wrecked block. Pairs above threshold get a side-by-side
//      composite in <outdir>/gallery/ — numbers are quotable only after
//      that gallery has been eyeballed.
//
//   node tools/corpus-oracle/pixel-ab-full.mjs <manifest.json> <book-substring> [outdir]
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');

const [manifestPath, bookKey, outDir = '/tmp/rito-pixel-ab-full'] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const book = manifest.find((b) => b.epub.includes(bookKey));
if (!book) throw new Error('book not in manifest');
mkdirSync(outDir, { recursive: true });
mkdirSync(`${outDir}/gallery`, { recursive: true });
const serifB64 = readFileSync(
  `${REPO}apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf`,
).toString('base64');
const tinosB64 = readFileSync(`${REPO}apps/reader/src/assets/fonts/Tinos-Regular.ttf`).toString(
  'base64',
);

const PAGE_STRIDE = 600; // column 500 + gap 100
const GALLERY_THRESHOLD = 0.04;
const MAX_PAGES_PER_CHAPTER = 80;

const browser = await chromium.launch();
const engine = await browser.newPage({ viewport: { width: 1400, height: 980 } });
// Reader warnings are part of the measurement: a silently failed metric
// sync or reflow invalidates the run's numbers.
engine.on('console', (message) => {
  if (message.type() === 'warning' || message.type() === 'error') {
    console.log(`[page-${message.type()}] ${message.text().slice(0, 200)}`);
  }
});
engine.on('pageerror', (error) => {
  console.log(`[pageerror] ${String(error).slice(0, 200)}`);
});
await engine.goto('http://localhost:5199/compare.html');
await engine.waitForSelector('#file');
await engine.evaluate(() => {
  document.getElementById('sync').checked = false;
});
await engine.setInputFiles('#file', book.epub);
await engine.waitForFunction(() => !document.getElementById('stage').hidden, null, {
  timeout: 180000,
});
// Pagination settles in waves: the fragment completion runs in the
// background and host line-metric injection forces one more reflow.
// Read the chapter map only after the page count holds still.
let stablePages = -1;
for (let settle = 0; settle < 40; settle += 1) {
  await engine.waitForTimeout(1500);
  const now = await engine.evaluate(
    () => globalThis.__ritoReader.pageCount ?? globalThis.__ritoReader.spreadCount ?? -1,
  );
  if (now === stablePages && now > 0) break;
  stablePages = now;
}
const { chapters: chapterSpreads, totalPages } = await engine.evaluate(() => {
  const reader = globalThis.__ritoReader;
  const map = reader.chapterMap;
  const entries =
    typeof map?.entries === 'function' ? [...map.entries()] : Object.entries(map ?? {});
  return {
    chapters: entries.map(([idref, info]) => ({
      idref: String(idref),
      info: JSON.parse(JSON.stringify(info)),
    })),
    totalPages: reader.pageCount ?? reader.spreadCount ?? null,
  };
});

// Engine page ranges per chapter, in reading order.
const ordered = chapterSpreads
  .map(({ idref, info }) => ({ idref, start: info.startPage ?? info.start ?? null }))
  .filter((c) => c.start !== null)
  .sort((a, b) => a.start - b.start);
for (let i = 0; i < ordered.length; i += 1) {
  const next = ordered[i + 1];
  ordered[i].count = (next ? next.start : (totalPages ?? ordered[i].start + 1)) - ordered[i].start;
}

const oracle = await browser.newPage({
  viewport: { width: 600, height: 750 },
  deviceScaleFactor: 1,
});
const differ = await browser.newPage({ viewport: { width: 100, height: 100 } });

async function captureEnginePage(page) {
  const spread = await engine.evaluate((p) => globalThis.__ritoReader.findSpread(p), page);
  let confirmed = false;
  for (let attempt = 0; attempt < 30 && !confirmed; attempt += 1) {
    await engine.evaluate((t) => globalThis.__ritoReader.renderSpread(t, 1), spread);
    confirmed = await engine
      .waitForFunction((t) => globalThis.__ritoLastFrame?.spreadIndex === t, spread, {
        timeout: 1000,
      })
      .then(() => true)
      .catch(() => false);
  }
  if (!confirmed) return null;
  await engine.waitForTimeout(350);
  // Read the canvas bitmap itself. Screenshotting the page region instead
  // would sample through layout and compositing: the canvas sits at a
  // fractional page offset, and the clip rounds it into a whole-pixel
  // shift that reads as a total glyph mismatch. The bitmap is exact.
  const dataUrl = await engine.evaluate(() =>
    document.getElementById('left-canvas').toDataURL('image/png'),
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function openChapterInOracle(chapterFile) {
  await oracle.goto(`file://${chapterFile}`, { timeout: 20000 }).catch(() => null);
  await oracle.evaluate(
    ({ serif, tinos }) => {
      const reset = document.createElement('style');
      reset.textContent = [
        'html { width: 500px; height: 650px; padding: 50px; margin: 0;',
        '  overflow: hidden; box-sizing: content-box; }',
        'body { margin: 0; height: 650px; column-width: 500px;',
        '  column-gap: 100px; column-fill: auto; }',
        // The reader UA policy the engine declares, applied to the
        // baseline too: an image never exceeds one page. Without it the
        // two sides would be compared under different UA stylesheets.
        'img { max-width: 100%; max-height: 650px; }',
        'img { object-fit: contain; }',
      ].join('\n');
      document.head.prepend(reset);
      const declared = new Set();
      for (const face of document.fonts)
        declared.add(face.family.replace(/^"|"$/g, '').toLowerCase());
      const familyFaces = (name) => `
      @font-face { font-family: "${name}"; src: url(data:font/otf;base64,${serif}); }
      @font-face { font-family: "${name}"; src: url(data:font/ttf;base64,${tinos}); unicode-range: U+0000-2FFF; }`;
      const sheet = [familyFaces('__rp-generic')];
      const seen = new Set();
      for (const el of document.querySelectorAll('*')) {
        const stack = getComputedStyle(el).fontFamily;
        const rewritten = stack.split(',').map((part) => {
          const name = part.trim().replace(/^"|"$/g, '');
          const lower = name.toLowerCase();
          if (
            ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'].includes(lower)
          )
            return '"__rp-generic"';
          if (!declared.has(lower) && !seen.has(lower)) {
            seen.add(lower);
            sheet.push(familyFaces(name));
          }
          return `"${name}"`;
        });
        rewritten.push('"__rp-generic"');
        el.style.fontFamily = rewritten.join(', ');
      }
      const style = document.createElement('style');
      style.textContent = sheet.join('\n');
      document.head.appendChild(style);
    },
    { serif: serifB64, tinos: tinosB64 },
  );
  await oracle.evaluate(() => document.fonts.ready);
  await oracle.waitForTimeout(250);
  return oracle.evaluate(
    (stride) => Math.max(1, Math.ceil(document.body.scrollWidth / stride)),
    PAGE_STRIDE,
  );
}

async function captureOraclePage(k) {
  await oracle.evaluate((offset) => {
    document.body.style.transform = `translateX(${-offset}px)`;
  }, k * PAGE_STRIDE);
  await oracle.waitForTimeout(60);
  return oracle.screenshot();
}

async function scorePair(aPng, bPng) {
  return differ.evaluate(
    async ({ a, b }) => {
      const load = (data) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.src = `data:image/png;base64,${data}`;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const read = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const da = read(ia);
      const db = read(ib);
      const k0 = (1 * w + 1) * 4;
      const ground = [db[k0], db[k0 + 1], db[k0 + 2]];
      const isInk = (d, k) =>
        Math.abs(d[k] - ground[0]) > 16 ||
        Math.abs(d[k + 1] - ground[1]) > 16 ||
        Math.abs(d[k + 2] - ground[2]) > 16;
      let inked = 0;
      let bad = 0;
      for (let k = 0; k < w * h * 4; k += 4) {
        if (isInk(da, k) || isInk(db, k)) inked += 1;
        if (
          Math.abs(da[k] - db[k]) > 24 ||
          Math.abs(da[k + 1] - db[k + 1]) > 24 ||
          Math.abs(da[k + 2] - db[k + 2]) > 24
        )
          bad += 1;
      }
      // Composite for the gallery: engine left, Chromium right.
      const composite = document.createElement('canvas');
      composite.width = w * 2 + 8;
      composite.height = h;
      const cctx = composite.getContext('2d');
      cctx.fillStyle = '#ff00ff';
      cctx.fillRect(0, 0, composite.width, composite.height);
      cctx.drawImage(ia, 0, 0);
      cctx.drawImage(ib, w + 8, 0);
      return {
        inked,
        bad,
        score: inked > 0 ? bad / inked : 0,
        pageArea: bad / (w * h),
        composite: composite.toDataURL('image/png'),
      };
    },
    { a: aPng.toString('base64'), b: bPng.toString('base64') },
  );
}

const pageScores = [];
const chapterDrift = [];
for (const chapter of ordered) {
  const chapterEntry = book.chapters.find(([id]) => id === chapter.idref);
  if (!chapterEntry) continue;
  const oracleCount = await openChapterInOracle(chapterEntry[1]);
  chapterDrift.push({
    idref: chapter.idref,
    enginePages: chapter.count,
    chromiumPages: oracleCount,
  });
  const n = Math.min(chapter.count, oracleCount, MAX_PAGES_PER_CHAPTER);
  for (let k = 0; k < n; k += 1) {
    const aPng = await captureEnginePage(chapter.start + k);
    if (!aPng) {
      console.log(`  SKIP ${chapter.idref} page ${k}: engine frame unconfirmed`);
      continue;
    }
    const bPng = await captureOraclePage(k);
    const result = await scorePair(aPng, bPng);
    const tag = `${chapter.idref.replace(/[^\w.-]/g, '_')}-p${String(k).padStart(2, '0')}`;
    if (result.score >= GALLERY_THRESHOLD) {
      writeFileSync(
        `${outDir}/gallery/${tag}.png`,
        Buffer.from(result.composite.split(',')[1], 'base64'),
      );
    }
    pageScores.push({
      idref: chapter.idref,
      page: k,
      enginePage: chapter.start + k,
      score: Number((result.score * 100).toFixed(1)),
      pageArea: Number((result.pageArea * 100).toFixed(1)),
      inGallery: result.score >= GALLERY_THRESHOLD,
    });
    console.log(
      `${String(result.score * 100 >= 100 ? 100 : (result.score * 100).toFixed(1)).padStart(5)}%  ${chapter.idref} p${k}`,
    );
  }
}

pageScores.sort((a, b) => b.score - a.score);
const drifted = chapterDrift.filter((c) => c.enginePages !== c.chromiumPages);
const clean = pageScores.filter((p) => p.score * 1 < GALLERY_THRESHOLD * 100).length;
const lines = [];
lines.push(`# Full-book pixel report — ${book.epub.split('/').pop()}`);
lines.push('');
lines.push(
  `Pages scored: ${pageScores.length}; clean (<${GALLERY_THRESHOLD * 100}% ink-diff): ${clean}`,
);
lines.push('');
lines.push('## Pagination drift (engine vs Chromium multicol)');
lines.push('');
if (drifted.length === 0) lines.push('None.');
for (const c of drifted)
  lines.push(`- ${c.idref}: engine ${c.enginePages} pages vs Chromium ${c.chromiumPages}`);
lines.push('');
lines.push('## Worst pages (diff over inked-pixel union)');
lines.push('');
for (const p of pageScores.slice(0, 30))
  lines.push(
    `- ${p.score}% (page-area ${p.pageArea}%) — ${p.idref} p${p.page}${p.inGallery ? ` → gallery` : ''}`,
  );
writeFileSync(`${outDir}/report.md`, lines.join('\n'));
writeFileSync(`${outDir}/report.json`, JSON.stringify({ chapterDrift, pageScores }, null, 1));
console.log(lines.join('\n'));
await browser.close();
