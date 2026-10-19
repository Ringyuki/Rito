// Browser-pen half of the paint-parity instrument. Bundled by vite into
// an IIFE and injected into a Playwright page; decodes one fixture's
// engine-lowered `RITODL1` bytes with the production decoder, blits them
// through the production primitive renderer, and hands the bitmap back as
// a PNG data URL. The blitter itself is the oracle — this file must add
// nothing to the raster beyond the optional background fill both pens
// share.
import { renderReaderPrimitivesToGl } from '../../../packages/rito/src/bindings/browser/gl-pen/pen';
import {
  renderReaderPrimitivesToCanvas,
  type PrimitiveRenderOptions,
} from '../../../packages/rito/src/bindings/browser/primitive-renderer';
import { decodeRitoReaderPrimitiveList } from '../../../packages/rito-core-wasm/src/reader-session-primitive-decoder-runtime.js';

// Synthetic image sources shared with the Flutter renderer. Pixel
// definitions are integer-exact; any drift between the two generators
// poisons every image fixture, so keep them byte-identical with
// parity_fixture_loader.dart.
const syntheticCache = new Map<string, HTMLCanvasElement>();

function makeSyntheticImage(src: string): HTMLCanvasElement | undefined {
  const cached = syntheticCache.get(src);
  if (cached) return cached;
  const pixels = syntheticPixels(src);
  if (!pixels) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
  syntheticCache.set(src, canvas);
  return canvas;
}

interface SyntheticPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

function syntheticPixels(src: string): SyntheticPixels | undefined {
  if (src === 'synthetic:checker16') {
    // 16x16, 4px cells, red/blue checkerboard.
    return fillPixels(16, 16, (x, y) =>
      ((x >> 2) + (y >> 2)) % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255],
    );
  }
  if (src === 'synthetic:gradient32') {
    // 32x32 horizontal ramp: red rises, blue falls, green from row.
    return fillPixels(32, 32, (x, y) => [
      Math.floor((x * 255) / 31),
      Math.floor((y * 255) / 31),
      255 - Math.floor((x * 255) / 31),
      255,
    ]);
  }
  if (src === 'synthetic:dot8') {
    // 8x8 white tile with a black 2x2 center dot.
    return fillPixels(8, 8, (x, y) =>
      x >= 3 && x <= 4 && y >= 3 && y <= 4 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );
  }
  return undefined;
}

function fillPixels(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): SyntheticPixels {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = (y * width + x) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = a;
    }
  }
  return { width, height, rgba };
}

interface LoweredFixture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Device pixels per CSS pixel the list was lowered at. */
  readonly ratio: number;
  readonly background?: string;
  /** Host theme override (dark/sepia) applied by both pens. */
  readonly theme?: { readonly foreground: string; readonly background: string };
}

function decodeFixture(base64: string): ReturnType<typeof decodeRitoReaderPrimitiveList> {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return decodeRitoReaderPrimitiveList(bytes);
}

function fixtureOptions(fixture: LoweredFixture): PrimitiveRenderOptions {
  return {
    resolveImage: makeSyntheticImage,
    // A `pending:` source is still on its way past its first second; any
    // other source no synthetic image answers can no longer arrive.
    imageFallback: (src) =>
      src.startsWith('pending:') ? 'loading' : makeSyntheticImage(src) ? undefined : 'broken',
    ...(fixture.theme
      ? {
          foregroundColor: fixture.theme.foreground,
          backgroundColor: fixture.theme.background,
        }
      : {}),
  };
}

/** The engine's `RITODL1` bytes decoded by the production decoder and
 * blitted onto a device-sized canvas. */
function renderLoweredFixture(fixture: LoweredFixture, base64: string): string {
  const list = decodeFixture(base64);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(fixture.width * fixture.ratio);
  canvas.height = Math.round(fixture.height * fixture.ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  if (fixture.background) {
    ctx.fillStyle = fixture.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  renderReaderPrimitivesToCanvas(list, ctx, fixtureOptions(fixture));
  return canvas.toDataURL('image/png');
}

/**
 * The same bytes through the canvas pen on an OffscreenCanvas, the kind of
 * canvas a reader's pages are painted on (and the GPU pen's canvas-pen
 * part): what the GPU pen is held to.
 */
async function renderLoweredFixtureOffscreen(
  fixture: LoweredFixture,
  base64: string,
): Promise<string> {
  const list = decodeFixture(base64);
  const canvas = new OffscreenCanvas(
    Math.round(fixture.width * fixture.ratio),
    Math.round(fixture.height * fixture.ratio),
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  if (fixture.background) {
    ctx.fillStyle = fixture.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  renderReaderPrimitivesToCanvas(list, ctx, fixtureOptions(fixture));
  const bytes = new Uint8Array(
    await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
  );
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

/** The same bytes through the GPU pen into a WebGL2 canvas. */
function renderLoweredFixtureGl(fixture: LoweredFixture, base64: string): string {
  const list = decodeFixture(base64);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(fixture.width * fixture.ratio);
  canvas.height = Math.round(fixture.height * fixture.ratio);
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('webgl2 context unavailable');
  renderReaderPrimitivesToGl(
    list,
    { gl, framebuffer: null, width: canvas.width, height: canvas.height },
    { ...fixtureOptions(fixture), ground: fixture.background },
  );
  return canvas.toDataURL('image/png');
}

declare global {
  interface Window {
    __renderLoweredFixture: typeof renderLoweredFixture;
    __renderLoweredFixtureGl: typeof renderLoweredFixtureGl;
    __renderLoweredFixtureOffscreen: typeof renderLoweredFixtureOffscreen;
  }
}

window.__renderLoweredFixture = renderLoweredFixture;
window.__renderLoweredFixtureGl = renderLoweredFixtureGl;
window.__renderLoweredFixtureOffscreen = renderLoweredFixtureOffscreen;
