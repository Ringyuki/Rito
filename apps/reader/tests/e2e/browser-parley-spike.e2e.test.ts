import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BASELINE_LAYOUT,
  PINNED_FACES,
  pinnedFontBytes,
  readEpubEntry,
} from './browser-baseline/native-lines';

/**
 * Measures the Parley-backed inline provider against pinned Chromium on
 * every plain paragraph of the fixture book. Both sides receive identical
 * inputs — the same font bytes, size, first-line indent, and content-width
 * advance — so the parity number isolates the line-break algorithm, and the
 * per-line ink geometry (first-glyph x, trailing-whitespace-free width)
 * isolates measurement. Report-first: geometry deltas are recorded, not
 * gated, until their independent baseline review.
 */

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../..');
const EPUB_PATH = resolve(WORKSPACE_ROOT, 'packages/rito/tests/fixtures/books/book-01.epub');
const SPIKE_BIN = resolve(WORKSPACE_ROOT, 'target/release/rito-inline-spike');
const FONTS_DIR = resolve(WORKSPACE_ROOT, 'apps/reader/src/assets/fonts');
const REPORT_DIR = resolve(import.meta.dirname, '../../test-results/browser-baseline');
const CONTENT_WIDTH =
  BASELINE_LAYOUT.pageWidth - BASELINE_LAYOUT.marginLeft - BASELINE_LAYOUT.marginRight;
const INDENT_PX = 2 * BASELINE_LAYOUT.rootFontSize;
const CHAPTERS = [
  'Text/Section001.xhtml',
  'Text/Section002.xhtml',
  'Text/Section003.xhtml',
  'Text/Section004.xhtml',
  'Text/Section005.xhtml',
  'Text/Section006.xhtml',
  'Text/Section007.xhtml',
  'Text/Section008.xhtml',
];

