// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import { createController } from '../src/controller';
import { acceptsKeyboardManagerInput } from '../src/keyboard/input-state';
import { readerInteractions } from './helpers/native-selection';
import { createFakeGl } from './helpers/fake-gl';

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

describe('a suspended controller', () => {
  it('answers none of the layouts another view asks for, and takes the last one up when it resumes', () => {
    const frames = stubFrames();
    const fixture = createReaderFixture(3, 1);
    const controller = createController(fixture.reader, createCanvas());
    const container = document.createElement('div');
    document.body.append(container);
    controller.mount(container);
    const layouts = vi.fn();
    controller.on('layoutChange', layouts);
    fixture.notifyActiveSpread.mockClear();

    controller.suspend();
    expect(controller.suspended).toBe(true);
    // Scrolled: eight windows, the fifth read; then paged again on spread 2.
    fixture.commit(8, 4);
    controller.nextSpread();
    controller.goToSpread(6);
    fixture.commit(3, 2);
    frames.runAll();

    expect(layouts).not.toHaveBeenCalled();
    expect(fixture.notifyActiveSpread).not.toHaveBeenCalled();
    expect(fixture.renderSpreadTo).not.toHaveBeenCalled();

    controller.resume();
    frames.runAll();

    expect(controller.suspended).toBe(false);
    expect(controller.currentSpread).toBe(2);
    expect(layouts).toHaveBeenCalledOnce();
    expect(fixture.notifyActiveSpread).toHaveBeenCalledWith(2);
    expect(fixture.renderSpreadTo.mock.calls[0]?.[0]).toBe(2);
    controller.dispose();
  });

  it('takes its canvas off the page and lets its buffer go, and puts it back where it was mounted last', () => {
    stubFrames();
    const fixture = createReaderFixture(3, 0);
    const canvas = createCanvas();
    const controller = createController(fixture.reader, canvas);
    const first = document.createElement('div');
    const second = document.createElement('div');
    document.body.append(first, second);
    controller.mount(first);

    controller.suspend();
    expect(canvas.isConnected).toBe(false);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);

    // Mounted meanwhile: that is where it goes back, and not before.
    controller.mount(second);
    expect(canvas.isConnected).toBe(false);

    controller.resume();
    expect(canvas.parentElement).toBe(second);
    expect(canvas.width).toBeGreaterThanOrEqual(300);
    expect(canvas.height).toBeGreaterThanOrEqual(400);
    controller.dispose();
  });

  it('takes no keys meanwhile and leaves the host enabling them as it was', () => {
    stubFrames();
    const controller = createController(createReaderFixture(3, 0).reader, createCanvas());

    controller.suspend();
    expect(acceptsKeyboardManagerInput(controller.keyboard)).toBe(false);
    controller.keyboard.setEnabled(true);
    expect(acceptsKeyboardManagerInput(controller.keyboard)).toBe(false);
    controller.resume();
    expect(acceptsKeyboardManagerInput(controller.keyboard)).toBe(true);

    controller.keyboard.setEnabled(false);
    controller.suspend();
    controller.resume();
    expect(acceptsKeyboardManagerInput(controller.keyboard)).toBe(false);
    controller.dispose();
  });

  it('still lays the reader out for the view that has it', () => {
    const frames = stubFrames();
    const fixture = createReaderFixture(3, 0);
    const controller = createController(fixture.reader, createCanvas());
    const layouts = vi.fn();
    controller.on('layoutChange', layouts);

    controller.suspend();
    fixture.updateLayout.mockReturnValue(true);
    controller.resize(500, 600);
    controller.setTheme({ backgroundColor: '#000000', foregroundColor: '#ffffff' });
    frames.runAll();

    expect(fixture.updateLayout).toHaveBeenCalledWith(500, 600, undefined, undefined);
    expect(fixture.setTheme).toHaveBeenCalledOnce();
    expect(layouts).not.toHaveBeenCalled();
    expect(fixture.renderSpreadTo).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('is disposed whole while suspended', () => {
    stubFrames();
    const canvas = createCanvas();
    const controller = createController(createReaderFixture(3, 0).reader, canvas);
    controller.suspend();
    controller.dispose();
    expect(controller.suspended).toBe(false);
    controller.resume();
    expect(canvas.isConnected).toBe(false);
  });
});

function stubFrames(): { readonly runAll: () => void } {
  let nextId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id);
  });
  vi.stubGlobal(
    'requestIdleCallback',
    vi.fn(() => 1000),
  );
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  return {
    runAll: () => {
      for (let round = 0; round < 10 && pending.size > 0; round += 1) {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(16 * (round + 1));
      }
    },
  };
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const fake = createFakeGl(canvas);
  canvas.getContext = vi.fn((kind: string) =>
    kind === 'webgl2' ? fake.gl : null,
  ) as unknown as typeof canvas.getContext;
  return canvas;
}

/** A reader whose layout another view can replace: `commit` lays it out with that many spreads. */
function createReaderFixture(
  spreadCount: number,
  active: number,
): {
  readonly reader: Reader;
  readonly renderSpreadTo: ReturnType<typeof vi.fn>;
  readonly notifyActiveSpread: ReturnType<typeof vi.fn>;
  readonly updateLayout: ReturnType<typeof vi.fn>;
  readonly setTheme: ReturnType<typeof vi.fn>;
  readonly commit: (spreadCount: number, active: number) => void;
} {
  const committed = new Set<(activeSpreadIndex: number) => void>();
  const spreadsOf = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      index,
      pageIndexes: [index],
      leftPageIndex: index,
    }));
  const renderSpreadTo = vi.fn(() => true);
  const notifyActiveSpread = vi.fn();
  const updateLayout = vi.fn(() => false);
  const setTheme = vi.fn();
  const reader = {
    metadata: { title: 'Demo' },
    totalSpreads: spreadCount,
    toc: [],
    chapterMap: new Map(),
    manifestHrefMap: new Map(),
    pageCount: spreadCount,
    spreads: spreadsOf(spreadCount),
    activeSpreadIndex: active,
    interactions: readerInteractions(),
    dpr: 1,
    renderSpread: vi.fn(),
    renderSpreadTo,
    notifyActiveSpread,
    resize: vi.fn(),
    setDevicePixelRatio: vi.fn(),
    setSpreadMode: vi.fn(() => false),
    updateLayout,
    setTheme,
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
    getImageBlobUrl: vi.fn(),
    setTypography: vi.fn(() => false),
    onSpreadRendered: vi.fn(() => () => undefined),
    onLayoutCommitted: (listener: (activeSpreadIndex: number) => void) => {
      committed.add(listener);
      return () => committed.delete(listener);
    },
    dispose: vi.fn(),
  };
  const commit = (count: number, activeIndex: number): void => {
    reader.totalSpreads = count;
    reader.pageCount = count;
    reader.spreads = spreadsOf(count);
    reader.activeSpreadIndex = activeIndex;
    for (const listener of [...committed]) listener(activeIndex);
  };
  return {
    reader: reader as unknown as Reader,
    renderSpreadTo,
    notifyActiveSpread,
    updateLayout,
    setTheme,
    commit,
  };
}
