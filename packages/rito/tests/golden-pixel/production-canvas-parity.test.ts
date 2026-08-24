import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { SHOULD_RUN_PIXEL_GOLDEN } from './helpers/pixel-golden-file';
import { comparePng } from './helpers/png-diff';
import { startPixelRenderServer, type PixelRenderServer } from './helpers/render-server';

interface BrowserParityApi {
  renderRitoProductionParity(
    bookBase64: string,
    fonts: readonly BrowserParityFontSpec[],
  ): Promise<BrowserParityPair>;
}

interface BrowserParityFontSpec {
  readonly family: string;
  readonly fontBase64: string;
  readonly descriptors?: {
    readonly style?: string;
    readonly weight?: string;
  };
}

type ResourceImageKind = 'primary' | 'decoy';
type Rgb = readonly [red: number, green: number, blue: number];

interface BrowserParityPair {
  readonly reference: BrowserParityRender;
  readonly production: BrowserParityRender;
}

interface BrowserParityRender {
  readonly totalSpreads: number;
  readonly width: number;
  readonly height: number;
  readonly blockOpacityCount: number;
  readonly pngBase64: string;
}

interface BrowserParityWindow extends Partial<BrowserParityApi> {
  renderRitoProductionParityReady?: string;
}

const PAGE_READY_TIMEOUT_MS = 30_000;
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BOOK_FIXTURE_PATH = resolve(TEST_DIR, '../fixtures/books/book-01.epub');
const BOOK_FIXTURE_FILES = unzipSync(readFileSync(BOOK_FIXTURE_PATH));
const ILLUS1_FONT_BYTES = requireFixtureFile('OEBPS/Fonts/illus1.ttf');
const ILLUS5_FONT_BYTES = requireFixtureFile('OEBPS/Fonts/illus5.ttf');
// At 20px, 26 digits measure 364.52px in illus1 and 310.96px in illus5. The
// 360px panel therefore turns a wrong face choice into a deterministic line break.
const FONT_SELECTION_SAMPLE = '4'.repeat(26);
const RESOURCE_IMAGE_WIDTH = 4;
const RESOURCE_IMAGE_HEIGHT = 2;
const PRIMARY_RED: Rgb = [255, 0, 0];
const PRIMARY_BLUE: Rgb = [0, 0, 255];
const DECOY_MAGENTA: Rgb = [255, 0, 255];
const MIN_PRIMARY_COLOR_PIXELS = 100;

// A HarfBuzz subset of the CC BY 4.0 Codicon font shipped with Playwright.
// It intentionally contains only U+EA60, which is enough for this deterministic paint fixture.
// Attribution and modification details live in CODICON-FONT-NOTICE.md.
const TEST_FONT_BASE64 =
  'AAEAAAALAIAAAwAwR1NVQrj8uOoAAAEwAAAAKE9TLzI3T0SmAAAB7AAAAGBjbWFwAAzqswAAAYAAAAA0Z2x5Zm9KcegAAAFYAAAAKGhlYWRYl6BTAAABtAAAADZoaGVhAlsBLQAAAQwAAAAkaG10eAEsAAAAAADEAAAACGxvY2EAFAAAAAAAvAAAAAZtYXhwASMBgQAAAMwAAAAgbmFtZQWyHYsAAAJMAAAAgnBvc3QABgAAAAAA7AAAACAAAAAAABQAAAAAAAABLAAAAAEAAAACAXUAFwAAAAAAAgAAAAoACgAAAP8AAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAABLAAAAAABLP////4BLgABAAAAAAAAAAAAAAAAAAAAAgABAAAACgAmACYAAkRGTFQAEmxhdG4ADgAAAAAABAAAAAD//wAAAAAAAQAAAAABBwEaAAsAACUVIxUjNSM1MzUzFQEHcRNwcBOpE3BwE3BwAAAAAgAAAAMAAAAUAAMAAQAAABQABAAgAAAABAAEAAEAAOpg//8AAOpg//8VoQABAAAAAAABAAAAAQAA2OISJV8PPPUACwEsAAAAAHwlsIAAAAAAfCWwgP////0BLgEtAAAACAACAAAAAAAAAAQBKwGQAAUAAADLANIAAAAqAMsA0gAAAJAADgBNAAACAAUDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFBmRWQAwOpg6mABLAAAABsBRwADAAAAAQAAAAAAAAAAAAAAAAACAAAABgBOAAMAAQQJAAEADgAmAAMAAQQJAAIADgAYAAMAAQQJAAMADgAmAAMAAQQJAAQADgAmAAMAAQQJAAUAGAAAAAMAAQQJAAYADgAmAFYAZQByAHMAaQBvAG4AIAAxAC4AMQAxAFIAZQBnAHUAbABhAHIAYwBvAGQAaQBjAG8AbgAA';

