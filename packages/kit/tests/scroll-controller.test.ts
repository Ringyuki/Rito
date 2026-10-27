// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderScrollLayout } from '@ritojs/core';
import { createScrollController } from '../src/scroll/controller';
import { createFakeGl } from './helpers/fake-gl';

const LAYOUT: ReaderScrollLayout = {
  axis: 'down',
  windowLength: 600,
  chapters: [
    { firstSpread: 0, spreadCount: 2, extent: 900 },
    { firstSpread: 2, spreadCount: 3, extent: 1_500 },
  ],
};

/** A reader on a scrolled layout, 400 × 600 at ratio 1, margins 30. */
function fakeReader() {
  const committed: (() => void)[] = [];
  const invalidated: ((spreadIndex: number) => void)[] = [];
  const reader = {
    dpr: 1,
    activeSpreadIndex: 0,
    spreads: Array.from({ length: 5 }, (_, index) => ({ index, leftPageIndex: index })),
    painted: [] as number[],
    active: [] as number[],
    getLayoutGeometry: () => ({ marginTop: 30, marginRight: 30 }),
    getScrollLayout: () => LAYOUT,
    getCanvasSize: () => ({ width: 400, height: 600 }),
    renderSpreadTo(spreadIndex: number) {
      reader.painted.push(spreadIndex);
      return true;
    },
    notifyActiveSpread(spreadIndex: number) {
      reader.active.push(spreadIndex);
    },
    onLayoutCommitted(listener: () => void) {
      committed.push(listener);
      return () => undefined;
    },
    onSpreadContentInvalidated(listener: (spreadIndex: number) => void) {
      invalidated.push(listener);
      return () => undefined;
    },
    commit: () => {
      for (const listener of committed) listener();
    },
  };
  return reader;
}

function fakeCanvas() {
  const fake = createFakeGl();
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockImplementation(((kind: string) =>
    kind === 'webgl2' ? fake.gl : null) as never);
  return canvas;
}

let frames: FrameRequestCallback[] = [];
let now = 0;
/** Runs animation frames 16 ms apart until none is asked for. */
function runFrames(limit = 500): void {
  for (let frame = 0; frame < limit && frames.length > 0; frame += 1) {
    const due = frames;
    frames = [];
    now += 16;
    for (const callback of due) callback(now);
  }
}

beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('scroll controller', () => {
  it('shows the windows end to end and tells the reader which one is read', () => {
    const reader = fakeReader();
    const controller = createScrollController(reader as unknown as Reader, fakeCanvas(), {
      input: false,
    });
    const windows: number[] = [];
    controller.on('window', ({ spreadIndex }) => windows.push(spreadIndex));
    controller.mount(document.body);
    runFrames();
    expect(controller.axis).toBe('down');
    expect(controller.extent).toBe(2_400);
    // The first window and the one after it, painted ahead.
    expect(reader.painted).toEqual([0, 1]);

    // The reading line, 30 px down, passes into the second window at 570.
    controller.scrollTo(569);
    runFrames();
    expect(reader.active).toEqual([]);
    controller.scrollTo(571);
    runFrames();
    expect(controller.currentSpread).toBe(1);
    expect(reader.active).toEqual([1]);
    expect(windows).toEqual([1]);

    // A window shown from a line 100 px into it puts that line at the reading line.
    controller.scrollToSpread(3, 100);
    runFrames();
    expect(controller.offset).toBe(900 + 600 + 100 - 30);
    expect(controller.currentSpread).toBe(3);
    controller.dispose();
  });

  it('keeps the window under the reading line through a new layout', () => {
    const reader = fakeReader();
    const controller = createScrollController(reader as unknown as Reader, fakeCanvas(), {
      input: false,
    });
    controller.mount(document.body);
    controller.scrollToSpread(3, 250);
    runFrames();
    reader.dpr = 2;
    reader.commit();
    runFrames();
    expect(controller.currentSpread).toBe(3);
    expect(controller.offset).toBe(900 + 600 + 250 - 30);
    controller.dispose();
  });

  it('glides after a fling and comes to rest', () => {
    const reader = fakeReader();
    const controller = createScrollController(reader as unknown as Reader, fakeCanvas(), {
      input: false,
    });
    controller.mount(document.body);
    runFrames();
    const rests: number[] = [];
    controller.on('rest', ({ offset }) => rests.push(offset));
    controller.grab();
    controller.follow(100);
    controller.release(1_000);
    runFrames();
    expect(controller.offset).toBeGreaterThan(100 + 400);
    expect(controller.offset).toBeLessThan(100 + 501);
    expect(rests.at(-1)).toBe(controller.offset);
    controller.dispose();
  });

  it('reads the line at the reading line once the strip rests', async () => {
    const reader = fakeReader();
    const points: unknown[] = [];
    Object.assign(reader, {
      spreads: Array.from({ length: 5 }, (_, index) => ({ index, leftPageIndex: index })),
      interactions: {
        textSelection: {
          resolveCaret: (point: { pageIndex: number }) => {
            points.push(point);
            return Promise.resolve({
              status: 'resolved',
              pageIndex: point.pageIndex,
              spreadIndex: point.pageIndex,
              caret: { sourceLocator: { href: 'two.xhtml', progression: 0.25 } },
            });
          },
        },
      },
    });
    const controller = createScrollController(reader as unknown as Reader, fakeCanvas(), {
      input: false,
    });
    const positions: unknown[] = [];
    controller.on('position', ({ locator }) => positions.push(locator));
    controller.mount(document.body);
    controller.scrollToSpread(3, 100);
    runFrames();
    await vi.waitFor(() => {
      expect(positions).toEqual([{ href: 'two.xhtml', progression: 0.25 }]);
    });
    // The reading line 100 px into the window, a pixel in from the content's start.
    expect(points.at(-1)).toEqual({ pageIndex: 3, x: 1, y: 100 - 30 });
    controller.dispose();
  });

  it('puts a located line at the reading line', async () => {
    const reader = fakeReader();
    Object.assign(reader, {
      navigateToLocator: () =>
        Promise.resolve({ status: 'resolved', spreadIndex: 2, pageIndex: 2, blockOffset: 240 }),
    });
    const controller = createScrollController(reader as unknown as Reader, fakeCanvas(), {
      input: false,
    });
    controller.mount(document.body);
    expect(await controller.scrollToLocator({ href: 'two.xhtml', progression: 0.1 })).toBe(true);
    runFrames();
    expect(controller.offset).toBe(900 + 240 - 30);
    expect(controller.currentSpread).toBe(2);
    controller.dispose();
  });

  it('finds the window and content point under a view point, and taps what is there', async () => {
    const reader = fakeReader();
    Object.assign(reader, {
      getLayoutGeometry: () => ({ marginTop: 30, marginRight: 30, marginLeft: 20 }),
      interactions: {
        getPageTargets: (pageIndex: number) =>
          Promise.resolve({
            pageIndex,
            spreadIndex: pageIndex,
            targets: [
              { kind: 'link', bounds: { x: 0, y: 40, width: 100, height: 20 }, href: 'two.xhtml' },
            ],
          }),
      },
    });
    const canvas = fakeCanvas();
    const controller = createScrollController(reader as unknown as Reader, canvas);
    const taps: { target: unknown }[] = [];
    controller.on('tap', (tapped) => taps.push(tapped));
    controller.mount(document.body);
    controller.scrollTo(500);
    runFrames();
    // 100 px down the view is 600 px into the book: the second window's top.
    const point = controller.pointAt(30, 100);
    expect(point).toEqual({ spreadIndex: 1, pageIndex: 1, x: 10, y: -30 });
    if (point === undefined) throw new Error('a point');
    expect(await controller.targetAt({ ...point, y: 45 })).toMatchObject({ href: 'two.xhtml' });
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 30, clientY: 170 }));
    await vi.waitFor(() => {
      expect(taps).toHaveLength(1);
    });
    expect(taps[0]?.target).toMatchObject({ href: 'two.xhtml' });
    controller.dispose();
  });

  it('reads a leftward strip from the right edge of the view', () => {
    const reader = fakeReader();
    Object.assign(reader, {
      getScrollLayout: () => ({ ...LAYOUT, axis: 'left', windowLength: 400 }),
      getLayoutGeometry: () => ({ marginTop: 30, marginRight: 30, marginLeft: 20 }),
    });
    const controller = createScrollController(reader as unknown as Reader, fakeCanvas(), {
      input: false,
    });
    controller.mount(document.body);
    runFrames();
    expect(controller.pointAt(390, 50)).toEqual({ spreadIndex: 0, pageIndex: 0, x: 370, y: 20 });
    controller.dispose();
  });

  it('moves with the wheel when its own input drives it', () => {
    const reader = fakeReader();
    const canvas = fakeCanvas();
    const controller = createScrollController(reader as unknown as Reader, canvas);
    controller.mount(document.body);
    runFrames();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true }));
    runFrames();
    expect(controller.offset).toBe(120);
    controller.dispose();
  });
});
