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
//   env RITO_WALK_DSF   device pixels per CSS pixel on both sides (default 1)
//   env RITO_TRUTH_LOCALE / RITO_TRUTH_MIN_FONT_SIZE / RITO_TRUTH_CHROMIUM
//       A/B runs only: the truth's default locale / minimum font size /
//       another Chromium build to lay it out (see the truth context)
//   env RITO_WALK_SCROLLED=1  the scrolled reading mode: each chapter's
//       windows against Chromium's continuous layout (scroll-truth.mjs)
import { createRequire } from 'node:module';
import {
  captureLeftwardWindows,
  captureScrolledWindows,
  composeScrolledWindow,
} from './scroll-truth.mjs';
import { launchOracleChromium } from '../oracle-chromium.mjs';
import { collectImageAreas, imageMask } from './image-areas.mjs';
import { moveTruthRoot, shootContentWithBand } from './truth-shot.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const require2 = createRequire(`${REPO}package.json`);
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
// Device pixels per CSS pixel on both sides: the reader's canvas renders
// at this ratio (the engine receives it as the render ratio) and the
// truth browser rasters at the same deviceScaleFactor, so the two are
// compared on the device grid. Layout stays in CSS pixels; only the
// captured bitmaps and every index into them scale.
const DSF = Number(process.env.RITO_WALK_DSF ?? 1);
const SCROLLED = process.env.RITO_WALK_SCROLLED === '1';
if (!Number.isInteger(DSF) || DSF < 1) {
  console.error(`RITO_WALK_DSF must be a positive integer, got ${process.env.RITO_WALK_DSF}`);
  process.exit(1);
}
rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, 'gallery'), { recursive: true });
mkdirSync(path.join(outDir, 'engine'), { recursive: true });
mkdirSync(path.join(outDir, 'truth'), { recursive: true });

// ---- Unpack the pristine book for the truth side ------------------------
const unpackDir = path.join(outDir, 'book');
mkdirSync(unpackDir, { recursive: true });
// unzip exits 1 for warnings (an epub with junk bytes before the zip
// header still extracts); only a missing container afterwards is fatal.
// unzip also stops at an entry whose name is not UTF-8 (a GBK-named file
// the filesystem refuses), leaving every later entry unextracted; bsdtar
// transcodes such names and extracts the whole archive.
try {
  execFileSync('unzip', ['-o', '-q', bookPath, '-d', unpackDir]);
} catch (error) {
  if (!existsSync(path.join(unpackDir, 'META-INF/container.xml'))) {
    execFileSync('tar', ['-xf', bookPath, '-C', unpackDir]);
    if (!existsSync(path.join(unpackDir, 'META-INF/container.xml'))) throw error;
  }
}
const container = readFileSync(path.join(unpackDir, 'META-INF/container.xml'), 'utf8');
const opfRel = /full-path="([^"]+)"/.exec(container)?.[1];
const opfPath = path.join(unpackDir, opfRel);
const opfDir = path.dirname(opfPath);
// Book faces with a REAL url() source, scanned NODE-SIDE: a file:// page
// cannot read a linked stylesheet's cssRules (cross-origin under the
// default file origin policy — the in-page scan silently came up empty
// and the family rewrite dropped every named family, real embedded fonts
// included; a book set entirely in its own faces lost them all on the
// truth side while the reader used them, shifting whole pages).
const bookFaceFamilies = (() => {
  const families = new Set();
  const walkDir = (dir) => {
    for (const entry of require2('node:fs').readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
        continue;
      }
      if (!/\.(css|xhtml|html|htm)$/i.test(entry.name)) continue;
      const text = readFileSync(full, 'utf8');
      for (const block of text.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
        const body = block[1];
        if (!/url\(\s*["']?(?!res:)/i.test(body)) continue;
        const family = /font-family\s*:\s*["']?([^;"'}]+)/i.exec(body)?.[1]?.trim().toLowerCase();
        if (family && !family.startsWith('__rito_host')) families.add(family);
      }
    }
  };
  walkDir(unpackDir);
  return [...families];
})();
console.log(`book faces with real sources: ${bookFaceFamilies.join(', ') || '(none)'}`);
// The reader's chapterMap keys are manifest item IDS (idrefs), not paths;
// the OPF manifest maps them onto real hrefs (e.g. Text/Theatre08.xhtml).
const manifestHref = new Map();
for (const m of readFileSync(opfPath, 'utf8').matchAll(/<item\b[^>]*>/g)) {
  const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
  const href = /\bhref="([^"]+)"/.exec(m[0])?.[1];
  if (id && href) manifestHref.set(id, decodeURIComponent(href));
}

// Rito's intentional divergence (the user-sanctioned exemption): footnote
// bodies do not enter the layout flow — the reader pulls a referenced
// note (block element, epub:type footnote/endnote/rearnote/note, with an
// id some noteref points at) out of the chapter and serves it from the
// footnote drawer. The truth must mirror that or every note-bearing
// chapter reads as a giant defect (measured: +12px per note, whole-page
// shifts after each, +1/+2 column drift per chapter).
// Discovery is publication-wide, like the engine's: a noteref anywhere
// targets `href#id`.
const footnoteTargets = new Set();
for (const href of manifestHref.values()) {
  if (!/\.x?html?$/i.test(href)) continue;
  let text;
  try {
    text = readFileSync(path.join(opfDir, href), 'utf8');
  } catch {
    continue;
  }
  for (const tag of text.matchAll(/<[^>]*epub:type="[^"]*\bnoteref\b[^"]*"[^>]*>/g)) {
    const target = /\bhref="([^"]+)"/.exec(tag[0])?.[1];
    if (!target) continue;
    const [file, id] = target.split('#');
    if (!id) continue;
    const resolved =
      file === '' ? href : decodeURIComponent(new URL(file, `file:///${href}`).pathname.slice(1));
    footnoteTargets.add(`${resolved}#${id}`);
  }
}

