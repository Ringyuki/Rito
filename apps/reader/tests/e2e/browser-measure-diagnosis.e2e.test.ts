import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BASELINE_LAYOUT,
  openBaselineDocument,
  PINNED_FACES,
  pinnedFontBytes,
} from './browser-baseline/native-lines';

/**
 * Root-cause layer probe for the corpus divergence clusters: renders each
 * divergent native line as a single unwrapped run in pinned Chromium and
 * compares its width against the native line-box width. A large delta means
 * the two engines measure text differently (a font/shaping defect worth
 * fixing, since measurement outlives any one layout engine); a near-zero
 * delta means measurement agrees and only the line-break policy differs.
 */

const EPUB_PATH = resolve(
  import.meta.dirname,
  '../../../../packages/rito/tests/fixtures/books/book-01.epub',
);
const REPORT_DIR = resolve(import.meta.dirname, '../../test-results/browser-baseline');

/** One divergent native line per cluster, identified by a unique substring. */
const PROBES = [
  { cluster: 'katakana-interpunct', chapter: 'Text/Section008.xhtml', needle: 'カルロ' },
  { cluster: 'closing-punct-9点', chapter: 'Text/Section004.xhtml', needle: '这都已经9点了' },
  { cluster: 'closing-punct-700日', chapter: 'Text/Section005.xhtml', needle: '欸？700日' },
  { cluster: 'closing-punct-一口咬', chapter: 'Text/Section008.xhtml', needle: '（一口咬' },
] as const;

test('attributes divergence clusters to measurement vs break policy', async ({ page }) => {
  test.setTimeout(240_000);
  const baselineDocument = await openBaselineDocument(EPUB_PATH);
  const fonts = await pinnedFontBytes();

  const samples: { cluster: string; text: string; nativeWidth: number }[] = [];
  for (const probe of PROBES) {
    const lines = baselineDocument.extractChapterLines(probe.chapter).lines;
    const line = lines.find((candidate) => candidate.text.includes(probe.needle));
    expect(line, `${probe.cluster}: divergent line not found`).toBeDefined();
    if (line) samples.push({ cluster: probe.cluster, text: line.text, nativeWidth: line.width });
  }

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
body { margin: 0; width: 4000px; }
span.probe { white-space: nowrap; }
</style></head><body></body></html>`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  const measured = await page.evaluate(
    (texts: readonly string[]) => {
      return texts.map((text) => {
        const span = document.createElement('span');
        span.className = 'probe';
        span.textContent = text;
        document.body.appendChild(span);
        const width = span.getBoundingClientRect().width;
        // Per-character prefix advances for follow-up localization.
        const range = document.createRange();
        const node = span.firstChild;
        const advances: number[] = [];
        if (node) {
          for (let index = 0; index < text.length; index += 1) {
            range.setStart(node, 0);
            range.setEnd(node, index + 1);
            advances.push(range.getBoundingClientRect().width);
          }
        }
        span.remove();
        return { width, advances };
      });
    },
    samples.map((sample) => sample.text),
  );

  const verdicts = samples.map((sample, index) => {
    const browserWidth = measured[index]?.width ?? 0;
    const deltaPx = sample.nativeWidth - browserWidth;
    return {
      cluster: sample.cluster,
      text: sample.text,
      nativeWidth: sample.nativeWidth,
      browserWidth,
      deltaPx,
      layer: Math.abs(deltaPx) <= 2 ? 'break-policy' : 'measurement',
      prefixAdvances: measured[index]?.advances ?? [],
    };
  });

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    resolve(REPORT_DIR, 'divergence-layer-diagnosis.json'),
    JSON.stringify(verdicts, null, 2),
  );
  console.log(
    `Rito divergence layer diagnosis\n${JSON.stringify(
      verdicts.map(({ prefixAdvances: _unused, ...rest }) => rest),
      null,
      2,
    )}`,
  );
});
