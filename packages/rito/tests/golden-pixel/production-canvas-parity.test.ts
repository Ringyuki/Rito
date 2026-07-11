import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { SHOULD_RUN_PIXEL_GOLDEN } from './helpers/pixel-golden-file';
import { comparePng } from './helpers/png-diff';
import { startPixelRenderServer, type PixelRenderServer } from './helpers/render-server';

interface BrowserParityApi {
  renderRitoProductionParity(bookBase64: string, fontBase64: string): Promise<BrowserParityPair>;
}

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

  test('matches the reference renderer for representative paint features', async ({
    page,
  }, testInfo) => {
    if (!server) throw new Error('Pixel render server did not start');
    const result = await renderParityPair(page, server.origin);
    expect(result.production.totalSpreads).toBe(result.reference.totalSpreads);
    expect(result.reference.blockOpacityCount).toBeGreaterThan(0);
    expect([result.production.width, result.production.height]).toEqual([
      result.reference.width,
      result.reference.height,
    ]);
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
  return await page.evaluate(
    async ({ bookBase64, fontBase64 }) => {
      const api = window as unknown as BrowserParityApi;
      return await api.renderRitoProductionParity(bookBase64, fontBase64);
    },
    {
      bookBase64: Buffer.from(buildParityEpub()).toString('base64'),
      fontBase64: TEST_FONT_BASE64,
    },
  );
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

function buildParityEpub(): ArrayBuffer {
  const fontBytes = Uint8Array.from(Buffer.from(TEST_FONT_BASE64, 'base64'));
  return buildMinimalEpub({
    title: 'Production Canvas Parity',
    chapters: [{ id: 'paint', href: 'paint.xhtml', content: parityXhtml() }],
    stylesheets: [{ id: 'paint-css', href: 'paint.css', content: PARITY_CSS }],
    fonts: [{ id: 'font-normal', href: 'font-normal.ttf', mediaType: 'font/ttf', data: fontBytes }],
  });
}

function parityXhtml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Production Canvas Parity</title>
    <link rel="stylesheet" type="text/css" href="paint.css" />
  </head>
  <body>
    <div class="panel">
      <p class="plain">&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;</p>
      <p><span class="accent">&#xea60;&#xea60;&#xea60;&#xea60;</span></p>
      <p class="decorated">&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;</p>
      <p class="shadow">&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;&#xea60;</p>
      <p class="ruby"><ruby>&#xea60;&#xea60;&#xea60;&#xea60;<rt>&#xea60;&#xea60;</rt></ruby></p>
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
hr {
  border: 0;
  border-top: 3px solid #7d6652;
}
`;