// The reader's host faces exactly as the demo's pinned policy declares
// them (apps/reader/src/lib/production-pinned-font-policy.ts): the truth
// browser must render through the same faces, resolved the way the
// engine resolves families against them, or every glyph differs and the
// count measures typefaces, not the engine (measured: a full text page
// read ~150k px of pure font-substitution noise). Each face is declared
// under its own alias so a book face of the same name never merges with
// it, and the family rewrite below maps names onto the aliases.
const HOST_FACES = [
  { file: 'Tinos-Regular.ttf', name: 'tinos', role: 'serif', language: 'und', sample: 'H' },
  {
    file: 'SourceHanSerifCN-Regular.otf',
    name: 'source han serif cn',
    role: 'serif',
    language: 'zh-hans',
    sample: '试',
  },
  { file: 'Arimo-Regular.ttf', name: 'arimo', role: 'sans-serif', language: 'und', sample: 'H' },
  {
    file: 'SourceHanSansCN-Regular.otf',
    name: 'source han sans cn',
    role: 'sans-serif',
    language: 'zh-hans',
    sample: '试',
  },
].map((face, index) => ({
  ...face,
  alias: `__rito_host_${index}`,
  url: path.join(REPO, 'apps/reader/src/assets/fonts', face.file),
}));

const browser = await launchOracleChromium();

// ---- Engine side: load the book, read the chapter map, walk and shoot --
const reader = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DSF });
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
// Shell overlays (the engine badge) float over the canvas and would be
// captured into the element screenshot as phantom page diffs — the title
// page once measured 3102 diff pixels that were ALL badge.
await reader.addStyleTag({
  content: '[data-testid=engine-badge] { display: none !important; }',
});
await reader.waitForTimeout(1500);
// A vite reload can also land between load and planning — reload the book
// once if the controller vanished.
await reader
  .waitForFunction(() => Boolean(window.__ritoController?.reader), { timeout: 10000 })
  .catch(async () => {
    lastNav = Date.now();
    await reader.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
    while (Date.now() - lastNav < 2000) await reader.waitForTimeout(250);
    await reader.setInputFiles('input[type=file]', path.resolve(bookPath));
    await reader.waitForSelector('[data-testid=reader-shell][data-loaded=true]', {
      timeout: 300000,
    });
    await reader.addStyleTag({
      content: '[data-testid=engine-badge] { display: none !important; }',
    });
    await reader.waitForTimeout(1500);
  });
// The scrolled lane reads the book as windows: one a spread, shown where
// a page is.
if (SCROLLED) {
  await reader.evaluate(() => window.__ritoController.setSpreadMode('scrolled'));
  await reader.waitForFunction(
    () => window.__ritoController.reader.getLayoutGeometry().spreadMode === 'scrolled',
    { timeout: 120000 },
  );
  await reader.waitForTimeout(1500);
}
// Book fonts register lazily as spreads first paint, each registration
// possibly reflowing and moving page boundaries. Traverse the whole book
// once BEFORE reading the plan so every face is registered and the
// pagination has settled; the shoot pass then walks a stable book.
{
  const total = await reader.evaluate(() => window.__ritoController.reader.totalSpreads);
  for (let s = 0; s < total; s += 1) {
    await reader.keyboard.press('ArrowRight');
    await reader.waitForTimeout(45);
  }
  await reader.waitForTimeout(1500);
  const settledTotal = await reader.evaluate(() => window.__ritoController.reader.totalSpreads);
  for (let s = 0; s < Math.max(total, settledTotal); s += 1) {
    await reader.keyboard.press('ArrowLeft');
    await reader.waitForTimeout(30);
  }
  await reader.waitForTimeout(1200);
  console.log(`warmup traversal done (${settledTotal} spreads settled)`);
}

const readPlan = () =>
  reader.evaluate(() => {
    const r = window.__ritoController.reader;
    const chapters = [...r.chapterMap.entries()].map(([href, range]) => ({ href, ...range }));
    chapters.sort((a, b) => a.startPage - b.startPage);
    const spreadOfPage = new Map();
    r.spreads.forEach((s, i) => {
      spreadOfPage.set(s.leftPageIndex, { spread: i, side: 'left' });
      if (s.rightPageIndex !== undefined) {
        spreadOfPage.set(s.rightPageIndex, { spread: i, side: 'right' });
      }
    });
    const geometry = r.getLayoutGeometry();
    return {
      pageCount: r.pageCount,
      pageBounds: { width: geometry.pageWidth, height: geometry.pageHeight },
      chapters,
      pages: [...spreadOfPage.entries()].map(([page, at]) => ({ page, ...at })),
    };
  });
let plan = await readPlan();
const pageW = Math.round(plan.pageBounds.width);
const pageH = Math.round(plan.pageBounds.height);
const contentW = pageW - 2 * MARGIN;
const contentH = pageH - 2 * MARGIN;
// The same geometry on the device grid, for every index into a capture.
const pageWd = pageW * DSF;
const pageHd = pageH * DSF;
const contentHd = contentH * DSF;
const marginD = MARGIN * DSF;
console.log(
  `pages ${plan.pageCount}, page ${pageW}x${pageH}, content ${contentW}x${contentH}, chapters ${plan.chapters.length}, device scale ${DSF}`,
);
let pageAt = new Map(plan.pages.map((p) => [p.page, p]));

