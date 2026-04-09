// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import type { Reader, ReaderOptions } from '../../src/reader';

vi.mock('../../src/render/assets/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/assets/resources')>();
  const mockMeasurer = createMockTextMeasurer(0.6);
  return {
    ...actual,
    loadAssets: vi.fn(() =>
      Promise.resolve({
        images: new Map<string, ImageBitmap>(),
        measurer: mockMeasurer,
      }),
    ),
    disposeAssets: vi.fn(),
  };
});

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

function createMockCanvas(): HTMLCanvasElement {
  const mockCtx = createMockCanvasContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => mockCtx.ctx),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

/** Create a mock context with a .canvas property that has settable width/height. */
function createExternalContext(width: number, height: number) {
  const mockCtx = createMockCanvasContext();
  const canvasObj = { width, height };
  // Override the proxy's getter to return canvasObj for .canvas
  const ctx = new Proxy(mockCtx.ctx, {
    get(target, prop) {
      if (prop === 'canvas') return canvasObj;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return Reflect.get(target, prop);
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, mockCtx };
}

const DEFAULT_OPTIONS: ReaderOptions = {
  width: 800,
  height: 600,
  margin: 40,
  spread: 'single',
  devicePixelRatio: 1,
};

async function buildReader(): Promise<Reader> {
  const { createReader } = await import('../../src/reader');
  const data = buildMinimalEpub({
    chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello World</p>') }],
  });
  const canvas = createMockCanvas();
  return createReader(data, canvas, DEFAULT_OPTIONS);
}

describe('renderSpreadTo', () => {
  it('is a function on the reader', async () => {
    const reader = await buildReader();
    expect(typeof reader.renderSpreadTo).toBe('function');
    reader.dispose();
  });

  it('renders to an external context without firing onSpreadRendered', async () => {
    const reader = await buildReader();
    const listener = vi.fn();
    reader.onSpreadRendered(listener);

    const { ctx, mockCtx } = createExternalContext(800, 600);

    reader.renderSpreadTo(0, ctx);

    // Should NOT fire listeners
    expect(listener).not.toHaveBeenCalled();

    // Should have drawn something (clearRect at minimum)
    expect(mockCtx.getCalls('clearRect').length).toBeGreaterThan(0);

    reader.dispose();
  });

  it('silently ignores out-of-range indices', async () => {
    const reader = await buildReader();
    const { ctx } = createExternalContext(800, 600);

    // Should not throw
    reader.renderSpreadTo(-1, ctx);
    reader.renderSpreadTo(999, ctx);

    reader.dispose();
  });
});

describe('notifyActiveSpread', () => {
  it('is a function on the reader', async () => {
    const reader = await buildReader();
    expect(typeof reader.notifyActiveSpread).toBe('function');
    reader.dispose();
  });

  it('fires onSpreadRendered listeners with correct arguments', async () => {
    const reader = await buildReader();
    const listener = vi.fn();
    reader.onSpreadRendered(listener);

    reader.notifyActiveSpread(0);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(0, reader.spreads[0]);

    reader.dispose();
  });

  it('does not fire for out-of-range index', async () => {
    const reader = await buildReader();
    const listener = vi.fn();
    reader.onSpreadRendered(listener);

    reader.notifyActiveSpread(999);

    expect(listener).not.toHaveBeenCalled();

    reader.dispose();
  });
});

describe('renderSpread vs renderSpreadTo + notifyActiveSpread', () => {
  it('renderSpread fires listeners while renderSpreadTo does not', async () => {
    const reader = await buildReader();
    const listener = vi.fn();
    reader.onSpreadRendered(listener);

    // renderSpread fires listener
    reader.renderSpread(0);
    expect(listener).toHaveBeenCalledTimes(1);

    listener.mockClear();

    // renderSpreadTo does NOT fire listener
    const { ctx } = createExternalContext(800, 600);
    reader.renderSpreadTo(0, ctx);
    expect(listener).not.toHaveBeenCalled();

    // notifyActiveSpread fires listener without painting
    reader.notifyActiveSpread(0);
    expect(listener).toHaveBeenCalledTimes(1);

    reader.dispose();
  });
});
