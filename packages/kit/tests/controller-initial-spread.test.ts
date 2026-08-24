// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderLocatorResolution } from '@ritojs/core';
import { createController } from '../src/controller';

beforeEach(() => {
  vi.stubGlobal(
    'OffscreenCanvas',
    class OffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return { clearRect: vi.fn(), drawImage: vi.fn() };
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('controller initial spread', () => {
  it('renders and notifies the reader active spread without touching spread zero', () => {
    const frame = stubFrameScheduling();
    const fixture = createReaderFixture(2);
    const controller = createController(fixture.reader, createCanvas());

    expect(controller.currentSpread).toBe(2);
    expect(fixture.notifyActiveSpread).toHaveBeenCalledOnce();
    expect(fixture.notifyActiveSpread).toHaveBeenCalledWith(2);

    frame.run();

    expect(fixture.renderSpreadTo).toHaveBeenCalledOnce();
    expect(fixture.renderSpreadTo.mock.calls[0]?.[0]).toBe(2);
    expect(fixture.renderSpreadTo).not.toHaveBeenCalledWith(0, expect.anything());
    controller.dispose();
  });

  it('falls back to spread zero when the reader has no active spread accessor', () => {
    const frame = stubFrameScheduling();
    const fixture = createReaderFixture('missing');
    const controller = createController(fixture.reader, createCanvas());

    expect(controller.currentSpread).toBe(0);
    expect(fixture.notifyActiveSpread).toHaveBeenCalledWith(0);

    frame.run();

    expect(fixture.renderSpreadTo.mock.calls[0]?.[0]).toBe(0);
    controller.dispose();
  });

  it('clamps an out-of-range reader active spread to the current extent', () => {
    stubFrameScheduling();
    const fixture = createReaderFixture(99);
    const controller = createController(fixture.reader, createCanvas());

    expect(controller.currentSpread).toBe(2);
    expect(fixture.notifyActiveSpread).toHaveBeenCalledWith(2);
    controller.dispose();
  });

  it('keeps the fallback offscreen and paints the restored target before persistence settles', async () => {
    const frame = stubCancellableFrameScheduling();
    const resolution = deferred<ReaderLocatorResolution | undefined>();
    const persisted = deferred<undefined>();
    const save = vi.fn(() => persisted.promise);
    const displayDraw = vi.fn();
    const fixture = createReaderFixture(0);
    Object.assign(fixture.reader, {
      manifestHrefMap: new Map([['chapter', 'Text/chapter.xhtml']]),
      navigateToLocator: vi.fn(() => resolution.promise),
    });
    const controller = createController(fixture.reader, createCanvas(displayDraw), {
      positionStorage: {
        load: vi.fn(() => Promise.resolve(null)),
        save,
        clear: vi.fn(() => Promise.resolve()),
      },
    });

    const restoring = controller.restorePosition(
      JSON.stringify({
        locator: { spineIdref: 'chapter', chapterProgress: 1 },
        projection: { spreadIndex: 2, pageIndex: 2 },
        progress: 1,
        timestamp: 1,
      }),
    );
    frame.run();

    expect(fixture.renderSpreadTo).not.toHaveBeenCalled();

    resolution.resolve({
      status: 'resolved',
      locator: { href: 'Text/chapter.xhtml', progression: 1 },
      spineIdref: 'chapter',
      pageIndex: 2,
      spreadIndex: 2,
      matchedBy: 'progression',
    });
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    frame.run();

    expect(controller.currentSpread).toBe(2);
    expect(displayDraw).toHaveBeenCalledOnce();
    expect(fixture.renderSpreadTo).toHaveBeenCalledOnce();
    expect(fixture.renderSpreadTo).toHaveBeenCalledWith(2, expect.anything());

    persisted.resolve(undefined);
    await expect(restoring).resolves.toBe(2);
    controller.dispose();
  });
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function stubFrameScheduling(): { readonly run: () => void } {
  let pendingFrame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pendingFrame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'requestIdleCallback',
    vi.fn(() => 2),
  );
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  return {
    run: () => {
      const callback = pendingFrame;
      pendingFrame = undefined;
      callback?.(16);
    },
  };
}

function stubCancellableFrameScheduling(): { readonly run: () => void } {
  let nextId = 0;
  const pendingFrames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId;
    pendingFrames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pendingFrames.delete(id);
  });
  vi.stubGlobal(
    'requestIdleCallback',
    vi.fn(() => 1000),
  );
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  return {
    run: () => {
      const next = pendingFrames.entries().next().value as
        | readonly [number, FrameRequestCallback]
        | undefined;
      if (!next) return;
      pendingFrames.delete(next[0]);
      next[1](16);
    },
  };
}

function createCanvas(drawImage = vi.fn()): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    drawImage,
  })) as unknown as typeof canvas.getContext;
  return canvas;
}

function createReaderFixture(activeSpreadIndex: number | 'missing'): {
  readonly reader: Reader;
  readonly renderSpreadTo: ReturnType<typeof vi.fn>;
  readonly notifyActiveSpread: ReturnType<typeof vi.fn>;
} {
  const pages = [0, 1, 2].map((index) => ({
    index,
    bounds: { x: 0, y: 0, width: 300, height: 400 },
    content: [],
  }));
  const spreads = pages.map((left, index) => ({ index, left }));
  const renderSpreadTo = vi.fn(() => true);
  const notifyActiveSpread = vi.fn();
  const base = {
    metadata: { title: 'Demo' },
    totalSpreads: spreads.length,
    toc: [],
    chapterMap: new Map(),
    manifestHrefMap: new Map(),
    pages,
    spreads,
    dpr: 1,
    renderSpread: vi.fn(),
    renderSpreadTo,
    notifyActiveSpread,
    resize: vi.fn(),
    setSpreadMode: vi.fn(),
    setLineBreaking: vi.fn(),
    updateLayout: vi.fn(() => false),
    setTheme: vi.fn(),
    findPage: vi.fn(),
    findSpread: vi.fn(),
    resolveTocEntry: vi.fn(),
    findActiveTocEntry: vi.fn(),
    getCanvasSize: vi.fn(() => ({ width: 300, height: 400 })),
    getLayoutGeometry: vi.fn(() => ({
      viewportWidth: 300,
      viewportHeight: 400,
      marginLeft: 0,
      marginTop: 0,
      spreadGap: 0,
    })),
    getChapterTextIndices: vi.fn(() => new Map()),
    getFootnotes: vi.fn(() => new Map()),
    getImageBlobUrl: vi.fn(),
    measurer: {},
    setTypography: vi.fn(() => false),
    onSpreadRendered: vi.fn(() => () => undefined),
    dispose: vi.fn(),
  };
  const reader = activeSpreadIndex === 'missing' ? base : { ...base, activeSpreadIndex };
  return { reader: reader as unknown as Reader, renderSpreadTo, notifyActiveSpread };
}
