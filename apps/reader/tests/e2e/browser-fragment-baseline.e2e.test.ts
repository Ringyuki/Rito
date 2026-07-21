import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BASELINE_LAYOUT,
  PINNED_FACES,
  pinnedFontBytes,
  readEpubEntry,
  readEpubEntryBytes,
} from './browser-baseline/native-lines';

/**
 * Compares the fragment engine's whole-chapter line output against pinned
 * Chromium rendering the same chapters with the same font bytes at the same
 * content width. The native side is the full production pipeline — parse,
 * Stylo projection, reader-filtered fragment tree, Parley-backed block
 * layout — via the chapter-fragment-probe binary; the browser side is the
 * same pinned capture procedure the frozen-engine baseline uses.
 *
 * Report-first: this spec captures both line sequences, writes the full
 * diff report, and asserts only harness integrity. Thresholds become gates
 * after their independent baseline review.
 */

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../..');
const EPUB_PATH = resolve(WORKSPACE_ROOT, 'packages/rito/tests/fixtures/books/book-01.epub');
const PROBE_BIN = resolve(WORKSPACE_ROOT, 'target/release/examples/chapter-fragment-probe');
const FONTS_DIR = resolve(WORKSPACE_ROOT, 'apps/reader/src/assets/fonts');
const STYLESHEET_SUFFIX = 'Styles/style.css';
const CONTENT_WIDTH =
  BASELINE_LAYOUT.pageWidth - BASELINE_LAYOUT.marginLeft - BASELINE_LAYOUT.marginRight;
const REPORT_DIR = resolve(import.meta.dirname, '../../test-results/browser-baseline');
const CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({
  idref: `Section00${String(index)}.xhtml`,
  href: `Text/Section00${String(index)}.xhtml`,
}));

interface BrowserLine {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
}

interface ProbeLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