// Walk every spread once, screenshot the canvas, crop out both pages.
const canvas = reader.locator('[data-testid=reader-shell] canvas').first();
const enginePages = new Map();
const TAP_PAGE = process.env.RITO_WALK_TAP ? Number(process.env.RITO_WALK_TAP) : undefined;
if (TAP_PAGE !== undefined) {
  // Record the organic paint pass of each spread as the walk reaches it:
  // the page-ground fill opens a pass and resets the side translate, so
  // after a spread settles the log holds exactly its last complete paint.
  // The stream is the engine's device-resolved primitive list: every
  // coordinate is a device pixel.
  await reader.evaluate(() => {
    const scope = globalThis;
    scope.__ritoTapLog = [];
    let dx = 0;
    scope.__ritoPaintTap = (c, onScreen) => {
      // Spread pre-renders paint into DISCONNECTED canvases and the
      // screen shows their blit — an on-screen-only tap records nothing
      // at all (measured: a full walk's organic log came back empty).
      // Record every pass with its flag, keep the whole session (a
      // page-ground reset raced the NEXT spread's pre-render and wiped
      // the page under observation), and let the analyst slice.
      if (c.kind === 'fill-rect' && c.ground === 'page') dx = 0;
      if (c.kind === 'translate') {
        dx = c.dx;
        return;
      }
      const rect = c.rect ?? c.dest;
      if (rect) {
        scope.__ritoTapLog.push({
          dx,
          onScreen,
          kind: c.kind,
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
          text: (c.text ?? '').slice(0, 12),
        });
      }
    };
  });
}
const tapSpread = async (spreadIndex) => {
  const at = plan.pages.find((p) => p.page === TAP_PAGE && p.spread === spreadIndex);
  if (!at) return;
  // Dump the whole organic log unfiltered — the side translate the run
  // painted under rides on each entry, so the analyst filters offline
  // (an in-page dx filter once matched nothing when the pass carried no
  // translate command at all and every entry sat at dx 0).
  const log = await reader.evaluate(() => globalThis.__ritoTapLog ?? []);
  writeFileSync(
    path.join(outDir, `tap-p${String(TAP_PAGE).padStart(3, '0')}.json`),
    JSON.stringify(log, null, 1),
  );
  console.log(`[tap] page ${TAP_PAGE}: ${log.length} commands (organic pass)`);
};
const shootSpread = async (spreadIndex) => {
  // The paint path deliberately keeps the PREVIOUS canvas while a
  // spread's image bitmaps are still decoding (degrade-never-block), so
  // a screenshot on arrival can capture the prior spread's image as a
  // ghost (measured on b39: id22's page shot the id23 illustration —
  // 13.jpg — three walks in a row, a 257k phantom account). Await image
  // settlement, then one more beat for the invalidation repaint. A
  // timeout falls through: a terminally failed image never repaints.
  await reader
    .waitForFunction(
      (s) => globalThis.__ritoReaderDiagnostics?.spreadImagesSettled?.(s) ?? true,
      spreadIndex,
      { timeout: 20000 },
    )
    .catch(() => {
      console.log(`[images] spread ${spreadIndex}: settlement timed out; shooting anyway`);
    });
  await reader.waitForTimeout(250);
  // The canvas repaint after a page turn is asynchronous: press-verify
  // confirms the INDEX moved, but a spread with large contain-fit plates
  // can still show the previous spread's pixels for hundreds of ms
  // (measured on gimai v03: every colour page shot the prior plate while
  // the live canvas, given ~700ms, was correct). Poll a thin strip until
  // two consecutive samples agree; time-box it so a static page costs
  // one extra sample only.
  {
    let previous = null;
    for (let settle = 0; settle < 10; settle += 1) {
      const sample = await canvas.screenshot({ timeout: 30000 }).catch(() => null);
      if (sample !== null && previous !== null && sample.equals(previous)) break;
      previous = sample;
      await reader.waitForTimeout(300);
    }
  }
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
  const rightX = png.width - pageWd;
  for (const side of ['left', 'right']) {
    const at = plan.pages.find((p) => p.spread === spreadIndex && p.side === side);
    if (!at || enginePages.has(at.page)) continue;
    const x0 = side === 'left' ? 0 : rightX;
    const out = new PNG({ width: pageWd, height: pageHd });
    for (let y = 0; y < pageHd; y += 1) {
      for (let x = 0; x < pageWd; x += 1) {
        const si = (y * png.width + (x0 + x)) * 4;
        const di = (y * pageWd + x) * 4;
        for (let k = 0; k < 4; k += 1) out.data[di + k] = png.data[si + k];
      }
    }
    enginePages.set(at.page, out);
  }
};
// A vite dep re-optimize can hard-reload the page at any point of the
// walk, dropping the book. Recover in place: reload the book (pagination
// is deterministic, so the plan still holds) and page forward to where
// the walk was.
const recoverToSpread = async (spreadIndex) => {
  await reader.goto(BASE);
  lastNav = Date.now();
  await reader.waitForSelector('input[type=file]', { state: 'attached', timeout: 60000 });
  while (Date.now() - lastNav < 2000) await reader.waitForTimeout(250);
  await reader.setInputFiles('input[type=file]', path.resolve(bookPath));
  await reader.waitForSelector('[data-testid=reader-shell][data-loaded=true]', {
    timeout: 300000,
  });
  await reader.addStyleTag({
    content: '[data-testid=engine-badge] { display: none !important; }',
  });
  await reader.waitForTimeout(1200);
  for (let guard = 0; guard < 400; guard += 1) {
    const at = await reader.evaluate(() => window.__ritoController.reader.activeSpreadIndex ?? 0);
    if (!at) break;
    await reader.keyboard.press('ArrowLeft');
    await reader.waitForTimeout(45);
  }
  for (let step = 0; step < spreadIndex; step += 1) {
    await reader.keyboard.press('ArrowRight');
    await reader.waitForTimeout(60);
  }
};
// Lazily registered book fonts can trigger a reflow AFTER the plan was
// read, shifting every later page boundary mid-walk (measured: a whole
// book compared against off-by-two columns). Shoot, then verify the
// pagination still matches the plan; a shifted run re-walks once — by
// then every font is registered and the pagination is stable.
const paginationSignature = () =>
  reader.evaluate(() => {
    const r = window.__ritoController.reader;
    return `${r.pageCount}|${[...r.chapterMap.entries()]
      .map(([href, range]) => `${href}:${range.startPage}`)
      .join(',')}`;
  });
let planSignature = await paginationSignature();
// Some books open at a guide/start-reading position instead of spread 0
// (measured: book 003 opens at spread 19); the capture loop assumes the
// first shot is spread 0, so rewind until the reader actually sits there.
const rewindToStart = async () => {
  for (let guard = 0; guard < 400; guard += 1) {
    const at = await reader.evaluate(() => window.__ritoController.reader.activeSpreadIndex ?? 0);
    if (!at) return;
    await reader.keyboard.press('ArrowLeft');
    await reader.waitForTimeout(45);
  }
};
await rewindToStart();
await reader.waitForTimeout(600);
for (let attempt = 0; attempt < 2; attempt += 1) {
  const totalSpreads = Math.max(...plan.pages.map((p) => p.spread)) + 1;
  for (let s = 0; s < totalSpreads; s += 1) {
    if (Math.min(...[...pageAt.keys()].filter((p) => !enginePages.has(p))) > MAX_PAGES) break;
    // A screenshot during the page-turn slide reads as a horizontal shift
    // of the whole page (image spreads settle latest — their frames land
    // after async decodes). Wait out the transition, then settle.
    await reader
      .waitForFunction(
        () =>
          document.querySelector('[data-testid=reader-shell]')?.dataset.transitioning === 'false',
        { timeout: 15000 },
      )
      .catch(() => undefined);
    await reader.waitForTimeout(s === 0 ? 800 : 320);
    try {
      await shootSpread(s);
      if (TAP_PAGE !== undefined) await tapSpread(s);
    } catch (error) {
      if (!String(error).includes('book state lost')) throw error;
      console.log(`[recover] ${String(error).split('\n')[0]} — reloading and resuming`);
      await recoverToSpread(s);
      await reader.waitForTimeout(500);
      await shootSpread(s);
    }
    if (s < totalSpreads - 1) {
      // A press can be swallowed (measured: b39's image-dominated
      // single-page spreads dropped one, lagging EVERY later shot by
      // one spread — the whole book compared against its neighbor).
      // Verify the reader actually advanced; retry if not.
      for (let retry = 0; retry < 5; retry += 1) {
        await reader.keyboard.press('ArrowRight');
        const arrived = await reader
          .waitForFunction(
            (want) => (window.__ritoController.reader.activeSpreadIndex ?? 0) >= want,
            s + 1,
            { timeout: 3000 },
          )
          .then(() => true)
          .catch(() => false);
        if (arrived) break;
      }
    }
  }
  const settled = await paginationSignature();
  if (settled === planSignature) break;
  if (attempt === 1) {
    throw new Error('pagination still shifting after a full re-walk');
  }
  console.log('[re-walk] pagination shifted mid-run; re-shooting with settled pagination');
  enginePages.clear();
  plan = await readPlan();
  pageAt = new Map(plan.pages.map((p) => [p.page, p]));
  planSignature = await paginationSignature();
  await recoverToSpread(0);
  await reader.waitForTimeout(800);
}
await reader.close();
console.log(`engine pages captured: ${enginePages.size}`);

