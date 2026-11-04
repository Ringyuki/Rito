import { afterEach, beforeEach, vi } from 'vitest';
import type { Reader, ReaderScrollLayout } from '@ritojs/core';
import { createScrollController } from '../../src/scroll/controller';
import { createFakeGl } from './fake-gl';
import { capabilityFrom, caret, exactRange, resolvedCaret } from './native-selection';

export const LAYOUT: ReaderScrollLayout = {
  axis: 'down',
  windowLength: 600,
  chapters: [
    { firstSpread: 0, spreadCount: 2, extent: 900 },
    { firstSpread: 2, spreadCount: 3, extent: 1_500 },
  ],
};

/** A reader on a scrolled layout, 400 × 600 at ratio 1, margins 30. */
export function fakeReader() {
  const committed: (() => void)[] = [];
  const invalidated: ((spreadIndex: number) => void)[] = [];
  const reader = {
    dpr: 1,
    activeSpreadIndex: 0,
    spreads: Array.from({ length: 5 }, (_, index) => ({ index, leftPageIndex: index })),
    painted: [] as number[],
    active: [] as number[],
    getLayoutGeometry: () => ({ marginTop: 30, marginRight: 30 }),
    layout: LAYOUT,
    getScrollLayout: () => reader.layout,
    getCanvasSize: () => ({ width: 400, height: 600 }),
    renderSpreadTo(spreadIndex: number) {
      reader.painted.push(spreadIndex);
      return true;
    },
    notifyActiveSpread(spreadIndex: number) {
      reader.active.push(spreadIndex);
      reader.activeSpreadIndex = spreadIndex;
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

export function fakeCanvas() {
  const fake = createFakeGl();
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockImplementation(((kind: string) =>
    kind === 'webgl2' ? fake.gl : null) as never);
  return canvas;
}

/** A view over a reader that selects text, scrolled 500 px down, and a mouse pointer event maker. */
export function selectingView() {
  const fills = stubOffscreenCanvas();
  const reader = fakeReader();
  Object.assign(reader, {
    getLayoutGeometry: () => ({ marginTop: 30, marginRight: 30, marginLeft: 20 }),
    interactions: {
      enabled: true,
      textSelection: capabilityFrom(
        (point) => Promise.resolve(resolvedCaret(caret(Math.round(point.x), point.pageIndex))),
        (anchor, focus) =>
          Promise.resolve({
            status: 'resolved' as const,
            range: {
              ...exactRange(anchor, focus),
              rects: [
                { pageIndex: 0, spreadIndex: 0, x: 10, y: 520, width: 100, height: 18 },
                { pageIndex: 1, spreadIndex: 1, x: 0, y: 0, width: 40, height: 18 },
              ],
            },
          }),
      ),
      getPageTargets: () => Promise.resolve(undefined),
    },
  });
  const canvas = fakeCanvas();
  canvas.setPointerCapture = () => undefined;
  Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
  const controller = createScrollController(reader as unknown as Reader, canvas);
  const pointer = (type: string, x: number, y: number) =>
    new PointerEvent(type, { pointerType: 'mouse', button: 0, clientX: x, clientY: y, detail: 1 });
  return { canvas, controller, fills, pointer, reader };
}

/** Stands in for the overlay canvases, recording every rect filled, scaled. */
export function stubOffscreenCanvas(): number[][] {
  const fills: number[][] = [];
  class Offscreen {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      let scale = 1;
      return {
        canvas: this,
        clearRect: () => undefined,
        save: () => undefined,
        restore: () => undefined,
        scale: (by: number) => {
          scale = by;
        },
        fillRect: (x: number, y: number, width: number, height: number) => {
          fills.push([x * scale, y * scale, width * scale, height * scale]);
        },
        fillStyle: '',
      };
    }
  }
  vi.stubGlobal('OffscreenCanvas', Offscreen);
  return fills;
}

let frames: FrameRequestCallback[] = [];
let now = 0;
/** Runs animation frames 16 ms apart until none is asked for. */
export function runFrames(limit = 500): void {
  for (let frame = 0; frame < limit && frames.length > 0; frame += 1) {
    const due = frames;
    frames = [];
    now += 16;
    for (const callback of due) callback(now);
  }
}

/** Frames run by hand and the clock they read, in each test of the file that calls it. */
export function stubScrollFrames(): void {
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
}
