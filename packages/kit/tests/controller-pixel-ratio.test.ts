// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createController } from '../src/controller';
import { readerInteractions } from './helpers/native-selection';
import { createFakeGl } from './helpers/fake-gl';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A screen at `ratio` whose resolution query can be told it changed. */
function stubScreen(ratio: number) {
  const changes: (() => void)[] = [];
  vi.stubGlobal('devicePixelRatio', ratio);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      media: query,
      matches: false,
      addEventListener: (_type: string, listener: () => void) => changes.push(listener),
      removeEventListener: (_type: string, listener: () => void) => {
        const at = changes.indexOf(listener);
        if (at >= 0) changes.splice(at, 1);
      },
    })),
  );
  return {
    moveTo(next: number): void {
      vi.stubGlobal('devicePixelRatio', next);
      for (const listener of changes.splice(0)) listener();
    },
  };
}

function createReader(dpr: number) {
  return {
    metadata: { title: 'Demo' },
    totalSpreads: 1,
    toc: [],
    chapterMap: new Map(),
    manifestHrefMap: new Map(),
    pageCount: 1,
    spreads: [{ index: 0, pageIndexes: [0], leftPageIndex: 0 }],
    interactions: readerInteractions(),
    dpr,
    renderSpread: vi.fn(),
    renderSpreadTo: vi.fn(() => true),
    notifyActiveSpread: vi.fn(),
    resize: vi.fn(),
    setDevicePixelRatio: vi.fn(),
    setSpreadMode: vi.fn(),
    updateLayout: vi.fn(() => false),
    setTheme: vi.fn(),
    findPage: vi.fn(),
    findSpread: vi.fn(),
    resolveTocEntry: vi.fn(),
    findActiveTocEntry: vi.fn(),
    getCanvasSize: vi.fn(() => ({ width: 400, height: 300 })),
    getLayoutGeometry: vi.fn(() => ({
      viewportWidth: 400,
      viewportHeight: 300,
      marginLeft: 40,
      marginTop: 40,
      spreadGap: 20,
    })),
    getImageBlobUrl: vi.fn(),
    setTypography: vi.fn(() => false),
    onSpreadRendered: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

describe('the controller and the screen', () => {
  it("keeps the reader laid out at the screen's pixel ratio", () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const screen = stubScreen(1);
    const canvas = document.createElement('canvas');
    const gl = createFakeGl(canvas).gl;
    canvas.getContext = vi.fn((kind: string) =>
      kind === 'webgl2' ? gl : null,
    ) as unknown as typeof canvas.getContext;
    const reader = createReader(2);

    const controller = createController(reader as never, canvas);
    // Opened at another ratio than the screen's: laid out at the screen's.
    expect(reader.setDevicePixelRatio).toHaveBeenLastCalledWith(1);

    // The page zoomed, or the window went to another screen.
    screen.moveTo(1.5);
    expect(reader.setDevicePixelRatio).toHaveBeenLastCalledWith(1.5);

    controller.dispose();
    reader.setDevicePixelRatio.mockClear();
    screen.moveTo(2);
    expect(reader.setDevicePixelRatio).not.toHaveBeenCalled();
  });
});