// ---- Truth side: per chapter, multicol columns of the content box -------
const truthColumns = new Map(); // idref -> PNG[] (one per column)
// idref -> where the paged truth draws bitmap images (image-areas.mjs).
const truthImageAreas = new Map();
// idref -> the scrolled lane's windows (scroll-truth.mjs).
const truthWindows = new Map();
// idref -> how many column boxes Chromium lays the chapter out in: across
// for a horizontal chapter, down the inline axis for a vertical one.
const truthColumnCount = new Map();
// PAGE JavaScript stays OFF: the engine (like EPUB readers generally)
// never executes book scripts, but a file:// chapter runs them — a
// publisher's notereplace.js swapped the footnote-marker image for a
// 【注】 text link and every note-bearing paragraph rewrapped
// (Playwright's evaluate still works; only the page's own scripts stop).
// The truth renders in its OWN browser: after the reader's long
// session in the shared process, vertical document-clip captures came
// back blank and scroll captures sat ~190px stale on a fresh page and
// context alike; a fresh browser process renders the same page,
// injection and clip correctly.
// For A/B runs only: RITO_TRUTH_LOCALE lays the truth out under another
// default locale (the content language a document without `lang` breaks
// its lines by), RITO_TRUTH_MIN_FONT_SIZE under a minimum font size.
const truthArgs = process.env.RITO_TRUTH_MIN_FONT_SIZE
  ? [`--blink-settings=minimumLogicalFontSize=${process.env.RITO_TRUTH_MIN_FONT_SIZE}`]
  : [];
const truthBrowser = await launchOracleChromium(truthArgs, {
  executablePath: process.env.RITO_TRUTH_CHROMIUM,
});
const truthContext = await truthBrowser.newContext({
  viewport: { width: contentW + 200, height: contentH },
  deviceScaleFactor: DSF,
  javaScriptEnabled: false,
  ...(process.env.RITO_TRUTH_LOCALE ? { locale: process.env.RITO_TRUTH_LOCALE } : {}),
});
const truth = await truthContext.newPage();
const truthCdp = await truthContext.newCDPSession(truth);
// The page is laid out in the engine's CSS viewport, one page's content box
// (rito-core chapter_style_viewport): `vw`, fixed positioning and an
// orthogonal flow's indefinite-size fallback all read that initial
// containing block (Blink's SetOrthogonalFallbackInlineSize takes its
// size), and the view's own width laid calibre's `width: 100%` plate spacer
// out 200px wider than the page. Only the layout viewport moves: the view
// keeps the width the clips were set up in. Pinned again for every chapter;
// a full-page shot restores the view. For A/B runs only,
// RITO_TRUTH_WIDE_VIEWPORT lays the page out in the whole view instead.
const pinTruthViewport = () =>
  process.env.RITO_TRUTH_WIDE_VIEWPORT
    ? Promise.resolve()
    : truthCdp.send('Emulation.setDeviceMetricsOverride', {
        width: contentW,
        height: contentH,
        deviceScaleFactor: DSF,
        mobile: false,
        dontSetVisibleSize: true,
      });
