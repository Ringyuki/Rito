// Browser-pen half of the paint-parity instrument. Bundled by vite into
// an IIFE and injected into a Playwright page; renders one fixture's
// command list through the calibrated browser painter and hands the
// bitmap back as a PNG data URL. The painter itself is the oracle — this
// file must add nothing to the raster beyond the optional background
// fill both pens share.
import { renderFrameCommandsToCanvas } from '../../../packages/rito/src/bindings/browser/frame-command-renderer';
import type { CoreFrameCommand } from '../../../packages/rito/src/bindings/browser/core-contracts';

interface ParityFixture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly background?: string;
  readonly commands: readonly unknown[];
}

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

function renderParityFixture(fixture: ParityFixture): string {
  const canvas = document.createElement('canvas');
  canvas.width = fixture.width;
  canvas.height = fixture.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  if (fixture.background) {
    ctx.fillStyle = fixture.background;
    ctx.fillRect(0, 0, fixture.width, fixture.height);
  }
  renderFrameCommandsToCanvas(fixture.commands as readonly CoreFrameCommand[], ctx, {
    pixelRatio: 1,
    resolveImage: makeSyntheticImage,
  });
  return canvas.toDataURL('image/png');
}

declare global {
  interface Window {
    __renderParityFixture: typeof renderParityFixture;
  }
}

window.__renderParityFixture = renderParityFixture;