test('compares fragment-engine chapter lines against pinned Chromium', async ({ page }) => {
  test.setTimeout(600_000);
  // The book's own @font-face faces bind declared family names to font
  // bytes on both sides. A declared face whose file is missing from the
  // EPUB would send each side to its own system fallback, so the capture
  // procedure pins missing families to the first pinned face instead —
  // identical bytes for the browser and the probe.
  const stylesheetText = await readEpubEntry(EPUB_PATH, STYLESHEET_SUFFIX);
  const namedFonts: { family: string; path: string }[] = [];
  const missingFamilies: string[] = [];
  const fontFaceRe =
    /@font-face\s*\{[^}]*font-family:\s*"?([^";}]+)"?\s*;[^}]*url\("?\.\.\/(Fonts\/[^")]+)"?\)/gi;
  const fallbackFace = PINNED_FACES[0];
  const fallbackPath = resolve(FONTS_DIR, fallbackFace.fileName);
  for (const match of stylesheetText.matchAll(fontFaceRe)) {
    const family = (match[1] ?? '').trim();
    const suffix = match[2] ?? '';
    if (!family || !suffix) continue;
    const filePath = join(tmpdir(), `rito-bookfont-${family.replace(/[^\w-]/g, '_')}`);
    try {
      writeFileSync(filePath, await readEpubEntryBytes(EPUB_PATH, suffix));
      namedFonts.push({ family, path: filePath });
    } catch {
      missingFamilies.push(family);
      namedFonts.push({ family, path: fallbackPath });
    }
  }
  const probeStdout = execFileSync(PROBE_BIN, [], {
    input: JSON.stringify({
      epubPath: EPUB_PATH,
      fontPaths: PINNED_FACES.map((face) => resolve(FONTS_DIR, face.fileName)),
      namedFonts,
      contentWidthPx: CONTENT_WIDTH,
      chapterIdrefs: CHAPTERS.map((chapter) => chapter.idref),
    }),
    maxBuffer: 256 * 1024 * 1024,
    encoding: 'utf8',
  });
  const probe = (
    JSON.parse(probeStdout) as {
      chapters: { idref: string; error?: string; lines: ProbeLine[] }[];
    }
  ).chapters;
  // A chapter the engine explicitly rejects (capability whitelist) is
  // recorded and skipped: the rejection is the honest signal, and the
  // remaining chapters still measure. Silent mis-layout is impossible;
  // blocked chapters shrink this list as capabilities land.
  const blockedChapters = probe
    .filter((chapter) => chapter.error !== undefined)
    .map((chapter) => ({ chapter: chapter.idref, reason: chapter.error ?? '' }));
  const measurable = probe.filter((chapter) => chapter.error === undefined);
  for (const chapter of measurable) {
    expect(chapter.lines.length).toBeGreaterThan(20);
  }
  // 5 of book-01's 8 body chapters carry noteref <sup> content and wait
  // on vertical-align support; the whitelist keeps them visible in
  // blockedChapters instead of silently mis-laying them.
  expect(measurable.length).toBeGreaterThan(2);

  const [stylesheet, fonts] = await Promise.all([
    readEpubEntry(EPUB_PATH, STYLESHEET_SUFFIX),
    pinnedFontBytes(),
  ]);
  await page.route('**/__rito_pinned/*', (route) => {
    const sha = route.request().url().split('/').at(-1) ?? '';
    const bytes = fonts.get(sha);
    if (!bytes) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'font/otf', body: bytes });
  });
  await page.route('**/__rito_epub/**', async (route) => {
    const suffix = route.request().url().split('/__rito_epub/').at(-1) ?? '';
    try {
      const bytes = await readEpubEntryBytes(EPUB_PATH, decodeURIComponent(suffix));
      await route.fulfill({ status: 200, body: bytes });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  // The oracle page must live on an http origin: root-relative resource URLs
  // never become network requests on about:blank.
  let currentPageHtml = '';
  await page.route('http://rito-baseline.test/chapter', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: currentPageHtml }),
  );
  await page.setViewportSize({ width: 800, height: 700 });

  const chapterReports: {
    chapter: string;
    summary: ReturnType<typeof compareLines>['summary'];
    divergences: ReturnType<typeof compareLines>['divergences'];
  }[] = [];
  for (const chapter of CHAPTERS) {
    const probeChapter = probe.find((entry) => entry.idref === chapter.idref);
    if (!probeChapter || probeChapter.error !== undefined) continue;
    // Image-only lines carry no text for the browser capture (it walks text
    // nodes) to see; their geometry belongs to the pixel oracle, so the
    // line comparison stays text-symmetric.
    const nativeLines = probeChapter.lines.filter((line) => line.text.trim().length > 0);
    const chapterXhtml = await readEpubEntry(EPUB_PATH, chapter.href);
    const body = applyReaderUaSemantics(extractBody(chapterXhtml));
    currentPageHtml = baselinePageHtml(body, stylesheet, missingFamilies);
    await page.goto('http://rito-baseline.test/chapter', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const browserLines = await page.evaluate(captureBrowserLines);
    const report = compareLines(nativeLines, browserLines);
    chapterReports.push({
      chapter: chapter.href,
      summary: report.summary,
      divergences: report.divergences,
    });
  }

  const totals = chapterReports.reduce(
    (accumulator, entry) => ({
      nativeLines: accumulator.nativeLines + entry.summary.nativeLineCount,
      matches: accumulator.matches + entry.summary.alignedMatches,
      nativeOnly: accumulator.nativeOnly + entry.summary.nativeOnlyLines,
      browserOnly: accumulator.browserOnly + entry.summary.browserOnlyLines,
    }),
    { nativeLines: 0, matches: 0, nativeOnly: 0, browserOnly: 0 },
  );
  const allX = chapterReports.flatMap((entry) => entry.summary.xDeltas);
  const allY = chapterReports.flatMap((entry) => entry.summary.yDeltas);
  const allWidth = chapterReports.flatMap((entry) => entry.summary.widthDeltas);
  const corpusSummary = {
    chapters: chapterReports.length,
    blockedChapters,
    ...totals,
    lineBreakParity: totals.nativeLines === 0 ? 0 : totals.matches / totals.nativeLines,
    xDeltaPx: percentiles(allX),
    yDeltaPx: percentiles(allY),
    widthDeltaPx: percentiles(allWidth),
    perChapter: chapterReports.map((entry) => ({
      chapter: entry.chapter,
      parity: entry.summary.lineBreakParity,
      nativeOnly: entry.summary.nativeOnlyLines,
      browserOnly: entry.summary.browserOnlyLines,
      xDeltaPx: percentiles(entry.summary.xDeltas),
      yDeltaPx: percentiles(entry.summary.yDeltas),
      widthDeltaPx: percentiles(entry.summary.widthDeltas),
    })),
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'book-01-fragment-baseline.json'),
    JSON.stringify(
      { fixture: 'book-01', layout: BASELINE_LAYOUT, corpusSummary, chapterReports },
      null,
      2,
    ),
  );
  console.log(`Rito fragment-engine baseline (book-01)\n${JSON.stringify(corpusSummary, null, 2)}`);
  expect(chapterReports.length + blockedChapters.length).toBe(CHAPTERS.length);
});

