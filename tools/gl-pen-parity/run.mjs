// The GPU pen against the canvas pen on real books: for sampled spreads of
// each book, the demo reader paints the spread into a 2D canvas and into a
// WebGL2 framebuffer through `reader.renderSpreadTo`, and the two bitmaps
// are compared pixel for pixel. Any differing pixel fails the run.
//
//   DPR=1,2 SAMPLES=16 node tools/gl-pen-parity/run.mjs <epub>...
//
// Needs the demo reader on http://localhost:5173 (pnpm dev:reader). Runs
// Chromium on the machine's GPU, as a reader would; GPU=0 runs the
// headless default the pixel walks run in.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { launchUnthrottled } from '../resize-frames/shared.mjs';

const { chromium } = createRequire(new URL('../../apps/reader/package.json', import.meta.url))(
  '@playwright/test',
);

const RATIOS = (process.env.DPR ?? '1,2').split(',').map(Number);
const SAMPLES = Number(process.env.SAMPLES ?? 16);
const URL_ = process.env.URL ?? 'http://localhost:5173/';
const books = process.argv.slice(2);
if (books.length === 0) throw new Error('name at least one .epub');

/** In the page: both pens on one spread; answers the differing pixels, or undefined while it loads. */
function compareSpread(index) {
  const reader = window.__ritoController.reader;
  const size = reader.getCanvasSize(1);
  const width = Math.round(size.width * reader.dpr);
  const height = Math.round(size.height * reader.dpr);
  const flat = new OffscreenCanvas(width, height).getContext('2d');
  if (!reader.renderSpreadTo(index, flat)) return undefined;
  const glCanvas = new OffscreenCanvas(width, height);
  const gl = glCanvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  let onGpu = false;
  globalThis.__ritoGlPenTap = (value) => {
    onGpu = value;
  };
  const painted = reader.renderSpreadTo(index, { gl, framebuffer: null, width, height });
  delete globalThis.__ritoGlPenTap;
  if (!painted) return undefined;
  const expected = flat.getImageData(0, 0, width, height).data;
  const actual = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, actual);
  const row = width * 4;
  let differ = 0;
  let maxDelta = 0;
  const first = [];
  for (let y = 0; y < height; y += 1) {
    const flipped = (height - 1 - y) * row;
    for (let x = 0; x < row; x += 4) {
      const a = y * row + x;
      const b = flipped + x;
      let delta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        delta = Math.max(delta, Math.abs(expected[a + channel] - actual[b + channel]));
      }
      if (delta > 0) {
        differ += 1;
        maxDelta = Math.max(maxDelta, delta);
        if (first.length < 4) first.push([x / 4, y, delta]);
      }
    }
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { width, height, differ, maxDelta, first, onGpu };
}

const browser = process.env.GPU === '0' ? await chromium.launch() : await launchUnthrottled();
let failed = 0;
let compared = 0;
let gpu = 0;
try {
  for (const ratio of RATIOS) {
    for (const book of books) {
      const name = book.split('/').pop();
      const page = await browser.newPage({
        viewport: { width: 1200, height: 900 },
        deviceScaleFactor: ratio,
      });
      page.on('pageerror', (error) => console.log(`[${name}] ${error.message}`));
      await page.goto(URL_);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.waitForFunction(() => typeof window.__ritoLoad === 'function');
      await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        await window.__ritoLoad(bytes.buffer);
      }, readFileSync(book).toString('base64'));
      await page.waitForFunction(
        () => window.__ritoReaderDiagnostics?.layout().scope === 'book',
        null,
        { timeout: 300000 },
      );
      const total = await page.evaluate(() => window.__ritoReaderDiagnostics.layout().spreadCount);
      const step = Math.max(1, Math.floor(total / SAMPLES));
      for (let index = 0; index < total; index += step) {
        let result;
        for (let tries = 0; tries < 200 && result === undefined; tries += 1) {
          result = await page.evaluate(compareSpread, index);
          if (result === undefined) await page.waitForTimeout(50);
        }
        compared += 1;
        if (result === undefined) {
          failed += 1;
          console.log(`DPR ${ratio}\t${name}\tspread ${index}\tnever loaded`);
          continue;
        }
        if (result.differ > 0) failed += 1;
        if (result.onGpu) gpu += 1;
        console.log(
          `DPR ${ratio}\t${name.slice(0, 3)}\tspread ${index}\t${result.onGpu ? 'gpu' : 'canvas'}\t${result.differ} px` +
            (result.differ > 0
              ? ` (max Δ${result.maxDelta}) at ${JSON.stringify(result.first)}`
              : ''),
        );
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`${compared} spreads compared, ${failed} differ, ${gpu} painted on the GPU`);
process.exit(failed > 0 ? 1 : 0);
