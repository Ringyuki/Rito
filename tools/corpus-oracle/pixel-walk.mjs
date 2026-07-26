// Page-by-page pixel differential: the NEW ENGINE (the real reader at
// RITO_READER_URL, fragment pipeline, embedded fonts live) against
// CHROMIUM laying the same chapter into columns of the engine's own
// content box. The acceptance metric is the COUNT of differing pixels per
// page — the target is zero (user-set gold standard, 2026-07-26); ratios
// are process metrics only.
//
// Pairing: the reader's own chapterMap names each chapter's page range;
// chapter page k pairs with truth column k. Page-count drift per chapter
// is reported first and never realigned away.
//
// The engine side is screenshot from the reader's canvas; the truth side
// renders the pristine (un-stamped) chapter file in Chromium with the
// book's own CSS and fonts, paginated by CSS multicol at the same content
// width and height, then sliced column by column onto the same page
// canvas at the same content origin.
//
// Usage: node tools/corpus-oracle/pixel-walk.mjs <book.epub> <outDir> [maxPages]
//   env RITO_READER_URL (default http://localhost:5173/)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const require2 = createRequire(`${REPO}package.json`);
const { chromium } = require2('@playwright/test');
const { PNG } = require2('pngjs');

const [, , bookPath, outDirArg, maxPagesArg] = process.argv;
if (!bookPath || !outDirArg) {
  console.error('usage: node pixel-walk.mjs <book.epub> <outDir> [maxPages]');
  process.exit(1);
}
const outDir = path.resolve(outDirArg);
const MAX_PAGES = Number(maxPagesArg ?? 400);
const BASE = process.env.RITO_READER_URL ?? 'http://localhost:5173/';
const VIEWPORT = { width: 1500, height: 950 };
const MARGIN = 50; // readerViewportMargin at this viewport
rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, 'gallery'), { recursive: true });
mkdirSync(path.join(outDir, 'engine'), { recursive: true });

// ---- Unpack the pristine book for the truth side ------------------------
const unpackDir = path.join(outDir, 'book');
mkdirSync(unpackDir, { recursive: true });
execFileSync('unzip', ['-o', '-q', bookPath, '-d', unpackDir]);
const container = readFileSync(path.join(unpackDir, 'META-INF/container.xml'), 'utf8');
const opfRel = /full-path="([^"]+)"/.exec(container)?.[1];
const opfPath = path.join(unpackDir, opfRel);
const opfDir = path.dirname(opfPath);
// The reader's chapterMap keys are manifest item IDS (idrefs), not paths;
// the OPF manifest maps them onto real hrefs (e.g. Text/Theatre08.xhtml).
const manifestHref = new Map();
for (const m of readFileSync(opfPath, 'utf8').matchAll(/<item\b[^>]*>/g)) {
  const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
  const href = /\bhref="([^"]+)"/.exec(m[0])?.[1];
  if (id && href) manifestHref.set(id, decodeURIComponent(href));
}

const browser = await chromium.launch();