test.describe('production Canvas pixel parity', () => {
  let server: PixelRenderServer | undefined;

  test.skip(!SHOULD_RUN_PIXEL_GOLDEN, 'Set RITO_PIXEL_GOLDEN=1 to run pixel goldens');

  test.beforeAll(async () => {
    server = await startPixelRenderServer();
  });

  test.afterAll(async () => {
    await server?.close();
  });

  // Retired with the fragment-only pipeline: the production engine now
  // targets pinned-Chromium pixel parity (covered by the golden snapshot
  // suite), not equality with the TypeScript reference renderer, and the
  // full-layout commit event this harness waits on is a retained-pipeline
  // signal. Kept for the reference tooling until the harness is rebuilt
  // against the browser oracle.
  test.fixme('matches the reference renderer for representative paint features', async ({
    page,
  }, testInfo) => {
    if (!server) throw new Error('Pixel render server did not start');
    const result = await renderParityPair(page, server.origin);
    expect(result.reference.totalSpreads).toBe(1);
    expect(result.production.totalSpreads).toBe(result.reference.totalSpreads);
    expect(result.reference.blockOpacityCount).toBeGreaterThan(0);
    expect([result.production.width, result.production.height]).toEqual([
      result.reference.width,
      result.reference.height,
    ]);
    expectResourceImagePainted(result.reference);
    expectResourceImagePainted(result.production);
    await expectPixelParity(result, testInfo);
  });
});

async function renderParityPair(page: Page, origin: string): Promise<BrowserParityPair> {
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    diagnostics.push(`page error: ${error.message}`);
  });
  await page.goto(`${origin}/production-parity.html`);
  await waitForParityApi(page, diagnostics);
  const result = await page.evaluate(
    async ({ bookBase64, fonts }) => {
      const api = window as unknown as BrowserParityApi;
      return await api.renderRitoProductionParity(bookBase64, fonts);
    },
    {
      bookBase64: Buffer.from(buildParityEpub()).toString('base64'),
      fonts: browserParityFonts(),
    },
  );
  if (diagnostics.length > 0) {
    throw new Error(`Production parity render emitted browser errors:\n${diagnostics.join('\n')}`);
  }
  return result;
}

async function waitForParityApi(page: Page, diagnostics: readonly string[]): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = window as unknown as BrowserParityWindow;
      return (
        typeof api.renderRitoProductionParity === 'function' ||
        api.renderRitoProductionParityReady !== 'loading'
      );
    },
    undefined,
    { timeout: PAGE_READY_TIMEOUT_MS },
  );
  const ready = await page.evaluate(() => {
    const api = window as unknown as BrowserParityWindow;
    return {
      hasApi: typeof api.renderRitoProductionParity === 'function',
      state: api.renderRitoProductionParityReady,
    };
  });
  if (ready.hasApi) return;
  const details = diagnostics.length > 0 ? `\n${diagnostics.join('\n')}` : '';
  throw new Error(`Production parity page failed to load: ${ready.state ?? 'unknown'}${details}`);
}

