// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createController } from '../src/controller';

beforeAll(() => {
  if (typeof globalThis['OffscreenCanvas'] === 'undefined') {
    (globalThis as Record<string, unknown>)['OffscreenCanvas'] = class OffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return {
          clearRect: vi.fn(),
          drawImage: vi.fn(),
        };
      }
    };
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createController', () => {
  it('applies the initial renderScale before the first mount/render cycle', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const canvas = document.createElement('canvas');
    const clearRect = vi.fn();
    const drawImage = vi.fn();
    canvas.getContext = vi.fn(() => ({
      clearRect,
      drawImage,
    })) as unknown as typeof canvas.getContext;

    const getCanvasSize = vi.fn((scale = 1) => ({
      width: Math.round(400 * scale),
      height: Math.round(300 * scale),
    }));

    const reader = {
      metadata: { title: 'Demo' },
      totalSpreads: 1,
      toc: [],
      chapterMap: new Map(),
      manifestHrefMap: new Map(),
      pages: [],
      spreads: [{ left: { index: 0 }, right: undefined }],
      dpr: 2,
      renderSpread: vi.fn(),
      renderSpreadTo: vi.fn(),
      notifyActiveSpread: vi.fn(),
      resize: vi.fn(),
      setSpreadMode: vi.fn(),
      updateLayout: vi.fn(() => false),
      setTheme: vi.fn(),
      findPage: vi.fn(),
      findSpread: vi.fn(),
      resolveTocEntry: vi.fn(),
      findActiveTocEntry: vi.fn(),
      getCanvasSize,
      getLayoutGeometry: vi.fn(() => ({
        viewportWidth: 400,
        viewportHeight: 300,
        marginLeft: 40,
        marginTop: 40,
        spreadGap: 20,
      })),
      getChapterTextIndices: vi.fn(() => new Map()),
      getFootnotes: vi.fn(() => new Map()),
      getImageBlobUrl: vi.fn(),
      measurer: {},
      setTypography: vi.fn(() => false),
      onSpreadRendered: vi.fn(() => () => {}),
      dispose: vi.fn(),
    };

    const controller = createController(reader as never, canvas, { renderScale: 1.2 });

    expect(controller.renderScale).toBe(1.2);
    expect(getCanvasSize).toHaveBeenCalledWith(1.2);
    expect(canvas.style.width).toBe('480px');
    expect(canvas.style.height).toBe('360px');
    expect(canvas.width).toBe(960);
    expect(canvas.height).toBe(720);
  });
});