// ---- Engine side: load the book, read the chapter map, walk and shoot --
const reader = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
await reader.goto(BASE);
// A dist rebuild right before the walk makes vite re-optimize deps and
// hard-reload the page once via HMR. If that reload lands after the book
// was loaded, the book state is dropped, the canvas leaves the DOM, and
// every screenshot times out. Let the reload storm finish first: proceed
// only after 2s with no navigation.
let lastNav = Date.now();
reader.on('load', () => {
  lastNav = Date.now();
});
await reader.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
while (Date.now() - lastNav < 2000) await reader.waitForTimeout(250);
await reader.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
await reader.setInputFiles('input[type=file]', path.resolve(bookPath));
await reader.waitForSelector('[data-testid=reader-shell][data-loaded=true]', {
  timeout: 300000,
});
await reader.waitForFunction(
  () => document.querySelector('[data-testid=reader-shell]')?.dataset.paginationComplete === 'true',
  { timeout: 300000 },
);
// Shell overlays (the engine badge) float over the canvas and would be
// captured into the element screenshot as phantom page diffs — the title
// page once measured 3102 diff pixels that were ALL badge.
await reader.addStyleTag({
  content: '[data-testid=engine-badge] { display: none !important; }',
});
await reader.waitForTimeout(1500);
const plan = await reader.evaluate(() => {
  const r = window.__ritoController.reader;
  const chapters = [...r.chapterMap.entries()].map(([href, range]) => ({ href, ...range }));
  chapters.sort((a, b) => a.startPage - b.startPage);
  const spreadOfPage = new Map();
  r.spreads.forEach((s, i) => {
    for (const side of ['left', 'right']) {
      const p = s[side]?.index;
      if (p !== undefined && p !== null) spreadOfPage.set(p, { spread: i, side });
    }
  });
  return {
    pageCount: r.pages.length,
    pageBounds: r.pages[0]?.bounds,
    chapters,
    pages: [...spreadOfPage.entries()].map(([page, at]) => ({ page, ...at })),
  };
});
const pageW = Math.round(plan.pageBounds.width);
const pageH = Math.round(plan.pageBounds.height);
const contentW = pageW - 2 * MARGIN;
const contentH = pageH - 2 * MARGIN;
console.log(
  `pages ${plan.pageCount}, page ${pageW}x${pageH}, content ${contentW}x${contentH}, chapters ${plan.chapters.length}`,
);
const pageAt = new Map(plan.pages.map((p) => [p.page, p]));

// Walk every spread once, screenshot the canvas, crop out both pages.
const canvas = reader.locator('[data-testid=reader-shell] canvas').first();
const enginePages = new Map();
const shootSpread = async (spreadIndex) => {
  // The first paint after a dist/wasm rebuild can stall while vite
  // re-optimizes; one long-timeout retry absorbs it.
  const shot = await canvas.screenshot({ timeout: 90000 }).catch(async () => {
    const loaded = await reader
      .locator('[data-testid=reader-shell]')
      .getAttribute('data-loaded')
      .catch(() => null);
    if (loaded !== 'true') {
      throw new Error(
        `book state lost before spread ${spreadIndex} (data-loaded=${loaded}); ` +
          'a vite dep re-optimize reload probably dropped it',
      );
    }
    return canvas.screenshot({ timeout: 90000 });
  });
  const png = PNG.sync.read(shot);
  const rightX = png.width - pageW;
  for (const side of ['left', 'right']) {
    const at = plan.pages.find((p) => p.spread === spreadIndex && p.side === side);
    if (!at || enginePages.has(at.page)) continue;
    const x0 = side === 'left' ? 0 : rightX;
    const out = new PNG({ width: pageW, height: pageH });
    for (let y = 0; y < pageH; y += 1) {
      for (let x = 0; x < pageW; x += 1) {
        const si = (y * png.width + (x0 + x)) * 4;
        const di = (y * pageW + x) * 4;
        for (let k = 0; k < 4; k += 1) out.data[di + k] = png.data[si + k];
      }
    }
    enginePages.set(at.page, out);
  }
};
const totalSpreads = Math.max(...plan.pages.map((p) => p.spread)) + 1;
for (let s = 0; s < totalSpreads; s += 1) {
  if (Math.min(...[...pageAt.keys()].filter((p) => !enginePages.has(p))) > MAX_PAGES) break;
  // A screenshot during the page-turn slide reads as a horizontal shift
  // of the whole page (image spreads settle latest — their frames land
  // after async decodes). Wait out the transition, then settle.
  await reader
    .waitForFunction(
      () => document.querySelector('[data-testid=reader-shell]')?.dataset.transitioning === 'false',
      { timeout: 15000 },
    )
    .catch(() => undefined);
  await reader.waitForTimeout(s === 0 ? 800 : 320);
  await shootSpread(s);
  if (s < totalSpreads - 1) {
    await reader.keyboard.press('ArrowRight');
  }
}
await reader.close();
console.log(`engine pages captured: ${enginePages.size}`);