async function expectPixelParity(result: BrowserParityPair, testInfo: TestInfo): Promise<void> {
  const reference = Buffer.from(result.reference.pngBase64, 'base64');
  const production = Buffer.from(result.production.pngBase64, 'base64');
  const diff = await comparePng(
    reference,
    production,
    { id: 'production-canvas-parity', threshold: 0 },
    testInfo.outputPath('production-canvas-parity-diff.png'),
    { includeAntiAliasedPixels: true },
  );
  const exactPixelsEqual = decodedPixels(reference).equals(decodedPixels(production));
  if (!exactPixelsEqual) {
    await Promise.all([
      testInfo.attach('production-canvas-parity-reference', {
        body: reference,
        contentType: 'image/png',
      }),
      testInfo.attach('production-canvas-parity-production', {
        body: production,
        contentType: 'image/png',
      }),
    ]);
  }
  expect(diff.diffPixels).toBe(0);
  expect(exactPixelsEqual).toBe(true);
}

function decodedPixels(png: Buffer): Buffer {
  return PNG.sync.read(png).data;
}

function expectResourceImagePainted(render: BrowserParityRender): void {
  const pixels = decodedPixels(Buffer.from(render.pngBase64, 'base64'));
  expect(countExactRgb(pixels, PRIMARY_RED)).toBeGreaterThan(MIN_PRIMARY_COLOR_PIXELS);
  expect(countExactRgb(pixels, PRIMARY_BLUE)).toBeGreaterThan(MIN_PRIMARY_COLOR_PIXELS);
  expect(countExactRgb(pixels, DECOY_MAGENTA)).toBe(0);
}

function countExactRgb(pixels: Buffer, color: Rgb): number {
  const [red, green, blue] = color;
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] === red && pixels[offset + 1] === green && pixels[offset + 2] === blue) {
      count += 1;
    }
  }
  return count;
}

function buildParityEpub(): ArrayBuffer {
  const fontBytes = Uint8Array.from(Buffer.from(TEST_FONT_BASE64, 'base64'));
  return buildMinimalEpub({
    title: 'Production Canvas Parity',
    chapters: [{ id: 'paint', href: 'Text/paint.xhtml', content: parityXhtml() }],
    stylesheets: [{ id: 'paint-css', href: 'paint.css', content: PARITY_CSS }],
    fonts: [
      { id: 'font-normal', href: 'font-normal.ttf', mediaType: 'font/ttf', data: fontBytes },
      {
        id: 'alpha-family',
        href: 'alpha-family.ttf',
        mediaType: 'font/ttf',
        data: ILLUS5_FONT_BYTES,
      },
      {
        id: 'zulu-family',
        href: 'zulu-family.ttf',
        mediaType: 'font/ttf',
        data: ILLUS1_FONT_BYTES,
      },
      {
        id: 'descriptor-regular',
        href: 'descriptor-a-regular.ttf',
        mediaType: 'font/ttf',
        data: ILLUS5_FONT_BYTES,
      },
      {
        id: 'descriptor-exact',
        href: 'descriptor-z-exact.ttf',
        mediaType: 'font/ttf',
        data: ILLUS1_FONT_BYTES,
      },
    ],
    images: [
      // The literal-space manifest key and percent-encoded XHTML src keep Rust
      // dimension lookup and runtime resource transfer on the same href semantics.
      {
        id: 'resource-image-primary',
        href: 'Images/primary/resource tile.png',
        mediaType: 'image/png',
        data: buildResourceImagePng('primary'),
      },
      {
        id: 'resource-image-decoy',
        href: 'Images/decoy/resource tile.png',
        mediaType: 'image/png',
        data: buildResourceImagePng('decoy'),
      },
    ],
  });
}