test('measures Parley line-break parity against pinned Chromium', async ({ page }) => {
  test.setTimeout(600_000);
  const paragraphs: string[] = [];
  for (const chapter of CHAPTERS) {
    const xhtml = await readEpubEntry(EPUB_PATH, chapter);
    for (const paragraph of extractPlainParagraphs(xhtml)) paragraphs.push(paragraph);
  }
  expect(paragraphs.length).toBeGreaterThan(500);

  const fonts = await pinnedFontBytes();
  await page.route('**/__rito_pinned/*', (route) => {
    const sha = route.request().url().split('/').at(-1) ?? '';
    const bytes = fonts.get(sha);
    if (!bytes) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'font/otf', body: bytes });
  });
  const faces = PINNED_FACES.map(
    (face) => `@font-face {
  font-family: '__RitoPinned_${face.expectedSha256}';
  src: url('/__rito_pinned/${face.expectedSha256}');
}`,
  ).join('\n');
  const stack = PINNED_FACES.map((face) => `'__RitoPinned_${face.expectedSha256}'`).join(', ');
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
${faces}
html { font-family: ${stack}, serif; font-size: ${String(BASELINE_LAYOUT.rootFontSize)}px; }
body { margin: 0; }
#rito-content { width: ${String(CONTENT_WIDTH)}px; }
#rito-content p { margin: 0; text-indent: ${String(INDENT_PX)}px; }
</style></head><body><div id="rito-content"></div></body></html>`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  const browserLines = await page.evaluate(captureParagraphLines, paragraphs);

  const spikeRequest = JSON.stringify({
    fontPaths: PINNED_FACES.map((face) => resolve(FONTS_DIR, face.fileName)),
    fontSizePx: BASELINE_LAYOUT.rootFontSize,
    maxAdvancePx: CONTENT_WIDTH,
    paragraphs: paragraphs.map((text) => ({ text, firstLineIndentPx: INDENT_PX })),
  });
  const spikeStdout = execFileSync(SPIKE_BIN, [], {
    input: spikeRequest,
    maxBuffer: 256 * 1024 * 1024,
    encoding: 'utf8',
  });
  const parleyLines = (
    JSON.parse(spikeStdout) as {
      paragraphs: { text: string; x: number; width: number }[][];
    }
  ).paragraphs;

  let matchingParagraphs = 0;
  let totalBrowserLines = 0;
  let matchingLines = 0;
  const xDeltas: number[] = [];
  const widthDeltas: number[] = [];
  const divergences: { paragraph: string; browser: string[]; parley: string[] }[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const browser = browserLines[index] ?? [];
    const parley = parleyLines[index] ?? [];
    const browserTexts = browser.map((line) => normalize(line.text));
    const parleyTexts = parley.map((line) => normalize(line.text));
    totalBrowserLines += browser.length;
    const identical =
      browserTexts.length === parleyTexts.length &&
      browserTexts.every((line, lineIndex) => line === parleyTexts[lineIndex]);
    if (identical) {
      matchingParagraphs += 1;
      matchingLines += browser.length;
      for (let lineIndex = 0; lineIndex < browser.length; lineIndex += 1) {
        const browserLine = browser[lineIndex];
        const parleyLine = parley[lineIndex];
        if (!browserLine || !parleyLine) continue;
        xDeltas.push(Math.abs(browserLine.left - parleyLine.x));
        widthDeltas.push(Math.abs(browserLine.width - parleyLine.width));
      }
    } else if (divergences.length < 40) {
      divergences.push({
        paragraph: paragraphs[index] ?? '',
        browser: browserTexts,
        parley: parleyTexts,
      });
    }
  }

  const summary = {
    chapters: CHAPTERS.length,
    paragraphs: paragraphs.length,
    matchingParagraphs,
    paragraphParity: matchingParagraphs / paragraphs.length,
    browserLines: totalBrowserLines,
    matchingLines,
    geometry: {
      comparedLines: xDeltas.length,
      xDeltaP50: percentile(xDeltas, 0.5),
      xDeltaP95: percentile(xDeltas, 0.95),
      xDeltaMax: percentile(xDeltas, 1),
      widthDeltaP50: percentile(widthDeltas, 0.5),
      widthDeltaP95: percentile(widthDeltas, 0.95),
      widthDeltaMax: percentile(widthDeltas, 1),
    },
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'parley-spike-parity.json'),
    JSON.stringify({ summary, divergences }, null, 2),
  );
  console.log(`Rito Parley spike parity\n${JSON.stringify(summary, null, 2)}`);
});

function extractPlainParagraphs(xhtml: string): string[] {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(xhtml)?.[1] ?? '';
  const withoutAsides = body.replace(/<aside[^>]*epub:type="footnote"[\s\S]*?<\/aside>/gi, '');
  const paragraphs: string[] = [];
  for (const match of withoutAsides.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const inner = match[1] ?? '';
    if (/<img/i.test(inner)) continue; // inline replaced elements are a separate probe
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 8) paragraphs.push(text);
  }
  return paragraphs;
}

function normalize(text: string): string {
  return text
    .replace(/[\u200b\u00ad]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

interface CapturedLine {
  text: string;
  /** First non-whitespace glyph left edge, paragraph-relative CSS px. */
  left: number;
  /** Ink width: last non-whitespace right edge minus `left`. */
  width: number;
}

function captureParagraphLines(texts: readonly string[]): CapturedLine[][] {
  const container = document.getElementById('rito-content');
  if (!container) throw new Error('spike container missing');
  const results: CapturedLine[][] = [];
  const range = document.createRange();
  for (const text of texts) {
    container.textContent = '';
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    container.appendChild(paragraph);
    const origin = paragraph.getBoundingClientRect().left;
    const node = paragraph.firstChild;
    const lines: { top: number; text: string; left: number; right: number }[] = [];
    if (node) {
      const value = node.nodeValue ?? '';
      for (let index = 0; index < value.length; index += 1) {
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getClientRects()[0];
        if (!rect || rect.width === 0) continue;
        const glyph = value[index] ?? '';
        const isInk = glyph.trim().length > 0;
        const line = lines.at(-1);
        if (line && Math.abs(rect.top - line.top) <= 1.5) {
          line.text += glyph;
          if (isInk) {
            line.left = Math.min(line.left, rect.left - origin);
            line.right = Math.max(line.right, rect.right - origin);
          }
        } else {
          lines.push({
            top: rect.top,
            text: glyph,
            left: isInk ? rect.left - origin : Number.POSITIVE_INFINITY,
            right: isInk ? rect.right - origin : Number.NEGATIVE_INFINITY,
          });
        }
      }
    }
    results.push(
      lines.map((line) => ({
        text: line.text,
        left: line.left,
        width: Math.max(0, line.right - line.left),
      })),
    );
  }
  container.textContent = '';
  return results;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return Number((sorted[Math.max(0, index)] ?? 0).toFixed(3));
}
