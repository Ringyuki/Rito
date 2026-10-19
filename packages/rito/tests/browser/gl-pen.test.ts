import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RitoReaderColor,
  RitoReaderPrimitive,
  RitoReaderPrimitiveList,
} from '@ritojs/core-wasm';

import { renderReaderPrimitivesToGl } from '../../src/bindings/browser/gl-pen/pen';
import { renderReaderPrimitivesToCanvas } from '../../src/bindings/browser/primitive-renderer';
import { clusterTable } from '../helpers/cluster-table';

// The GPU pen paints only where WebGL has a GPU and the canvas is
// Chromium's; a headless run has neither guarantee, so the test decides.
const hardware = vi.hoisted(() => ({ gpu: true }));
vi.mock('../../src/bindings/browser/gl-pen/hardware', () => ({
  webglOnGpu: () => hardware.gpu,
  canvasTextMatchesGpuPen: () => true,
}));

const WIDTH = 240;
const HEIGHT = 200;

/**
 * How far the GPU pen's text may land from the canvas pen's. On a GPU the
 * two are the same pixels. On a software rasterizer (the headless browser
 * a CI machine runs, SwiftShader) WebGL blends glyph coverage with its own
 * arithmetic: measured up to 2 levels apart from the software canvas on
 * small glyphs, far below a glyph off by a pixel.
 */
const actualHardware = await vi.importActual<
  typeof import('../../src/bindings/browser/gl-pen/hardware')
>('../../src/bindings/browser/gl-pen/hardware');
const TEXT_TOLERANCE = actualHardware.webglOnGpu() ? 0 : 2;
const GROUND = '#ffffff';

function srgb(r: number, g: number, b: number): RitoReaderColor {
  return {
    space: 'srgb',
    component0: r,
    component1: g,
    component2: b,
    alpha: 1,
    none: { component0: false, component1: false, component2: false, alpha: false },
  };
}

function list(commands: readonly RitoReaderPrimitive[]): RitoReaderPrimitiveList {
  return { formatVersion: 4, ratio: 1, commandCount: commands.length, commands };
}

function fill(x: number, y: number, width: number, height: number, color = srgb(0.2, 0.4, 0.8)) {
  return {
    kind: 'fill-rect',
    rect: { x, y, width, height },
    color,
    ground: 'none',
  } as const satisfies RitoReaderPrimitive;
}

/**
 * A run as the engine places one: each cluster its own, a full em apart
 * for CJK and 0.6 em for Latin, on the quarter-pixel grid glyphs land on,
 * on a whole-pixel baseline.
 */
function run(text: string, x: number, y: number, size: number, kind: 'text' | 'ruby' = 'text') {
  const encoder = new TextEncoder();
  let byte = 0;
  let pen = x;
  const graphemes = Array.from(new Intl.Segmenter().segment(text), (part) => part.segment);
  const rows = graphemes.map((character) => {
    const row = [byte, Math.round(pen * 4) / 4, y] as const;
    byte += encoder.encode(character).length;
    pen += (character.codePointAt(0) ?? 0) > 0x2e80 ? size : size * 0.6;
    return row;
  });
  return {
    kind,
    text,
    rect: { x, y: y - size, width: pen - x, height: size * 1.4 },
    paint: {
      font: { family: 'serif', sizePx: size, weight: 400, style: 'normal' },
      color: srgb(0.1, 0.1, 0.1),
      textShadows: [],
    },
    clusters: clusterTable(rows),
  } as const satisfies RitoReaderPrimitive;
}

interface Painted {
  readonly onGpu: boolean | undefined;
  readonly gpu: Uint8Array;
  readonly canvas: Uint8ClampedArray;
}

/** The list through the GPU pen into a WebGL2 framebuffer and through the canvas pen. */
function paintBoth(primitives: RitoReaderPrimitiveList): Painted {
  const glCanvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const gl = glCanvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('this browser has no WebGL2');
  let onGpu: boolean | undefined;
  (globalThis as { __ritoGlPenTap?: (value: boolean) => void }).__ritoGlPenTap = (value) => {
    onGpu = value;
  };
  try {
    const painted = renderReaderPrimitivesToGl(
      primitives,
      { gl, framebuffer: null, width: WIDTH, height: HEIGHT },
      { ground: GROUND },
    );
    expect(painted).toBe(true);
  } finally {
    delete (globalThis as { __ritoGlPenTap?: unknown }).__ritoGlPenTap;
  }
  const raw = new Uint8Array(WIDTH * HEIGHT * 4);
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  // WebGL reads rows bottom-up.
  const gpu = new Uint8Array(raw.length);
  const row = WIDTH * 4;
  for (let y = 0; y < HEIGHT; y += 1) {
    gpu.set(raw.subarray((HEIGHT - 1 - y) * row, (HEIGHT - y) * row), y * row);
  }
  const context = new OffscreenCanvas(WIDTH, HEIGHT).getContext('2d');
  if (!context) throw new Error('this browser has no 2D canvas');
  context.fillStyle = GROUND;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  renderReaderPrimitivesToCanvas(primitives, context);
  return { onGpu, gpu, canvas: context.getImageData(0, 0, WIDTH, HEIGHT).data };
}