// ---- Truth side: per chapter, multicol columns of the content box -------
const truthColumns = new Map(); // idref -> PNG[] (one per column)
const truth = await browser.newPage({
  viewport: { width: contentW + 200, height: contentH },
  deviceScaleFactor: 1,
});
for (const chapter of plan.chapters) {
  const href = manifestHref.get(chapter.href) ?? chapter.href;
  const file = path.join(opfDir, href);
  const expected = chapter.endPage - chapter.startPage + 1;
  try {
    await truth.goto(`file://${file}`, { timeout: 30000 });
    await truth.evaluate(
      async ({ contentW, contentH }) => {
        const s = document.createElement('style');
        // The multicol pagination baseline, plus the reader's image policy
        // mirrored exactly (rito-inline image_display_size): the clamp to
        // one page is UNCONDITIONAL in the engine — it applies after
        // author sizing — so it is !important here. It also cannot be the
        // author's own \`max-height: 100%\`, which in a continuous flow has
        // an indefinite basis and computes to none (CSS 2.1 §10.7); the
        // engine resolves that percentage against the page instead.
        // The container is EXACTLY one column wide: multicol stretches
        // its columns to fill the container, so a loose viewport-width
        // container would silently widen every column past the engine's
        // content width. Overflow columns grow to the right at the same
        // exact width (the paginated-reader idiom).
        s.textContent = `html { margin:0; padding:0; width:${contentW}px; height:${contentH}px; column-width:${contentW}px; column-gap:100px; column-fill:auto; }
body { margin:0; padding:0; }
img, svg { max-height: ${contentH}px !important; max-width: ${contentW}px !important; }`;
        document.head.insertBefore(s, document.head.firstChild);
        await document.fonts.ready;
      },
      { contentW, contentH },
    );
    await truth.waitForTimeout(250);
    // One screenshot per column, scrolled into view — no viewport-width
    // cap on chapter length.
    const columns = [];
    for (let k = 0; k <= expected + 1; k += 1) {
      const x0 = k * (contentW + 100);
      const docWidth = await truth.evaluate(() => document.documentElement.scrollWidth);
      if (x0 >= docWidth) break;
      await truth.evaluate((x) => window.scrollTo(x, 0), x0);
      const scrolled = await truth.evaluate(() => window.scrollX);
      const clipX = x0 - scrolled;
      if (clipX + contentW > contentW + 200) break;
      columns.push(
        PNG.sync.read(
          await truth.screenshot({
            clip: { x: clipX, y: 0, width: contentW, height: contentH },
          }),
        ),
      );
    }
    truthColumns.set(chapter.href, columns);
  } catch (error) {
    console.log(`[truth-error] ${chapter.href}: ${String(error).slice(0, 120)}`);
    truthColumns.set(chapter.href, []);
  }
}
await truth.close();
await browser.close();

