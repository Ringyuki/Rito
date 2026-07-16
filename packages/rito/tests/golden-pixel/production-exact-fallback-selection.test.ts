import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import type {
  ChapterTextIndex,
  Reader,
  ReaderExactSourceRangeRequest,
  ReaderOptions,
} from '../../src';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { startPixelRenderServer, type PixelRenderServer } from './helpers/render-server';
import { requireSfntFallbackFixtureCoverage } from './helpers/sfnt-cmap';

interface ExactFallbackApi {
  createReader(
    data: ArrayBuffer,
    canvas: HTMLCanvasElement,
    options: ReaderOptions,
  ): Promise<Reader>;
}

interface GeometrySample {
  readonly text: string;
  readonly selectedText: string;
  readonly sourceOrigin: 'search' | 'chapterIndex';
  readonly rectCount: number;
  readonly exactWidth: number;
  readonly canvasWidth: number;
}

interface ExactFallbackProof {
  readonly authorFaceReady: boolean;
  readonly pinnedFaceReady: boolean;
  readonly nonWhitePixelCount: number;
  readonly samples: readonly GeometrySample[];
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const AUTHOR_FONT = archiveFile(
  resolve(TEST_DIR, '../fixtures/books/book-01.epub'),
  'OEBPS/Fonts/illus5.ttf',
);
const PINNED_FONT = archiveFile(
  resolve(TEST_DIR, '../../../../apps/reader/src/assets/demo.epub'),
  'OEBPS/Fonts/title.ttf',
);
const PINNED_SHA256 = createHash('sha256').update(PINNED_FONT).digest('hex');
const PINNED_ALIAS = `__RitoPinned_${PINNED_SHA256}`;
// U+67CA exists only in illus5; U+4E01 exists only in the pinned title face.
const AUTHOR_ONLY = '柊';
const PINNED_ONLY = '丁';
const MIXED_CJK = '柊丁柊七柊万柊世';
const VARIABLE_LATIN = 'WiAV';
const WRAPPED_MIXED = MIXED_CJK.repeat(2);
const SAMPLES = [
  AUTHOR_ONLY,
  PINNED_ONLY,
  `${AUTHOR_ONLY}${PINNED_ONLY}`,
  VARIABLE_LATIN,
  WRAPPED_MIXED,
];
const MAX_WIDTH_DRIFT_PX = 0.05;

test.describe('production exact fallback selection', () => {
  let server: PixelRenderServer | undefined;

  test.beforeAll(async () => {
    server = await startPixelRenderServer();
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test('keeps Rust exact ranges aligned with Canvas across author and pinned fallback faces', async ({
    page,
  }) => {
    if (!server) throw new Error('Pixel render server did not start');
    requireSfntFallbackFixtureCoverage(AUTHOR_FONT, PINNED_FONT, {
      authorOnly: AUTHOR_ONLY,
      pinnedOnly: PINNED_ONLY,
      mixedCjk: MIXED_CJK,
      variableLatin: VARIABLE_LATIN,
    });
    const proof = await readExactFallbackProof(page, server.origin);

    expect(proof.authorFaceReady).toBe(true);
    expect(proof.pinnedFaceReady).toBe(true);
    expect(proof.nonWhitePixelCount).toBeGreaterThan(500);
    expect(proof.samples.map((sample) => sample.text)).toEqual(SAMPLES);
    for (const sample of proof.samples) {
      expect(sample.selectedText).toBe(sample.text);
      expect(sample.rectCount).toBeGreaterThan(0);
      expect(sample.exactWidth).toBeGreaterThan(0);
      expect(Math.abs(sample.exactWidth - sample.canvasWidth)).toBeLessThanOrEqual(
        MAX_WIDTH_DRIFT_PX,
      );
    }
    expect(proof.samples.slice(0, -1).every((sample) => sample.sourceOrigin === 'search')).toBe(
      true,
    );
    expect(proof.samples.at(-1)?.sourceOrigin).toBe('chapterIndex');
    expect(proof.samples.at(-1)?.rectCount).toBeGreaterThan(1);
  });
});

async function readExactFallbackProof(page: Page, origin: string): Promise<ExactFallbackProof> {
  await page.goto(`${origin}/production-parity.html`);
  return await page.evaluate(
    async ({
      authorOnly,
      bookBase64,
      fontBase64,
      pinnedAlias,
      pinnedOnly,
      pinnedSha256,
      samples,
    }) => {
      const modulePath = '/dist/index.mjs';
      const module = (await import(modulePath)) as ExactFallbackApi;
      const canvas = document.createElement('canvas');
      const reader = await module.createReader(decode(bookBase64), canvas, {
        width: 640,
        height: 520,
        margin: 32,
        spread: 'single',
        lineBreaking: 'greedy',
        devicePixelRatio: 1,
        logLevel: 'silent',
        pinnedFontPolicy: {
          schemaVersion: 1,
          faces: [
            {
              bytes: decode(fontBase64),
              expectedSha256: pinnedSha256,
              genericRole: 'serif',
              language: 'zh',
            },
          ],
        },
      });
      try {
        const context = document.createElement('canvas').getContext('2d');
        if (!context) throw new Error('Canvas measurement context is unavailable');
        context.font = `32px "Author", "${pinnedAlias}", serif`;
        await document.fonts.ready;

        const geometry = [] as GeometrySample[];
        if (!reader.search) throw new Error('Production reader search is unavailable');
        for (const text of samples) {
          // Keep the multi-line case on the durable index path independently
          // of the current laid-out-page search tokenization.
          const useChapterIndex = text === samples.at(-1);
          const results = useChapterIndex
            ? []
            : await reader.search(text, { caseSensitive: true, wholeWord: false });
          const source = results.find((result) => result.source?.status === 'resolved')?.source;
          const request =
            source?.status === 'resolved'
              ? { href: source.href, sourceRange: source.sourceRange }
              : sourceRequestFromIndex(reader.getChapterTextIndices(), text);
          const sourceOrigin = source?.status === 'resolved' ? 'search' : 'chapterIndex';
          const resolution = await reader.interactions?.resolveExactSourceRange?.({
            href: request.href,
            sourceRange: request.sourceRange,
          });
          if (!resolution || resolution.status !== 'resolved') {
            throw new Error(`Exact source range is unavailable for ${text}`);
          }
          geometry.push({
            text,
            selectedText: resolution.range.selectedText,
            sourceOrigin,
            rectCount: resolution.range.rects.length,
            exactWidth: resolution.range.rects.reduce((sum, rect) => sum + rect.width, 0),
            canvasWidth: context.measureText(text).width,
          });
        }

        const size = reader.getCanvasSize(1);
        canvas.width = Math.round(size.width);
        canvas.height = Math.round(size.height);
        const renderContext = canvas.getContext('2d');
        if (!renderContext) throw new Error('Canvas render context is unavailable');
        await renderWhenReady(reader, renderContext);
        const pixels = renderContext.getImageData(0, 0, canvas.width, canvas.height).data;
        let nonWhitePixelCount = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            (pixels[index] ?? 255) < 250 ||
            (pixels[index + 1] ?? 255) < 250 ||
            (pixels[index + 2] ?? 255) < 250
          ) {
            nonWhitePixelCount += 1;
          }
        }
        return {
          authorFaceReady: document.fonts.check('32px "Author"', authorOnly),
          pinnedFaceReady: document.fonts.check(`32px "${pinnedAlias}"`, pinnedOnly),
          nonWhitePixelCount,
          samples: geometry,
        };
      } finally {
        await reader.dispose();
      }

      function decode(base64: string): ArrayBuffer {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes.buffer;
      }

      function sourceRequestFromIndex(
        indices: ReadonlyMap<string, ChapterTextIndex>,
        text: string,
      ): ReaderExactSourceRangeRequest {
        for (const chapter of indices.values()) {
          for (const span of chapter.spans) {
            const spanText = chapter.normalizedText.slice(span.normalizedStart, span.normalizedEnd);
            const localStart = spanText.indexOf(text);
            if (localStart < 0) continue;
            return {
              href: chapter.href,
              sourceRange: {
                start: {
                  nodePath: span.nodePath,
                  textOffset: span.sourceStart + localStart,
                },
                end: {
                  nodePath: span.nodePath,
                  textOffset: span.sourceStart + localStart + text.length,
                },
              },
            };
          }
        }
        throw new Error(`Chapter source range is unavailable for ${text}`);
      }

      function renderWhenReady(
        activeReader: Reader,
        context: CanvasRenderingContext2D,
      ): Promise<void> {
        return new Promise((resolveRender, rejectRender) => {
          let unsubscribe: () => void = () => undefined;
          const timeout = setTimeout(() => {
            unsubscribe();
            rejectRender(new Error('Timed out waiting for the pinned fallback frame'));
          }, 30_000);
          const attempt = () => {
            if (!activeReader.renderSpreadTo(0, context)) return;
            clearTimeout(timeout);
            unsubscribe();
            resolveRender();
          };
          unsubscribe = activeReader.onSpreadContentInvalidated((spreadIndex) => {
            if (spreadIndex === 0) attempt();
          });
          attempt();
        });
      }
    },
    {
      authorOnly: AUTHOR_ONLY,
      bookBase64: Buffer.from(buildExactFallbackEpub()).toString('base64'),
      fontBase64: Buffer.from(PINNED_FONT).toString('base64'),
      pinnedAlias: PINNED_ALIAS,
      pinnedOnly: PINNED_ONLY,
      pinnedSha256: PINNED_SHA256,
      samples: SAMPLES,
    },
  );
}

function buildExactFallbackEpub(): ArrayBuffer {
  return buildMinimalEpub({
    title: 'Exact Fallback Selection',
    language: 'zh',
    chapters: [
      {
        id: 'chapter',
        href: 'Text/chapter.xhtml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><link rel="stylesheet" type="text/css" href="../book.css" /></head>
  <body>
    <p>${AUTHOR_ONLY}</p>
    <p>${PINNED_ONLY}</p>
    <p>${AUTHOR_ONLY}${PINNED_ONLY}</p>
    <p>${VARIABLE_LATIN}</p>
    <p class="wrapped">${WRAPPED_MIXED}</p>
  </body>
</html>`,
      },
    ],
    stylesheets: [
      {
        id: 'book-css',
        href: 'book.css',
        content: `
@font-face {
  font-family: "Author";
  src: url("author.ttf");
  font-style: normal;
  font-weight: 400;
}
body {
  margin: 0;
  color: #111;
  font-family: "Author", serif;
  font-size: 32px;
  line-height: 1.5;
}
p {
  margin: 0 0 12px;
}
.wrapped {
  width: 180px;
  word-break: break-all;
}
`,
      },
    ],
    fonts: [{ id: 'author-font', href: 'author.ttf', mediaType: 'font/ttf', data: AUTHOR_FONT }],
  });
}

function archiveFile(epubPath: string, path: string): Uint8Array {
  const file = unzipSync(readFileSync(epubPath))[path];
  if (!file) throw new Error(`Missing EPUB fixture file: ${path}`);
  return file;
}
