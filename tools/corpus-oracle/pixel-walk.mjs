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
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
mkdirSync(path.join(outDir, 'truth'), { recursive: true });

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

// The engine paints through the reader's pinned faces (Tinos for Latin,
// SourceHan Serif for CJK) — the truth browser must render through the
// same faces or every glyph differs and the count measures typefaces,
// not the engine (measured: a full text page read ~150k px of pure
// font-substitution noise).
const PIN_LATIN = path.join(REPO, 'apps/reader/src/assets/fonts/Tinos-Regular.ttf');
const PIN_CJK = path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf');

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
    await reader.waitForFunction(
      () =>
        document.querySelector('[data-testid=reader-shell]')?.dataset.paginationComplete === 'true',
      { timeout: 300000 },
    );
    await reader.addStyleTag({
      content: '[data-testid=engine-badge] { display: none !important; }',
    });
    await reader.waitForTimeout(1500);
  });
// Book fonts register lazily as spreads first paint, each registration
// possibly reflowing and moving page boundaries. Traverse the whole book
// once BEFORE reading the plan so every face is registered and the
// pagination has settled; the shoot pass then walks a stable book.
{
  const total = await reader.evaluate(() => window.__ritoController.reader.spreads.length);
  for (let s = 0; s < total; s += 1) {
    await reader.keyboard.press('ArrowRight');
    await reader.waitForTimeout(45);
  }
  await reader.waitForTimeout(1500);
  const settledTotal = await reader.evaluate(() => window.__ritoController.reader.spreads.length);
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
let plan = await readPlan();
const pageW = Math.round(plan.pageBounds.width);
const pageH = Math.round(plan.pageBounds.height);
const contentW = pageW - 2 * MARGIN;
const contentH = pageH - 2 * MARGIN;
console.log(
  `pages ${plan.pageCount}, page ${pageW}x${pageH}, content ${contentW}x${contentH}, chapters ${plan.chapters.length}`,
);
let pageAt = new Map(plan.pages.map((p) => [p.page, p]));

// Walk every spread once, screenshot the canvas, crop out both pages.
const canvas = reader.locator('[data-testid=reader-shell] canvas').first();
const enginePages = new Map();
const TAP_PAGE = process.env.RITO_WALK_TAP ? Number(process.env.RITO_WALK_TAP) : undefined;
if (TAP_PAGE !== undefined) {
  // Record the organic paint pass of each spread as the walk reaches it:
  // a full-canvas paintPage opens a pass and resets the log, so after a
  // spread settles the log holds exactly its last complete paint.
  await reader.evaluate(() => {
    const scope = globalThis;
    scope.__ritoTapLog = [];
    let dx = 0;
    scope.__ritoPaintTap = (c, onScreen) => {
      if (!onScreen) return;
      if (c.kind === 'paintPage' && (c.rect?.width ?? 0) > 1400) {
        scope.__ritoTapLog.length = 0;
        dx = 0;
      }
      if (c.kind === 'transform') {
        for (const t of c.transforms ?? []) if (t.kind === 'translate') dx = t.dx;
      } else if (c.rect) {
        scope.__ritoTapLog.push({
          dx,
          kind: c.kind,
          x: c.rect.x,
          y: c.rect.y,
          w: c.rect.width,
          h: c.rect.height,
          text: (c.text ?? '').slice(0, 12),
        });
      }
    };
  });
}
const tapSpread = async (spreadIndex) => {
  const at = plan.pages.find((p) => p.page === TAP_PAGE && p.spread === spreadIndex);
  if (!at) return;
  const log = await reader.evaluate(
    (want) => (globalThis.__ritoTapLog ?? []).filter((t) => t.dx === want),
    at.side === 'left' ? 0 : 760,
  );
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
  await reader.waitForFunction(
    () =>
      document.querySelector('[data-testid=reader-shell]')?.dataset.paginationComplete === 'true',
    { timeout: 300000 },
  );
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
    return `${r.pages.length}|${[...r.chapterMap.entries()]
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
// PAGE JavaScript stays OFF: the engine (like EPUB readers generally)
// never executes book scripts, but a file:// chapter runs them — a
// publisher's notereplace.js swapped the footnote-marker image for a
// 【注】 text link and every note-bearing paragraph rewrapped
// (Playwright's evaluate still works; only the page's own scripts stop).
const truthContext = await browser.newContext({
  viewport: { width: contentW + 200, height: contentH },
  deviceScaleFactor: 1,
  javaScriptEnabled: false,
});
const truth = await truthContext.newPage();
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
      const xmlBroken = await truth.evaluate(() =>
        Boolean(document.querySelector('parsererror')),
      );
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
    await truth.evaluate(
      async ({ contentW, contentH, pinLatin, pinCjk, noteIds }) => {
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
        s.textContent = `@font-face { font-family: "__rito_pin_latin"; src: url("${pinLatin}"); }
@font-face { font-family: "__rito_pin_cjk"; src: url("${pinCjk}"); }
html { margin:0; padding:0; width:${contentW}px; height:${contentH}px; column-width:${contentW}px; column-gap:3000px; column-fill:auto; }
body { margin:0; padding:0; }
img, svg { max-width: 100%; }`;
        document.head.insertBefore(s, document.head.firstChild);
        // Reader UA policy mirror (rito-inline image_display_size), in
        // two aspect-preserving halves: the WIDTH cap is the plain
        // `max-width: 100%` above (a replaced element never exceeds its
        // container; Blink shrinks the auto cross axis with it), and the
        // HEIGHT clamp is applied per element below, scaling the measured
        // box uniformly. The old blanket `max-height !important` squashed
        // every author-width oversized image the same way the engine's
        // old axis-independent clamp did, and the diff went blind to the
        // whole class (b52's stretched cover scored bf=2). Measure every
        // replaced box under the book's own CSS first, then pin the
        // scaled sizes, so reflow from one fix cannot skew the next
        // measurement.
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
            return { el, width: rect.width, height: rect.height };
          });
          for (const { el, width, height } of fits) {
            if (!(width > 0) || !(height > 0)) continue;
            const scale = contentH / height;
            if (scale >= 1) continue;
            el.style.setProperty('width', `${width * scale}px`, 'important');
            el.style.setProperty('height', `${contentH}px`, 'important');
          }
        }
        // A 404'd pin silently falls back to the browser's own font and
        // the whole page reads as a defect — assert both faces resolved.
        await document.fonts.load('16px "__rito_pin_latin"', 'H');
        await document.fonts.load('16px "__rito_pin_cjk"', '试');
        await document.fonts.ready;
        for (const name of ['__rito_pin_latin', '__rito_pin_cjk']) {
          const face = [...document.fonts].find((f) => f.family === name);
          if (face?.status !== 'loaded') {
            throw new Error(`pinned face ${name} did not load (${face?.status ?? 'absent'})`);
          }
        }
        // Mirror the engine's paint family rewrite exactly
        // (PaintFamilyPolicy): named families the engine cannot resolve
        // are DROPPED (the browser's UA default "Times" included — the
        // engine's default is the generic, which its policy maps to the
        // pins), the pin aliases ride ahead of the first generic keyword,
        // and the stack keeps a generic tail.
        const generic = new Set([
          'serif',
          'sans-serif',
          'monospace',
          'cursive',
          'fantasy',
          'system-ui',
        ]);
        const bookFaces = new Set(
          [...document.fonts]
            .map((face) => face.family.replaceAll('"', '').toLowerCase())
            .filter((name) => !name.startsWith('__rito_pin')),
        );
        const pins = ['"__rito_pin_latin"', '"__rito_pin_cjk"'];
        for (const element of [document.documentElement, ...document.querySelectorAll('*')]) {
          const list = getComputedStyle(element).fontFamily;
          const parts = [];
          let pinsAdded = false;
          for (const raw of list
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name.length > 0)) {
            const lower = raw.replaceAll('"', '').toLowerCase();
            if (generic.has(lower)) {
              if (!pinsAdded) {
                parts.push(...pins);
                pinsAdded = true;
              }
              parts.push(lower);
              continue;
            }
            if (!bookFaces.has(lower)) continue;
            parts.push(raw);
          }
          if (!pinsAdded) parts.push(...pins);
          const tail = parts.at(-1);
          if (tail === undefined || !generic.has(tail)) parts.push('serif');
          element.style.setProperty('font-family', parts.join(', '), 'important');
        }
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
      },
      { contentW, contentH, pinLatin: PIN_LATIN, pinCjk: PIN_CJK, noteIds },
    );
    await truth.waitForTimeout(250);
    // One screenshot per column, scrolled into view — no viewport-width
    // cap on chapter length.
    const columns = [];
    for (let k = 0; k <= expected + 1; k += 1) {
      // The gap must exceed any single line's horizontal overflow: an
      // unbreakable run (61 fullwidth stars) is ~430px wider than the
      // column, and with a 100px gap its tail painted into the NEXT
      // column's screenshot slice as ghost glyphs the engine (which
      // clips at the page edge) never draws.
      const x0 = k * (contentW + 3000);
      const docWidth = await truth.evaluate(() => document.documentElement.scrollWidth);
      if (x0 >= docWidth) break;
      await truth.evaluate((x) => window.scrollTo(x, 0), x0);
      const scrolled = await truth.evaluate(() => window.scrollX);
      const clipX = x0 - scrolled;
      if (clipX + contentW > contentW + 200) break;
      // Capture the right page margin too: an unbreakable line overflows
      // its column and PAINTS across the page's right margin band, which
      // the engine (clipping at the page edge) also shows. A content-wide
      // clip amputated that band and scored the engine's overflow ink as
      // phantom diff. The clip is clamped to the viewport; a clamped last
      // column loses only pixels the composite pads with page ground.
      const clipW = Math.min(contentW + MARGIN, contentW + 200 - clipX);
      columns.push(
        PNG.sync.read(
          await truth.screenshot({
            clip: { x: clipX, y: 0, width: clipW, height: contentH },
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
        for (let x = 0; x < column.width && MARGIN + x < pageW; x += 1) {
          const si = (y * column.width + x) * 4;
          const di = ((MARGIN + y) * pageW + (MARGIN + x)) * 4;
          for (let j = 0; j < 4; j += 1) truthPage.data[di + j] = column.data[si + j];
        }
      }
    }
    let diff = 0;
    // Above the characterized host-raster floor: Chromium's own two CPU
    // raster lanes (canvas 2D vs DOM image/box AA) disagree by at most 13
    // per channel at bilinear ties and AA coverage ramps — seven
    // reproduction models pixel-falsified (task dossier). A defect the
    // engine can act on moves ink, and moved ink exceeds that ceiling.
    let beyondFloor = 0;
    for (let p = 0; p < pageW * pageH; p += 1) {
      const i = p * 4;
      const delta = Math.max(
        Math.abs(engine.data[i] - truthPage.data[i]),
        Math.abs(engine.data[i + 1] - truthPage.data[i + 1]),
        Math.abs(engine.data[i + 2] - truthPage.data[i + 2]),
      );
      if (delta > 0) diff += 1;
      if (delta > 13) beyondFloor += 1;
    }
    results.push({
      chapter: chapter.href,
      pageInChapter: k,
      pageIndex,
      diff,
      beyondFloor,
      drift: truthUsed - enginePageCount,
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
    `- ${String(r.diff).padStart(8)} / ${String(r.beyondFloor).padStart(6)} px — ${r.chapter} page ${r.pageInChapter} (book page ${r.pageIndex})`,
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
const zeroBeyond = results.filter((r) => r.beyondFloor === 0).length;
const totalBeyond = results.reduce((sum, r) => sum + r.beyondFloor, 0);
lines.splice(
  4,
  0,
  `pages compared: ${results.length}; at ZERO diff: ${zero}; worst: ${results[0]?.diff ?? 0} px`,
  `beyond the characterized raster floor (>13/channel): ${totalBeyond} px on ${results.length - zeroBeyond} pages; at ZERO: ${zeroBeyond}`,
);
writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
console.log(lines.slice(0, 30).join('\n'));
console.log(`\nreport: ${path.join(outDir, 'report.md')}`);