function baselinePageHtml(
  body: string,
  stylesheet: string,
  missingFamilies: readonly string[],
): string {
  const faces = PINNED_FACES.map(
    (face) => `@font-face {
  font-family: '__RitoPinned_${face.expectedSha256}';
  src: url('/__rito_pinned/${face.expectedSha256}');
}`,
  ).join('\n');
  const stack = PINNED_FACES.map((face) => `'__RitoPinned_${face.expectedSha256}'`).join(', ');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${faces}
html { font-family: ${stack}, serif; font-size: ${String(BASELINE_LAYOUT.rootFontSize)}px; }
body { margin: 0; }
#rito-content { width: ${String(CONTENT_WIDTH)}px; }
</style><style>
${stylesheet}
</style><style>
${missingFamilies
  .map(
    (family) => `@font-face {
  font-family: '${family}';
  src: url('/__rito_pinned/${PINNED_FACES[0].expectedSha256}');
}`,
  )
  .join('\n')}
</style></head><body><div id="rito-content">${body}</div></body></html>`;
}

function extractBody(xhtml: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(xhtml);
  const body = match?.[1];
  if (body === undefined) throw new Error('Chapter XHTML has no body element');
  return body;
}

/**
 * Part of the pinned capture procedure: the oracle renders what a reader
 * renders. Footnote asides leave the flow (they open as popups), and chapter
 * resource references resolve to the real EPUB bytes instead of 404 fallback
 * boxes whose sizes are browser-internal.
 */
function applyReaderUaSemantics(body: string): string {
  return body
    .replace(/<aside[^>]*epub:type="footnote"[\s\S]*?<\/aside>/gi, '')
    .replace(/(src|href)="\.\.\/(Images|Styles|Fonts)\//gi, '$1="/__rito_epub/$2/');
}

function captureBrowserLines(): BrowserLine[] {
  const container = document.getElementById('rito-content');
  if (!container) throw new Error('baseline container missing');
  const origin = container.getBoundingClientRect();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  interface Fragment {
    top: number;
    bottom: number;
    left: number;
    right: number;
    text: string;
  }
  const fragments: Fragment[] = [];
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? '';
    let current: Fragment | undefined;
    for (let index = 0; index < value.length; index += 1) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getClientRects()[0];
      if (!rect || rect.width === 0) continue;
      const glyph = value[index] ?? '';
      if (current && Math.abs(rect.top - current.top) <= 1.5) {
        current.text += glyph;
        current.right = Math.max(current.right, rect.right);
        current.bottom = Math.max(current.bottom, rect.bottom);
        current.left = Math.min(current.left, rect.left);
      } else {
        if (current) fragments.push(current);
        current = {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          text: glyph,
        };
      }
    }
    if (current) fragments.push(current);
  }
  fragments.sort((left, right) => left.top - right.top || left.left - right.left);
  const lines: Fragment[] = [];
  for (const fragment of fragments) {
    const line = lines.at(-1);
    if (line && Math.abs(fragment.top - line.top) <= 1.5) {
      line.text += fragment.text;
      line.right = Math.max(line.right, fragment.right);
      line.bottom = Math.max(line.bottom, fragment.bottom);
      line.left = Math.min(line.left, fragment.left);
    } else {
      lines.push({ ...fragment });
    }
  }
  return lines.map((line) => ({
    x: line.left - origin.left,
    y: line.top - origin.top,
    width: line.right - line.left,
    height: line.bottom - line.top,
    text: line.text,
  }));
}

function compareLines(native: readonly ProbeLine[], browser: readonly BrowserLine[]) {
  const normalize = (text: string): string =>
    text
      .replace(/[\u200b\u00ad]/g, '')
      .replace(/\u00a0/g, ' ')
      .trim();
  const nativeTexts = native.map((line) => normalize(line.text));
  const browserTexts = browser.map((line) => normalize(line.text));
  // Longest-common-subsequence alignment: one shifted break must not
  // misalign the comparison of every later line.
  const aligned = alignSequences(nativeTexts, browserTexts);
  const divergences: { nativeIndex: number; native: string; browser: string }[] = [];
  const xDeltas: number[] = [];
  const yDeltas: number[] = [];
  const widthDeltas: number[] = [];
  let nativeOnly = 0;
  let browserOnly = 0;
  for (const pair of aligned) {
    if (pair.kind === 'match') {
      const nativeLine = native[pair.nativeIndex];
      const browserLine = browser[pair.browserIndex];
      if (nativeLine && browserLine) {
        xDeltas.push(Math.abs(nativeLine.x - browserLine.x));
        yDeltas.push(Math.abs(nativeLine.y - browserLine.y));
        widthDeltas.push(Math.abs(nativeLine.width - browserLine.width));
      }
      continue;
    }
    if (pair.kind === 'nativeOnly') {
      nativeOnly += 1;
      if (divergences.length < 30) {
        divergences.push({
          nativeIndex: pair.nativeIndex,
          native: nativeTexts[pair.nativeIndex] ?? '',
          browser: '(no aligned browser line)',
        });
      }
    } else {
      browserOnly += 1;
      if (divergences.length < 30) {
        divergences.push({
          nativeIndex: -1,
          native: '(no aligned native line)',
          browser: browserTexts[pair.browserIndex] ?? '',
        });
      }
    }
  }
  return {
    summary: {
      nativeLineCount: native.length,
      browserLineCount: browser.length,
      alignedMatches: xDeltas.length,
      nativeOnlyLines: nativeOnly,
      browserOnlyLines: browserOnly,
      lineBreakParity: native.length === 0 ? 0 : xDeltas.length / native.length,
      xDeltas,
      yDeltas,
      widthDeltas,
    },
    divergences,
  };
}

type AlignedPair =
  | { kind: 'match'; nativeIndex: number; browserIndex: number }
  | { kind: 'nativeOnly'; nativeIndex: number }
  | { kind: 'browserOnly'; browserIndex: number };

function alignSequences(left: readonly string[], right: readonly string[]): AlignedPair[] {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const lengths = new Uint32Array(rows * cols);
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let col = right.length - 1; col >= 0; col -= 1) {
      lengths[row * cols + col] =
        left[row] === right[col]
          ? (lengths[(row + 1) * cols + col + 1] ?? 0) + 1
          : Math.max(lengths[(row + 1) * cols + col] ?? 0, lengths[row * cols + col + 1] ?? 0);
    }
  }
  const pairs: AlignedPair[] = [];
  let row = 0;
  let col = 0;
  while (row < left.length && col < right.length) {
    if (left[row] === right[col]) {
      pairs.push({ kind: 'match', nativeIndex: row, browserIndex: col });
      row += 1;
      col += 1;
    } else if ((lengths[(row + 1) * cols + col] ?? 0) >= (lengths[row * cols + col + 1] ?? 0)) {
      pairs.push({ kind: 'nativeOnly', nativeIndex: row });
      row += 1;
    } else {
      pairs.push({ kind: 'browserOnly', browserIndex: col });
      col += 1;
    }
  }
  for (; row < left.length; row += 1) pairs.push({ kind: 'nativeOnly', nativeIndex: row });
  for (; col < right.length; col += 1) pairs.push({ kind: 'browserOnly', browserIndex: col });
  return pairs;
}

function percentiles(values: readonly number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    p50: Number(at(0.5).toFixed(3)),
    p95: Number(at(0.95).toFixed(3)),
    max: Number((sorted.at(-1) ?? 0).toFixed(3)),
  };
}