// ---- Pair, count, rank --------------------------------------------------
const inked = (png, ground) => {
  let n = 0;
  for (let p = 0; p < png.width * png.height; p += 1) {
    const i = p * 4;
    if (
      Math.abs(png.data[i] - ground[0]) +
        Math.abs(png.data[i + 1] - ground[1]) +
        Math.abs(png.data[i + 2] - ground[2]) >
      30
    )
      n += 1;
  }
  return n;
};
const results = [];
for (const chapter of plan.chapters) {
  const columns = truthColumns.get(chapter.href) ?? [];
  const enginePageCount = chapter.endPage - chapter.startPage + 1;
  // A column that still has ink past the engine's page count is drift.
  const g = columns[0]
    ? [columns[0].data[0], columns[0].data[1], columns[0].data[2]]
    : [255, 255, 255];
  const truthUsed = columns.filter((c) => inked(c, g) > 0).length;
  for (let k = 0; k < enginePageCount; k += 1) {
    const pageIndex = chapter.startPage + k;
    if (pageIndex > MAX_PAGES) break;
    const engine = enginePages.get(pageIndex);
    const column = columns[k];
    if (!engine) continue;
    // Compose the truth page: the page ground sampled from the engine's
    // own corner (theme paper), the column at the content origin.
    const ground = [engine.data[0], engine.data[1], engine.data[2]];
    const truthPage = new PNG({ width: pageW, height: pageH });
    for (let p = 0; p < pageW * pageH; p += 1) {
      const i = p * 4;
      truthPage.data[i] = ground[0];
      truthPage.data[i + 1] = ground[1];
      truthPage.data[i + 2] = ground[2];
      truthPage.data[i + 3] = 255;
    }
    if (column) {
      for (let y = 0; y < contentH; y += 1) {
        for (let x = 0; x < contentW; x += 1) {
          const si = (y * contentW + x) * 4;
          const di = ((MARGIN + y) * pageW + (MARGIN + x)) * 4;
          for (let j = 0; j < 4; j += 1) truthPage.data[di + j] = column.data[si + j];
        }
      }
    }
    let diff = 0;
    for (let p = 0; p < pageW * pageH; p += 1) {
      const i = p * 4;
      if (
        engine.data[i] !== truthPage.data[i] ||
        engine.data[i + 1] !== truthPage.data[i + 1] ||
        engine.data[i + 2] !== truthPage.data[i + 2]
      )
        diff += 1;
    }
    results.push({
      chapter: chapter.href,
      pageInChapter: k,
      pageIndex,
      diff,
      drift: truthUsed - enginePageCount,
      engine,
      truthPage,
    });
  }
}
results.sort((a, b) => b.diff - a.diff);
const lines = [
  '# Pixel walk: new engine vs Chromium, per page',
  '',
  `book: ${path.basename(bookPath)}`,
  `gold standard: 0 diff pixels; page ${pageW}x${pageH}, content ${contentW}x${contentH}`,
  '',
  '## Chapter pagination drift (truth columns with ink − engine pages)',
  '',
];
const seen = new Set();
for (const r of results) {
  if (seen.has(r.chapter) || r.drift === 0) continue;
  seen.add(r.chapter);
  lines.push(`- ${r.chapter}: ${r.drift > 0 ? '+' : ''}${r.drift}`);
}
lines.push('', '## Pages, worst first (diff pixel count)', '');
const GALLERY = 12;
// The floor exemplars: the BEST nonzero pages show what pure rasterization
// noise looks like once geometry agrees — the data a tolerance ruling
// needs.
const bestNonzero = new Set(
  results
    .filter((r) => r.diff > 0)
    .slice(-4)
    .map((r) => r.pageIndex),
);
results.forEach((r, rank) => {
  lines.push(
    `- ${String(r.diff).padStart(8)} px — ${r.chapter} page ${r.pageInChapter} (book page ${r.pageIndex})`,
  );
  if ((rank < GALLERY || bestNonzero.has(r.pageIndex)) && r.diff > 0) {
    const sep = 4;
    const comp = new PNG({ width: pageW * 2 + sep, height: pageH });
    comp.data.fill(255);
    for (let y = 0; y < pageH; y += 1) {
      for (let x = 0; x < pageW; x += 1) {
        const si = (y * pageW + x) * 4;
        const di = (y * comp.width + x) * 4;
        for (let j = 0; j < 4; j += 1) comp.data[di + j] = r.engine.data[si + j];
        const di2 = (y * comp.width + pageW + sep + x) * 4;
        for (let j = 0; j < 4; j += 1) comp.data[di2 + j] = r.truthPage.data[si + j];
      }
      for (let x = pageW; x < pageW + sep; x += 1) {
        const di = (y * comp.width + x) * 4;
        comp.data[di] = 255;
        comp.data[di + 1] = 0;
        comp.data[di + 2] = 255;
        comp.data[di + 3] = 255;
      }
    }
    writeFileSync(
      path.join(outDir, 'gallery', `p${String(r.pageIndex).padStart(3, '0')}.png`),
      PNG.sync.write(comp),
    );
  }
});
const zero = results.filter((r) => r.diff === 0).length;
lines.splice(
  4,
  0,
  `pages compared: ${results.length}; at ZERO diff: ${zero}; worst: ${results[0]?.diff ?? 0} px`,
);
writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
console.log(lines.slice(0, 30).join('\n'));
console.log(`\nreport: ${path.join(outDir, 'report.md')}`);