/** The largest channel difference between the two paintings. */
function maxDelta({ gpu, canvas }: Painted): number {
  let max = 0;
  for (let index = 0; index < gpu.length; index += 1) {
    max = Math.max(max, Math.abs((gpu[index] ?? 0) - (canvas[index] ?? 0)));
  }
  return max;
}

afterEach(() => {
  hardware.gpu = true;
});

describe('the GPU pen in a browser', () => {
  it('paints fills and text runs on the GPU as the canvas pen paints them', () => {
    const painted = paintBoth(
      list([
        fill(0, 0, WIDTH, HEIGHT, srgb(1, 1, 1)),
        fill(10, 10, 40, 20),
        { kind: 'push-state' },
        { kind: 'translate', dx: 4, dy: 2 },
        { kind: 'clip-path', path: [{ op: 'rect', x: 0, y: 0, width: 200, height: 100 }] },
        run('Reader 阅读', 12, 60, 16),
        run('るび', 20, 40, 8, 'ruby'),
        { kind: 'pop-state' },
      ]),
    );
    expect(painted.onGpu).toBe(true);
    expect(maxDelta(painted)).toBeLessThanOrEqual(TEXT_TOLERANCE);
  });

  it('rasterizes as many glyphs as a page holds, row after row of the atlas', () => {
    const characters = Array.from({ length: 160 }, (_, index) =>
      String.fromCodePoint(0x4e00 + index * 7),
    );
    // Twelve lines of eight new characters each, at three sizes and four
    // quarter-pixel phases: more cells than one row of the atlas holds.
    let baseline = 0;
    const runs = [9, 12, 16].flatMap((size) =>
      [0, 1, 2, 3].map((part) => {
        baseline += Math.ceil(size * 1.25);
        return run(
          characters.slice(part * 40, part * 40 + 8).join(''),
          4 + part * 0.25,
          baseline,
          size,
        );
      }),
    );
    const painted = paintBoth(list([fill(0, 0, WIDTH, HEIGHT, srgb(1, 1, 1)), ...runs]));
    expect(painted.onGpu).toBe(true);
    expect(maxDelta(painted)).toBeLessThanOrEqual(TEXT_TOLERANCE);
  });

  it('paints a list the GPU cannot paint exactly through the canvas pen, copied in pixel for pixel', () => {
    const painted = paintBoth(
      list([
        fill(0, 0, WIDTH, HEIGHT, srgb(1, 1, 1)),
        {
          kind: 'fill-path',
          path: [{ op: 'ellipse', cx: 60, cy: 60, rx: 30, ry: 20 }],
          rule: 'nonzero',
          color: srgb(0.8, 0.2, 0.2),
          ground: 'none',
        },
        run('Copied', 100, 60, 16),
      ]),
    );
    expect(painted.onGpu).toBe(false);
    expect(maxDelta(painted)).toBe(0);
  });

  it('leaves a run that may paint a colour glyph to the canvas pen', () => {
    const painted = paintBoth(
      list([fill(0, 0, WIDTH, HEIGHT, srgb(1, 1, 1)), run('Hi ©', 10, 60, 16)]),
    );
    expect(maxDelta(painted)).toBeLessThanOrEqual(TEXT_TOLERANCE);
  });

  it('paints every list through the canvas pen where WebGL has no GPU', () => {
    hardware.gpu = false;
    const painted = paintBoth(
      list([fill(0, 0, WIDTH, HEIGHT, srgb(1, 1, 1)), run('Soft', 10, 60, 16)]),
    );
    expect(painted.onGpu).toBe(false);
    expect(maxDelta(painted)).toBe(0);
  });

  it('answers false for a context that is lost', () => {
    const gl = new OffscreenCanvas(8, 8).getContext('webgl2');
    if (!gl) throw new Error('this browser has no WebGL2');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const painted = renderReaderPrimitivesToGl(list([fill(0, 0, 8, 8)]), {
      gl,
      framebuffer: null,
      width: 8,
      height: 8,
    });
    expect(painted).toBe(false);
  });
});