function buildResourceImagePng(kind: ResourceImageKind): Uint8Array {
  const png = new PNG({ width: RESOURCE_IMAGE_WIDTH, height: RESOURCE_IMAGE_HEIGHT });
  for (let y = 0; y < RESOURCE_IMAGE_HEIGHT; y += 1) {
    for (let x = 0; x < RESOURCE_IMAGE_WIDTH; x += 1) {
      const color =
        kind === 'decoy'
          ? DECOY_MAGENTA
          : x < RESOURCE_IMAGE_WIDTH / 2
            ? PRIMARY_RED
            : PRIMARY_BLUE;
      const offset = (y * RESOURCE_IMAGE_WIDTH + x) * 4;
      png.data[offset] = color[0];
      png.data[offset + 1] = color[1];
      png.data[offset + 2] = color[2];
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function browserParityFonts(): readonly BrowserParityFontSpec[] {
  return [
    {
      family: 'Rito Pixel Test',
      fontBase64: TEST_FONT_BASE64,
      descriptors: { style: 'normal', weight: '400' },
    },
    { family: 'Alpha Family', fontBase64: Buffer.from(ILLUS5_FONT_BYTES).toString('base64') },
    { family: 'Zulu Family', fontBase64: Buffer.from(ILLUS1_FONT_BYTES).toString('base64') },
    {
      family: 'Descriptor Family',
      fontBase64: Buffer.from(ILLUS5_FONT_BYTES).toString('base64'),
    },
    {
      family: 'Descriptor Family',
      fontBase64: Buffer.from(ILLUS1_FONT_BYTES).toString('base64'),
      descriptors: { style: 'italic', weight: '700' },
    },
  ];
}

function requireFixtureFile(path: string): Uint8Array {
  const file = BOOK_FIXTURE_FILES[path];
  if (!file) throw new Error(`Missing production parity fixture file: ${path}`);
  return file;
}

function parityXhtml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Production Canvas Parity</title>
    <link rel="stylesheet" type="text/css" href="../paint.css" />
  </head>
  <body>
    <img class="resource-image" src="../Images/primary/resource%20tile.png" alt="Resource pattern" />
    <div class="panel">
      <p class="plain">&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;</p>
      <p><span class="accent">&#xea60;&#xea60;&#xea60;&#xea60;</span></p>
      <p class="decorated">&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;</p>
      <p class="shadow">&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;</p>
      <p class="ruby"><ruby>&#xea60;&#xea60;&#xea60;&#xea60;<rt>&#xea60;&#xea60;</rt></ruby></p>
      <p class="family-order">${FONT_SELECTION_SAMPLE}</p>
      <p class="descriptor-match">${FONT_SELECTION_SAMPLE}</p>
      <hr />
    </div>
  </body>
</html>`;
}

const PARITY_CSS = `
@font-face {
  font-family: "Rito Pixel Test";
  src: url("font-normal.ttf");
  font-style: normal;
  font-weight: 400;
}
@font-face {
  font-family: "Alpha Family";
  src: url("alpha-family.ttf");
}
@font-face {
  font-family: "Zulu Family";
  src: url("zulu-family.ttf");
}
@font-face {
  font-family: "Descriptor Family";
  src: url("descriptor-a-regular.ttf");
}
@font-face {
  font-family: "Descriptor Family";
  src: url("descriptor-z-exact.ttf");
  font-style: italic;
  font-weight: 700;
}
body {
  margin: 0;
  color: #24313d;
  font-family: "Rito Pixel Test";
  font-size: 20px;
  line-height: 1.4;
}
p {
  margin: 0 0 12px;
}
.resource-image {
  display: block;
  width: 120px;
  height: 80px;
  object-fit: contain;
}
.panel {
  width: 360px;
  opacity: 0.2525;
  padding: 14px;
  background-color: #f3ead7;
  border: 2px solid #506070;
  border-radius: 9px;
  box-shadow: 3px 3px 4px rgba(20, 30, 40, 0.35);
}
.plain {
  letter-spacing: 1px;
}
.accent {
  padding: 3px 7px;
  color: #17385f;
  background-color: #b9dbf4;
  border: 1px solid #32658a;
  border-radius: 5px;
}
.decorated {
  color: #7a2745;
  text-decoration: underline line-through;
}
.shadow {
  color: #2f6644;
  text-shadow: 2px 2px 1px rgba(10, 20, 30, 0.55);
}
.ruby {
  color: #5d3b83;
}
.family-order {
  color: #5b331d;
  font-family: "Zulu Family", "Alpha Family";
  word-break: break-all;
}
.descriptor-match {
  color: #285f67;
  font-family: "Descriptor Family";
  font-style: italic;
  font-weight: 700;
  word-break: break-all;
}
hr {
  border: 0;
  border-top: 3px solid #7d6652;
}
`;
