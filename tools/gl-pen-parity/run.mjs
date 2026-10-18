// The GPU pen against the canvas pen on real books: for sampled spreads of
// each book, the demo reader paints the spread into a 2D canvas and into a
// WebGL2 framebuffer through `reader.renderSpreadTo`, and the two bitmaps
// are compared pixel for pixel. Any differing pixel fails the run.
//
//   DPR=1,2 SAMPLES=16 node tools/gl-pen-parity/run.mjs <epub>...
//
// WIDTH sets the viewport's width (1200): an odd one at a ratio of 1 puts
// the pages of a spread on either side of an odd gap.
//
// DISPLAY=1 compares what the screen shows instead: the controller goes to
// each spread, and the display canvas as the browser composites it,
// captured in device pixels, is held to the canvas pen's painting of the
// spread. Reading the canvas back would miss what compositing does to it.
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
const { PNG } = createRequire(new URL('../../package.json', import.meta.url))('pngjs');

const RATIOS = (process.env.DPR ?? '1,2').split(',').map(Number);
const SAMPLES = Number(process.env.SAMPLES ?? 16);
const URL_ = process.env.URL ?? 'http://localhost:5173/';
const DISPLAY = process.env.DISPLAY === '1';
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

/**
 * In the page: once the display shows `index`, the canvas pen's painting of
 * it as a PNG and where the canvas sits in device pixels; undefined while
 * it loads.
 */
async function paintedForDisplay(index) {
  const controller = window.__ritoController;
  const reader = controller.reader;
  const size = reader.getCanvasSize(1);
  const width = Math.round(size.width * reader.dpr);
  const height = Math.round(size.height * reader.dpr);
  if (controller.currentSpread !== index) controller.goToSpread(index);
  // The display shows the spread once no turn is moving it.
  const shell = document.querySelector('[data-testid=reader-shell]');
  for (let waited = 0; waited < 3000; waited += 50) {
    await new Promise((done) => setTimeout(done, 50));
    if (shell?.getAttribute('data-transitioning') === 'false') break;
  }
  for (let frame = 0; frame < 3; frame += 1)
    await new Promise((done) => requestAnimationFrame(done));
  if (controller.currentSpread !== index) return undefined;
  const flat = new OffscreenCanvas(width, height);
  if (!reader.renderSpreadTo(index, flat.getContext('2d'))) return undefined;
  const display = document.querySelector('[data-testid=reader-shell] canvas');
  // The display shows the bottom-left region of its drawing buffer, as
  // large as its box at the ratio.
  const box = display.getBoundingClientRect();
  const shown = [
    Math.round(box.width * devicePixelRatio),
    Math.round(box.height * devicePixelRatio),
  ];
  if (shown[0] !== width || shown[1] !== height) return undefined;
  if (display.width < width || display.height < height) return undefined;
  const bytes = new Uint8Array(await (await flat.convertToBlob()).arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  const ratio = devicePixelRatio;
  const left = Math.round(box.x * ratio);
  const top = Math.round(box.y * ratio);
  return {
    png: btoa(binary),
    left,
    top,
    // A canvas whose edge falls inside a device pixel shares that row or
    // column with what is beside it; only the pixels it covers are held.
    covered: [
      Math.floor(box.right * ratio + 1e-6) - left,
      Math.floor(box.bottom * ratio + 1e-6) - top,
    ],
  };
}

/**
 * What the screen shows of the display, captured in device pixels, against
 * the canvas pen's painting of the spread. The spread is painted again
 * after the capture so an image landing in between shows as a retry, not a
 * difference.
 */
async function compareDisplay(page, index) {
  const before = await page.evaluate(paintedForDisplay, index);
  if (before === undefined) return undefined;
  const frame = PNG.sync.read(await page.screenshot({ scale: 'device' }));
  const after = await page.evaluate(paintedForDisplay, index);
  if (after === undefined || after.png !== before.png) return undefined;
  const expected = PNG.sync.read(Buffer.from(after.png, 'base64'));
  const { width, height } = expected;
  let differ = 0;
  let maxDelta = 0;
  const first = [];
  const columns = Math.min(width, after.covered[0], frame.width - after.left);
  const rows = Math.min(height, after.covered[1], frame.height - after.top);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const a = (y * width + x) * 4;
      const b = ((y + after.top) * frame.width + x + after.left) * 4;
      let delta = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        delta = Math.max(delta, Math.abs(expected.data[a + channel] - frame.data[b + channel]));
      }
      if (delta > 0) {
        differ += 1;
        maxDelta = Math.max(maxDelta, delta);
        if (first.length < 4) first.push([x, y, delta]);
      }
    }
  }
  return { width, height, differ, maxDelta, first, onGpu: undefined };
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
        viewport: { width: Number(process.env.WIDTH ?? 1200), height: 900 },
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
      // The demo's engine badge floats over the canvas.
      await page.addStyleTag({
        content: '[data-testid=engine-badge] { display: none !important; }',
      });
      const total = await page.evaluate(() => window.__ritoReaderDiagnostics.layout().spreadCount);
      const step = Math.max(1, Math.floor(total / SAMPLES));
      for (let index = 0; index < total; index += step) {
        let result;
        for (let tries = 0; tries < 200 && result === undefined; tries += 1) {
          result = DISPLAY
            ? await compareDisplay(page, index)
            : await page.evaluate(compareSpread, index);
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
          `DPR ${ratio}\t${name.slice(0, 3)}\tspread ${index}\t${result.onGpu === undefined ? 'display' : result.onGpu ? 'gpu' : 'canvas'}\t${result.differ} px` +
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
