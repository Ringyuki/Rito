// Pixel oracle: the engine's real canvas raster vs pinned-font Chromium,
// chapter first pages, per-page mismatched-pixel ratio. THE acceptance
// number — text metrics are attribution aids only.
//
//   node tools/corpus-oracle/pixel-ab.mjs <manifest.json> <book-substring> [outdir]
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const REPO = new URL('../..', import.meta.url).pathname;
const { chromium } = createRequire(`${REPO}package.json`)('@playwright/test');

const [manifestPath, bookKey, outDir = '/tmp/rito-pixel-ab'] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const book = manifest.find((b) => b.epub.includes(bookKey));
if (!book) throw new Error('book not in manifest');
mkdirSync(outDir, { recursive: true });
const serifB64 = readFileSync(
  `${REPO}apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf`,
).toString('base64');
const tinosB64 = readFileSync(`${REPO}apps/reader/src/assets/fonts/Tinos-Regular.ttf`).toString(
  'base64',
);

const browser = await chromium.launch();
// A side: the engine, rendered by the real demo pipeline.
const engine = await browser.newPage({ viewport: { width: 1400, height: 980 } });
await engine.goto('http://localhost:5199/compare.html');
await engine.waitForSelector('#file');
await engine.evaluate(() => {
  document.getElementById('sync').checked = false;
});
await engine.setInputFiles('#file', book.epub);
await engine.waitForFunction(() => !document.getElementById('stage').hidden, null, {
  timeout: 180000,
});
await engine.waitForTimeout(2500);
const chapterSpreads = await engine.evaluate(() => {
  const reader = globalThis.__ritoReader;
  const map = reader.chapterMap;
  const entries =
    typeof map?.entries === 'function' ? [...map.entries()] : Object.entries(map ?? {});
  return entries.map(([idref, info]) => ({
    idref: String(idref),
    info: JSON.parse(JSON.stringify(info)),
  }));
});
console.log('chapterMap sample:', JSON.stringify(chapterSpreads.slice(0, 2)));

// B side page.
const oracle = await browser.newPage({
  viewport: { width: 600, height: 750 },
  deviceScaleFactor: 1,
});
// Differ page.
const differ = await browser.newPage({ viewport: { width: 100, height: 100 } });

const results = [];
for (const { idref, info } of chapterSpreads) {
  const chapterEntry = book.chapters.find(([id]) => id === idref);
  if (!chapterEntry) continue;
  const startPage = info.startPage ?? info.start ?? info.firstPage ?? null;
  if (startPage === null) {
    console.log('no start page for', idref, JSON.stringify(info).slice(0, 120));
    continue;
  }
  const spread = await engine.evaluate(
    (page) => globalThis.__ritoReader.findSpread(page),
    startPage,
  );
  // Drive the render until this spread's frame is confirmed on the
  // canvas; a stale frame must never be diffed as this chapter.
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
  if (!confirmed) {
    console.log(`  SKIP ${idref}: frame for spread ${spread} never confirmed`);
    continue;
  }
  await engine.waitForTimeout(400);
  const box = await engine.locator('#left-canvas').boundingBox();
  const aPng = await engine.screenshot({ clip: box });

  await oracle.goto(`file://${chapterEntry[1]}`, { timeout: 20000 }).catch(() => null);
  await oracle.evaluate(
    ({ serif, tinos }) => {
      // Paginate the chapter the way a column reader does: the visible
      // viewport is page one. No synthetic image rules — the baseline is
      // the browser's own behavior with the book's CSS, clipping included.
      const reset = document.createElement('style');
      reset.textContent = [
        'html { width: 500px; height: 650px; padding: 50px; margin: 0;',
        '  overflow: hidden; box-sizing: content-box; }',
        'body { margin: 0; height: 650px; column-width: 500px;',
        '  column-gap: 100px; column-fill: auto; }',
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
  await oracle.waitForTimeout(300);
  const bPng = await oracle.screenshot();

  const pct = await differ.evaluate(
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
      const canvas = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const da = canvas(ia);
      const db = canvas(ib);
      let bad = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs(da[i] - db[i]) > 24 ||
          Math.abs(da[i + 1] - db[i + 1]) > 24 ||
          Math.abs(da[i + 2] - db[i + 2]) > 24
        )
          bad += 1;
      }
      return bad / (w * h);
    },
    { a: aPng.toString('base64'), b: bPng.toString('base64') },
  );
  results.push({ idref, spread, pct: Number((pct * 100).toFixed(1)) });
  writeFileSync(`${outDir}/${idref.replace(/[^\w.-]/g, '_')}-engine.png`, aPng);
  writeFileSync(`${outDir}/${idref.replace(/[^\w.-]/g, '_')}-browser.png`, bPng);
  console.log(`${String(results[results.length - 1].pct).padStart(5)}%  ${idref}`);
}
const avg = results.reduce((s, r) => s + r.pct, 0) / Math.max(results.length, 1);
console.log(
  `book pixel mismatch: avg ${avg.toFixed(1)}% over ${results.length} chapter first pages`,
);
writeFileSync(`${outDir}/report.json`, JSON.stringify(results, null, 1));
await browser.close();