for (const chapter of plan.chapters) {
  const href = manifestHref.get(chapter.href) ?? chapter.href;
  const file = path.join(opfDir, href);
  const expected = chapter.endPage - chapter.startPage + 1;
  try {
    // EPUB content documents are XHTML: a real reader (and the engine)
    // parses them as XML, which is always standards mode. A calibre
    // `.html` chapter loaded from file:// would sniff as HTML and, with
    // no doctype, drop into QUIRKS mode — measured: a tiny-font-only
    // line collapses its strut there, shifting every later line. Load
    // through an `.xhtml`-suffixed sibling copy so Chromium parses XML.
    let truthFile = file;
    if (!/\.xhtml$/i.test(file)) {
      const sibling = `${file}.walk.xhtml`;
      if (!existsSync(sibling)) {
        // The engine's source normalizer DROPS control characters XML
        // forbids (rito-source normalizer); a raw copy with such a byte
        // makes Chromium's XML parse fatal (yellow error page) and the
        // whole chapter scores as drift. Strip them the same way.
        const raw = readFileSync(file);
        const clean = Buffer.from(
          [...raw].filter((b) => b >= 0x20 || b === 0x09 || b === 0x0a || b === 0x0d),
        );
        writeFileSync(sibling, clean);
      }
      truthFile = sibling;
    }
    await pinTruthViewport();
    await truth.goto(`file://${truthFile}`, { timeout: 30000 });
    if (truthFile !== file) {
      // A calibre `.html` chapter that is not well-formed XML turns the
      // `.xhtml` sibling into Chromium's yellow error page (measured:
      // b39's index_split_012 stops at an unclosed div and every later
      // chapter compares against truncated truth). The engine's source
      // normalizer recovers leniently, so the truth must too: parse the
      // ORIGINAL file with Chromium's HTML recovery, serialize the
      // repaired DOM back to XHTML, and reload — still XML, still
      // standards mode, same content the engine sees.
      const xmlBroken = await truth.evaluate(() => Boolean(document.querySelector('parsererror')));
      if (xmlBroken) {
        await truth.goto(`file://${file}`, { timeout: 30000 });
        const repaired = await truth.evaluate(() =>
          new XMLSerializer().serializeToString(document),
        );
        writeFileSync(truthFile, repaired);
        await truth.goto(`file://${truthFile}`, { timeout: 30000 });
      }
    }
    const noteIds = [...footnoteTargets]
      .filter((target) => target.startsWith(`${href}#`))
      .map((target) => target.slice(href.length + 1));
    const injectTruth = (pg) =>
      pg.evaluate(
        async ({ contentW, contentH, hostFaces, noteIds, bookFaceFamilies, scrolled }) => {
          // A vertical chapter pages the way CSS fragments it: the element
          // that turns the flow vertical (the root, else the body) becomes a
          // multicol container one page wide, so its content breaks along
          // the block axis at the page width under the fragmentation rules
          // (orphans, widows, margins truncated at a break) and each column
          // box is a page, stacked down the inline axis — the vertical
          // twin of the horizontal harness. The scrolled lane reads the
          // native flow instead.
          const verticalOf = (element) =>
            ['vertical-rl', 'vertical-lr'].includes(getComputedStyle(element).writingMode);
          const verticalRoot = verticalOf(document.documentElement) || verticalOf(document.body);
          // A chapter whose body alone turns vertical pages in the body's
          // writing mode from the root, its principal writing mode (CSS
          // propagates it from the body to the viewport): the root takes
          // the body's mode, so the body's own box — margins included —
          // lies inside the pages as every other chapter's does.
          if (verticalRoot && !verticalOf(document.documentElement)) {
            document.documentElement.style.writingMode = getComputedStyle(
              document.body,
            ).writingMode;
          }
          const fragmenter = verticalOf(document.documentElement) ? 'html' : 'body';
          const columns = `width:${contentW}px; height:${contentH}px; column-width:${contentH}px; column-gap:3000px; column-fill:auto;`;
          const s = document.createElement('style');
          // The multicol pagination baseline. The reader's image page
          // clamp is mirrored PER ELEMENT below (uniform box scaling) —
          // a blanket \`max-height !important\` here once squashed every
          // author-width oversized image the same way a defective engine
          // policy did, and the diff went blind to the whole class (b52's
          // stretched cover scored bf=2).
          // The container is EXACTLY one column wide: multicol stretches
          // its columns to fill the container, so a loose viewport-width
          // container would silently widen every column past the engine's
          // content width. Overflow columns grow to the right at the same
          // exact width (the paginated-reader idiom).
          s.textContent = `${hostFaces
            .map((face) => `@font-face { font-family: "${face.alias}"; src: url("${face.url}"); }`)
            .join('\n')}
${
  verticalRoot && scrolled
    ? `html { margin:0; padding:0; height:${contentH}px; }`
    : verticalRoot && fragmenter === 'html'
      ? `html { margin:0; padding:0; ${columns} }`
      : verticalRoot
        ? `html { margin:0; padding:0; width:${contentW}px; height:${contentH}px; }`
        : scrolled
          ? `html { margin:0; padding:0; width:${contentW}px; }`
          : `html { margin:0; padding:0; width:${contentW}px; height:${contentH}px; column-width:${contentW}px; column-gap:3000px; column-fill:auto; }`
}
body { margin:0; padding:0; position:relative; ${verticalRoot && !scrolled && fragmenter === 'body' ? columns : ''} }
img, svg { max-width: 100%; }
img { object-fit: contain; }`;
          document.head.insertBefore(s, document.head.firstChild);
          // Reader UA policy mirror. `img { object-fit: contain }` above
          // mirrors the engine's UA stylesheet declaration (rito-stylo
          // src/ua.rs, guarded by rito-core's ua_image_policy_mirror
          // test): the truth browser letterboxes author-distorted boxes
          // natively, exactly like the engine's paint. The SIZE mirror
          // (rito-inline image_display_size) stays in
          // two aspect-preserving halves: the WIDTH cap is the plain
          // `max-width: 100%` above (a replaced element never exceeds its
          // container; Blink shrinks the auto cross axis with it), and the
          // HEIGHT clamp is applied per element below, scaling the measured
          // box uniformly. EXCEPT a both-axes-authored image: the injected
          // cap would re-resolve it the Blink way (width capped, authored
          // height held, box DISTORTED) before the clamp — a 708x996-styled
          // plate fit to 546x850 where the engine's uniform page clamp of
          // the authored box lays 604x850. Detection is empirical: lifting
          // the injected cap widens the box while the height stays put.
          // Measure every replaced box under the book's own CSS first,
          // then pin the scaled sizes, so reflow from one fix cannot skew
          // the next measurement.
          {
            const replaced = [...document.querySelectorAll('img, svg')];
            await Promise.all(
              replaced
                .filter((el) => el.tagName === 'IMG' && !el.complete)
                .map(
                  (el) =>
                    new Promise((done) => {
                      el.addEventListener('load', done, { once: true });
                      el.addEventListener('error', done, { once: true });
                    }),
                ),
            );
            const fits = replaced.map((el) => {
              const rect = el.getBoundingClientRect();
              el.style.setProperty('max-width', 'none', 'important');
              const freeRect = el.getBoundingClientRect();
              el.style.removeProperty('max-width');
              const cs = getComputedStyle(el);
              const edge = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
              const extraX =
                edge('border-left-width') +
                edge('border-right-width') +
                edge('padding-left') +
                edge('padding-right');
              const extraY =
                edge('border-top-width') +
                edge('border-bottom-width') +
                edge('padding-top') +
                edge('padding-bottom');
              // The clamp scales the CONTENT box; borders and padding stay
              // at author size outside it (the engine absorbs an image's
              // border into flank padding around the raster — b60's
              // 1px-bordered cover measured 2px wide when the border-box
              // was scaled as if it were content).
              return {
                el,
                width: rect.width - extraX,
                height: rect.height - extraY,
                freeWidth: freeRect.width - extraX,
                freeHeight: freeRect.height - extraY,
                extraX,
                extraY,
              };
            });
            for (const { el, width, height, freeWidth, freeHeight, extraX, extraY } of fits) {
              if (!(width > 0) || !(height > 0)) continue;
              const budgetY = contentH - extraY;
              const authoredDistortion =
                freeWidth - width > 0.5 && Math.abs(freeHeight - height) < 0.5;
              if (authoredDistortion) {
                const budgetX = contentW - extraX;
                const scale = Math.min(1, budgetX / freeWidth, budgetY / freeHeight);
                el.style.setProperty('width', `${freeWidth * scale}px`, 'important');
                el.style.setProperty('height', `${freeHeight * scale}px`, 'important');
                continue;
              }
              const scale = budgetY / height;
              if (scale >= 1) continue;
              el.style.setProperty('width', `${width * scale}px`, 'important');
              el.style.setProperty('height', `${budgetY}px`, 'important');
            }
          }
          // A 404'd host face silently falls back to the browser's own font
          // and the whole page reads as a defect — assert every face loaded.
          for (const face of hostFaces) {
            await document.fonts.load(`16px "${face.alias}"`, face.sample);
          }
          await document.fonts.ready;
          for (const { alias } of hostFaces) {
            const face = [...document.fonts].find((f) => f.family === alias);
            if (face?.status !== 'loaded') {
              throw new Error(`host face ${alias} did not load (${face?.status ?? 'absent'})`);
            }
          }
          // Mirror the engine's family resolution (rito-inline fonts.rs):
          // a named family is the book's own @font-face family, else the
          // host family of that name, else skipped (the browser's UA
          // default "Times" included); a generic keyword is the host faces
          // of its role — language-neutral faces first, then by how closely
          // their language matches the element's; after the list every host
          // face follows as the fallback, serif role first. The trailing
          // generic only catches what no host face covers.
          const roleOf = {
            serif: 'serif',
            'sans-serif': 'sans-serif',
            'system-ui': 'sans-serif',
            monospace: 'monospace',
          };
          const generic = new Set([
            'serif',
            'sans-serif',
            'monospace',
            'cursive',
            'fantasy',
            'system-ui',
          ]);
          const languageRank = (face, content) => {
            if (face === 'und') return 0;
            if (!content) return 3;
            if (face === content) return 1;
            return face.split('-')[0] === content.split('-')[0] ? 2 : 3;
          };
          const roleFaces = (role, language) =>
            hostFaces
              .filter((face) => face.role === role)
              .map((face) => ({ face, rank: languageRank(face.language, language) }))
              .sort((left, right) => left.rank - right.rank)
              .map(({ face }) => `"${face.alias}"`);
          const elementLanguage = (element) => {
            for (let node = element; node; node = node.parentElement) {
              const tag =
                node.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') ??
                node.getAttribute('lang');
              if (tag !== null) return tag.toLowerCase() || undefined;
            }
            return undefined;
          };
          // A book face counts only when its @font-face carries a REAL
          // url() source (an embedded font file). Publisher "system font"
          // stacks declare local(黑体/微软雅黑/…) plus dead reader-device
          // res:// urls — the engine can never resolve those, but a Mac
          // running the truth CAN (b20's TS-Default rendered its ruby kana
          // in the system Heiti while the engine used the pin), so a
          // local()-resolvable face silently un-equalizes the two sides.
          // Scanned node-side from the unpacked book: linked stylesheets
          // are cross-origin to a file:// page, so an in-page cssRules
          // walk reads nothing here.
          const bookFaces = new Set(bookFaceFamilies);
          for (const sheet of document.styleSheets) {
            let rules;
            try {
              rules = sheet.cssRules;
            } catch {
              continue;
            }
            for (const rule of rules) {
              if (!(rule instanceof CSSFontFaceRule)) continue;
              const src = rule.style.getPropertyValue('src');
              if (!/url\(\s*["']?(?!res:)/i.test(src)) continue;
              const family = rule.style
                .getPropertyValue('font-family')
                .replaceAll('"', '')
                .toLowerCase()
                .trim();
              if (family && !family.startsWith('__rito_host')) bookFaces.add(family);
            }
          }
          for (const element of [document.documentElement, ...document.querySelectorAll('*')]) {
            const list = getComputedStyle(element).fontFamily;
            const language = elementLanguage(element);
            const parts = [];
            const push = (names) => {
              for (const name of names) if (!parts.includes(name)) parts.push(name);
            };
            for (const raw of list
              .split(',')
              .map((name) => name.trim())
              .filter((name) => name.length > 0)) {
              const lower = raw.replaceAll('"', '').toLowerCase();
              if (!raw.startsWith('"') && generic.has(lower)) {
                const role = roleOf[lower];
                if (role) push(roleFaces(role, language));
                continue;
              }
              // A list inherited from an already rewritten ancestor names
              // the aliases themselves: the rewrite must be idempotent.
              if (bookFaces.has(lower) || hostFaces.some((face) => face.alias === lower)) {
                push([raw]);
                continue;
              }
              push(
                hostFaces.filter((face) => face.name === lower).map((face) => `"${face.alias}"`),
              );
            }
            for (const role of ['serif', 'sans-serif', 'monospace'])
              push(roleFaces(role, language));
            parts.push('serif');
            element.style.setProperty('font-family', parts.join(', '), 'important');
          }
          // Kept book faces must actually LOAD before capture: applying a
          // family via the rewrite does not itself start the fetch until
          // a layout uses it, and fonts.ready resolves against loads that
          // have already started.
          for (const family of bookFaces) {
            // A corrupt embedded face rejects the load with a NetworkError;
            // both engines fall to the next family in that case, so the
            // truth must too instead of blanking the whole chapter.
            await document.fonts.load(`16px "${family}"`, '试A').catch(() => undefined);
          }
          await document.fonts.ready;
          // Rito feature mirror: referenced footnote bodies leave the flow.
          for (const id of noteIds) {
            const el = document.getElementById(id);
            if (!el) continue;
            const type = el.getAttribute('epub:type') ?? '';
            if (!/\b(footnote|endnote|rearnote|note)\b/.test(type)) continue;
            if (getComputedStyle(el).display !== 'block') continue;
            el.style.setProperty('display', 'none', 'important');
          }
          await document.fonts.ready;
          if (!verticalRoot) return null;
          return { fragmenter: scrolled ? null : fragmenter };
        },
        {
          contentW,
          contentH,
          hostFaces: HOST_FACES,
          noteIds,
          bookFaceFamilies,
          scrolled: SCROLLED,
        },
      );
    const vertical = await injectTruth(truth);
    // RITO_WALK_DUMP="<chapter href part>|<selector>" prints the truth's
    // client rects of the matching elements in that chapter, laid out
    // exactly as the walk captures it.
    if (process.env.RITO_WALK_DUMP) {
      const [hrefPart, selector] = process.env.RITO_WALK_DUMP.split('|');
      if (chapter.href.includes(hrefPart) || href.includes(hrefPart)) {
        const rects = await truth.evaluate(
          (sel) =>
            [...document.querySelectorAll(sel)].map((element) => {
              const r = element.getBoundingClientRect();
              return { tag: element.tagName, x: r.x, y: r.y, width: r.width, height: r.height };
            }),
          selector,
        );
        console.log(`dump ${chapter.href} ${JSON.stringify(rects)}`);
      }
    }
    if (SCROLLED) {
      await truth.waitForTimeout(250);
      // A vertical chapter's windows run leftwards from its right edge.
      truthWindows.set(
        chapter.href,
        vertical
          ? await captureLeftwardWindows(truth, { contentH, pageW, margin: MARGIN, dsf: DSF })
          : await captureScrolledWindows(truth, { contentW, contentH, pageH, margin: MARGIN }),
      );
      continue;
    }
    await truth.waitForTimeout(250);
    // One screenshot per column. Each column is brought to the viewport by
    // a negative margin on the root element, NOT by scrolling: scrolling
    // leaves display-list glyph origins at layout coordinates, and beyond
    // x = 2^18 = 262,144 a float32 glyph origin can no longer represent
    // the 1/64px layout grid (its ulp grows to 1/32px), so far columns
    // raster with quantized glyph positions that near-origin rendering —
    // and the engine, which paints every page at the canvas origin —
    // never shows. Measured: any column past x=262,144 captured via
    // scroll differs from the same content in column 0 by ~700
    // beyond-floor pixels/page; captured via root margin shift it is
    // bit-identical. body is position:relative so absolutely positioned
    // book content anchors to the shifted page box, not the viewport.
    const columns = [];
    const docWidth = await truth.evaluate(() => document.documentElement.scrollWidth);
    if (vertical) {
      // Column box k sits k strides down the inline axis; a negative
      // inline-start margin on the multicol element brings it to the
      // viewport's top, near the origin like the horizontal columns.
      const stride = contentH + 3000;
      const docHeight = await truth.evaluate(() => document.documentElement.scrollHeight);
      truthColumnCount.set(chapter.href, Math.floor((docHeight + 3000) / stride + 0.001));
      for (let k = 0; k <= expected + 1; k += 1) {
        const y0 = k * stride;
        if (y0 >= docHeight) break;
        // A screenshot clip counts from the document's scroll origin, which
        // content overflowing leftward (a vertical-rl line wider than its
        // column) moves left of the viewport: the clip takes the column's
        // client position less that origin.
        await moveTruthRoot(truth, { y: y0, element: vertical.fragmenter });
        const left = await truth.evaluate(
          ({ fragmenter }) => {
            const element = fragmenter === 'html' ? document.documentElement : document.body;
            const scroller = document.scrollingElement;
            const origin =
              getComputedStyle(document.documentElement).writingMode === 'vertical-rl'
                ? Math.min(0, scroller.clientWidth - scroller.scrollWidth)
                : 0;
            return element.getBoundingClientRect().left - origin;
          },
          { fragmenter: vertical.fragmenter },
        );
        // Through the protocol itself: Playwright's clip clamps to a
        // viewport it measures from the client origin and cuts the column
        // short.
        const { data } = await truthCdp.send('Page.captureScreenshot', {
          format: 'png',
          clip: { x: left, y: 0, width: contentW, height: contentH, scale: 1 },
        });
        columns.push(PNG.sync.read(Buffer.from(data, 'base64')));
      }
      truthColumns.set(chapter.href, columns);
      continue;
    }
    // n columns span n*contentW + (n-1)*3000; a line overflowing its
    // column by less than one step does not add one.
    truthColumnCount.set(chapter.href, Math.floor((docWidth + 3000) / (contentW + 3000) + 0.001));
    truthImageAreas.set(chapter.href, await collectImageAreas(truth, { step: contentW + 3000 }));
    for (let k = 0; k <= expected + 1; k += 1) {
      // The gap must exceed any single line's horizontal overflow: an
      // unbreakable run (61 fullwidth stars) is ~430px wider than the
      // column, and with a 100px gap its tail painted into the NEXT
      // column's screenshot slice as ghost glyphs the engine (which
      // clips at the page edge) never draws.
      const x0 = k * (contentW + 3000);
      if (x0 >= docWidth) break;
      // Capture the right page margin too: an unbreakable line overflows
      // its column and PAINTS across the page's right margin band, which
      // the engine (clipping at the page edge) also shows. A content-wide
      // clip amputated that band and scored the engine's overflow ink as
      // phantom diff.
      columns.push(
        await shootContentWithBand(truth, {
          contentW,
          height: contentH,
          margin: MARGIN,
          x: x0,
        }),
      );
    }
    truthColumns.set(chapter.href, columns);
  } catch (error) {
    console.log(`[truth-error] ${chapter.href}: ${String(error).slice(0, 120)}`);
    truthColumns.set(chapter.href, []);
  }
}
await truth.close();
await truthBrowser.close();
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
  // Drift compares the engine's page count with the number of columns
  // Chromium lays the chapter out in, blank columns included: a blank
  // page both sides make (a trailing empty line, a forced break) is not
  // drift, and a blank page only the engine makes is. Counting columns
  // through the last inked one instead trimmed every trailing blank
  // column, so each matching trailing blank page read as -1 and an
  // engine-only blank page hid among them. A chapter whose columns went
  // uncounted keeps the ink count: columns through the last inked one.
  const g = columns[0]
    ? [columns[0].data[0], columns[0].data[1], columns[0].data[2]]
    : [255, 255, 255];
  let truthUsed = 0;
  columns.forEach((c, i) => {
    if (inked(c, g) > 0) truthUsed = i + 1;
  });
  const windows = truthWindows.get(chapter.href) ?? [];
  const truthCount = SCROLLED ? windows.length : (truthColumnCount.get(chapter.href) ?? truthUsed);
  for (let k = 0; k < enginePageCount; k += 1) {
    const pageIndex = chapter.startPage + k;
    if (pageIndex > MAX_PAGES) break;
    const engine = enginePages.get(pageIndex);
    const column = columns[k];
    if (!engine) continue;
    // Compose the truth page: the page ground sampled from the engine's
    // own corner (theme paper), the column at the content origin.
    const ground = [engine.data[0], engine.data[1], engine.data[2]];
    let truthPage = new PNG({ width: pageWd, height: pageHd });
    for (let p = 0; p < pageWd * pageHd; p += 1) {
      const i = p * 4;
      truthPage.data[i] = ground[0];
      truthPage.data[i + 1] = ground[1];
      truthPage.data[i + 2] = ground[2];
      truthPage.data[i + 3] = 255;
    }
    if (column) {
      for (let y = 0; y < contentHd; y += 1) {
        for (let x = 0; x < column.width && marginD + x < pageWd; x += 1) {
          const si = (y * column.width + x) * 4;
          const di = ((marginD + y) * pageWd + (marginD + x)) * 4;
          for (let j = 0; j < 4; j += 1) truthPage.data[di + j] = column.data[si + j];
        }
      }
    }
    // A scrolled window is its own length tall: the rows past a chapter's
    // last window hold nothing of it.
    const scrolledWindow = SCROLLED ? windows[k] : undefined;
    if (scrolledWindow) {
      truthPage = composeScrolledWindow(scrolledWindow, {
        pageWd,
        pageHd,
        marginD,
        dsf: DSF,
        ground,
      });
    }
    // A leftward window is its own length wide instead.
    const comparedRows =
      scrolledWindow && !scrolledWindow.crop
        ? Math.min(pageHd, Math.round(scrolledWindow.length * DSF))
        : pageHd;
    const comparedColumns = scrolledWindow?.crop
      ? Math.min(pageWd, Math.round(scrolledWindow.length * DSF))
      : pageWd;
    let diff = 0;
    // Above the characterized host-raster floor: Chromium's own two CPU
    // raster lanes (canvas 2D vs DOM image/box AA) disagree by at most 13
    // per channel at bilinear ties and AA coverage ramps — seven
    // reproduction models pixel-falsified (task dossier). A defect the
    // engine can act on moves ink, and moved ink exceeds that ceiling.
    let beyondFloor = 0;
    // The beyond-floor pixels outside the page's drawn images: inside one
    // the diff measures canvas against compositor resampling
    // (image-areas.mjs). Paged horizontal pages only.
    const areas = truthImageAreas.get(chapter.href);
    const images = areas ? imageMask(areas, k, { pageWd, pageHd, marginD, dsf: DSF }) : undefined;
    let beyondOutsideImages = 0;
    for (let p = 0; p < pageWd * comparedRows; p += 1) {
      if (p % pageWd >= comparedColumns) continue;
      const i = p * 4;
      const delta = Math.max(
        Math.abs(engine.data[i] - truthPage.data[i]),
        Math.abs(engine.data[i + 1] - truthPage.data[i + 1]),
        Math.abs(engine.data[i + 2] - truthPage.data[i + 2]),
      );
      if (delta > 0) diff += 1;
      if (delta > 13) beyondFloor += 1;
      if (delta > 13 && !images?.[p]) beyondOutsideImages += 1;
    }
    results.push({
      chapter: chapter.href,
      pageInChapter: k,
      pageIndex,
      diff,
      beyondFloor,
      beyondOutsideImages: images ? beyondOutsideImages : undefined,
      drift: truthCount - enginePageCount,
      engine,
      truthPage,
    });
    // Persist both sides for offline drill-down (probing a divergence
    // must not require another full walk).
    const stem = `p${String(pageIndex).padStart(3, '0')}.png`;
    writeFileSync(path.join(outDir, 'engine', stem), PNG.sync.write(engine));
    writeFileSync(path.join(outDir, 'truth', stem), PNG.sync.write(truthPage));
  }
}
results.sort((a, b) => b.diff - a.diff);
const lines = [
  '# Pixel walk: new engine vs Chromium, per page',
  '',
  `book: ${path.basename(bookPath)}`,
  `gold standard: 0 diff pixels; page ${pageW}x${pageH}, content ${contentW}x${contentH}, device scale ${DSF} (${pageWd}x${pageHd} device px)`,
  '',
  '## Chapter pagination drift (truth columns − engine pages)',
  '',
];
const seen = new Set();
for (const r of results) {
  if (seen.has(r.chapter) || r.drift === 0) continue;
  seen.add(r.chapter);
  lines.push(`- ${r.chapter}: ${r.drift > 0 ? '+' : ''}${r.drift}`);
}
lines.push('', '## Pages, worst first (diff px / beyond-floor px)', '');
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
    `- ${String(r.diff).padStart(8)} / ${String(r.beyondFloor).padStart(6)} px — ${r.chapter} page ${r.pageInChapter} (book page ${r.pageIndex})${r.beyondOutsideImages === undefined || r.beyondOutsideImages === r.beyondFloor ? '' : `, outside images ${r.beyondOutsideImages}`}`,
  );
  if ((rank < GALLERY || bestNonzero.has(r.pageIndex)) && r.diff > 0) {
    const sep = 4;
    const comp = new PNG({ width: pageWd * 2 + sep, height: pageHd });
    comp.data.fill(255);
    for (let y = 0; y < pageHd; y += 1) {
      for (let x = 0; x < pageWd; x += 1) {
        const si = (y * pageWd + x) * 4;
        const di = (y * comp.width + x) * 4;
        for (let j = 0; j < 4; j += 1) comp.data[di + j] = r.engine.data[si + j];
        const di2 = (y * comp.width + pageWd + sep + x) * 4;
        for (let j = 0; j < 4; j += 1) comp.data[di2 + j] = r.truthPage.data[si + j];
      }
      for (let x = pageWd; x < pageWd + sep; x += 1) {
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
const zeroBeyond = results.filter((r) => r.beyondFloor === 0).length;
const totalBeyond = results.reduce((sum, r) => sum + r.beyondFloor, 0);
const outside = results.map((r) => r.beyondOutsideImages ?? r.beyondFloor);
const totalOutside = outside.reduce((sum, n) => sum + n, 0);
const zeroOutside = outside.filter((n) => n === 0).length;
lines.splice(
  4,
  0,
  `pages compared: ${results.length}; at ZERO diff: ${zero}; worst: ${results[0]?.diff ?? 0} px`,
  `beyond the characterized raster floor (>13/channel): ${totalBeyond} px on ${results.length - zeroBeyond} pages; at ZERO: ${zeroBeyond}`,
  `beyond the floor outside drawn images: ${totalOutside} px on ${results.length - zeroOutside} pages; at ZERO: ${zeroOutside}`,
);
writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
writeFileSync(
  path.join(outDir, 'image-areas.json'),
  JSON.stringify(Object.fromEntries(truthImageAreas), null, 1),
);
console.log(lines.slice(0, 30).join('\n'));
console.log(`\nreport: ${path.join(outDir, 'report.md')}`);
