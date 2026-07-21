import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BASELINE_LAYOUT,
  extractNativeChapterLines,
  PINNED_FACES,
  pinnedFontBytes,
  readEpubEntry,
  type NativeLine,
} from './browser-baseline/native-lines';

/**
 * Round 5 browser-baseline harness, first increment: pinned-Chromium line
 * geometry against the native layout for one dense fixture chapter.
 *
 * The browser is the only baseline. This spec is report-first: it captures
 * both line sequences, writes the full diff report, and asserts only harness
 * integrity. Thresholds become gates after their independent baseline review.
 */

const EPUB_PATH = resolve(
  import.meta.dirname,
  '../../../../packages/rito/tests/fixtures/books/book-01.epub',
);
const CHAPTER_SUFFIX = 'Text/Section001.xhtml';
const STYLESHEET_SUFFIX = 'Styles/style.css';
const CONTENT_WIDTH =
  BASELINE_LAYOUT.pageWidth - BASELINE_LAYOUT.marginLeft - BASELINE_LAYOUT.marginRight;
const REPORT_DIR = resolve(import.meta.dirname, '../../test-results/browser-baseline');

interface BrowserLine {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
}

test('captures pinned-Chromium line baseline for Section001 and reports native parity', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const native = await extractNativeChapterLines(EPUB_PATH, CHAPTER_SUFFIX);
  expect(native.lines.length).toBeGreaterThan(200);

  const [chapterXhtml, stylesheet, fonts] = await Promise.all([
    readEpubEntry(EPUB_PATH, CHAPTER_SUFFIX),
    readEpubEntry(EPUB_PATH, STYLESHEET_SUFFIX),
    pinnedFontBytes(),
  ]);
  const body = extractBody(chapterXhtml);

  await page.route('**/__rito_pinned/*', (route) => {
    const sha = route.request().url().split('/').at(-1) ?? '';
    const bytes = fonts.get(sha);
    if (!bytes) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'font/otf', body: bytes });
  });
  await page.setViewportSize({ width: 800, height: 700 });
  await page.setContent(baselinePageHtml(body, stylesheet), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  const browserLines = await page.evaluate(captureBrowserLines);
  expect(browserLines.length).toBeGreaterThan(200);

  const report = compareLines(native.lines, browserLines, native.rubyCommandCount);
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'section001-line-baseline.json'),
    JSON.stringify(
      { fixture: 'book-01', chapter: native.chapterHref, layout: BASELINE_LAYOUT, ...report },
      null,
      2,
    ),
  );
  console.log(
    `Rito browser line baseline (Section001)\n${JSON.stringify(report.summary, null, 2)}`,
  );
});

function baselinePageHtml(body: string, stylesheet: string): string {
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
</style></head><body><div id="rito-content">${body}</div></body></html>`;
}

function extractBody(xhtml: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(xhtml);
  const body = match?.[1];
  if (body === undefined) throw new Error('Chapter XHTML has no body element');
  return body;
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

function compareLines(
  native: readonly NativeLine[],
  browser: readonly BrowserLine[],
  rubyCommandCount: number,
) {
  const normalize = (text: string): string =>
    text
      .replace(/[\u200b\u00ad]/g, '')
      .replace(/\u00a0/g, ' ')
      .trim();
  const nativeTexts = native.map((line) => normalize(line.text));
  const browserTexts = browser.map((line) => normalize(line.text));
  const compared = Math.min(nativeTexts.length, browserTexts.length);
  let matchingLines = 0;
  let firstDivergence: number | undefined;
  const divergences: { index: number; native: string; browser: string }[] = [];
  for (let index = 0; index < compared; index += 1) {
    if (nativeTexts[index] === browserTexts[index]) {
      matchingLines += 1;
      continue;
    }
    firstDivergence ??= index;
    if (divergences.length < 20) {
      divergences.push({
        index,
        native: nativeTexts[index] ?? '',
        browser: browserTexts[index] ?? '',
      });
    }
  }
  const xDeltas: number[] = [];
  const widthDeltas: number[] = [];
  for (let index = 0; index < compared; index += 1) {
    const nativeLine = native[index];
    const browserLine = browser[index];
    if (!nativeLine || !browserLine || nativeTexts[index] !== browserTexts[index]) continue;
    xDeltas.push(Math.abs(nativeLine.x - browserLine.x));
    widthDeltas.push(Math.abs(nativeLine.width - browserLine.width));
  }
  return {
    summary: {
      nativeLineCount: native.length,
      browserLineCount: browser.length,
      comparedLines: compared,
      matchingLineBreaks: matchingLines,
      lineBreakParity: compared === 0 ? 0 : matchingLines / compared,
      firstDivergenceIndex: firstDivergence ?? null,
      rubyCommandCount,
      xDeltaPx: percentiles(xDeltas),
      widthDeltaPx: percentiles(widthDeltas),
    },
    divergences,
  };
}

function percentiles(values: readonly number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 };
}
