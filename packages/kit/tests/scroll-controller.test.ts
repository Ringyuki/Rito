// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderScrollLayout } from '@ritojs/core';
import { createScrollController } from '../src/scroll/controller';
import { createFakeGl } from './helpers/fake-gl';
import {
  capabilityFrom,
  caret,
  exactRange,
  flushMicrotasks,
  resolvedCaret,
} from './helpers/native-selection';

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

/** A view over a reader that selects text, scrolled 500 px down, and a mouse pointer event maker. */
function selectingView() {
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
  Object.defineProperty(canvas, 'clientWidth', { value: 400 });
  Object.defineProperty(canvas, 'clientHeight', { value: 600 });
  const controller = createScrollController(reader as unknown as Reader, canvas);
  const pointer = (type: string, x: number, y: number) =>
    new PointerEvent(type, { pointerType: 'mouse', button: 0, clientX: x, clientY: y, detail: 1 });
  return { canvas, controller, fills, pointer, reader };
}

/** Stands in for the overlay canvases, recording every rect filled, scaled. */
function stubOffscreenCanvas(): number[][] {
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

  it('selects across windows with a mouse drag, draws it over each and clears it with a click', async () => {
    const { canvas, controller, fills, pointer } = selectingView();
    const selections: { text: string; rects: readonly unknown[] }[] = [];
    controller.on('selection', (selection) => selections.push(selection));
    const taps: unknown[] = [];
    controller.on('tap', (tapped) => taps.push(tapped));
    controller.mount(document.body);
    controller.scrollTo(500);
    runFrames();

    // Pressed in the first window, dragged into the second.
    canvas.dispatchEvent(pointer('pointerdown', 30, 50));
    canvas.dispatchEvent(pointer('pointermove', 60, 200));
    canvas.dispatchEvent(pointer('pointerup', 60, 200));
    await flushMicrotasks();
    runFrames();
    // Held clear of the view's ends, the drag left the strip where it was.
    expect(controller.offset).toBe(500);
    expect(controller.selection?.selectedText).toBe('selected text');
    expect(selections.at(-1)?.text).toBe('selected text');
    // The first window's rect 500 px up the view, the second's 100 down,
    // each in from its page's margins.
    expect(controller.selectionRects()).toEqual([
      { x: 30, y: 50, width: 100, height: 18 },
      { x: 20, y: 130, width: 40, height: 18 },
    ]);
    // Any page rect maps the same way, a page off screen to nothing.
    expect(
      controller.viewRects([
        { pageIndex: 1, x: 0, y: 0, width: 40, height: 18 },
        { pageIndex: 4, x: 0, y: 0, width: 40, height: 18 },
      ]),
    ).toEqual([{ x: 20, y: 130, width: 40, height: 18 }]);
    expect(fills).toEqual(
      expect.arrayContaining([
        [30, 550, 100, 18],
        [20, 30, 40, 18],
      ]),
    );
    expect(taps).toEqual([]);

    // A click selects nothing: it clears the selection and taps.
    canvas.dispatchEvent(pointer('pointerdown', 60, 300));
    canvas.dispatchEvent(pointer('pointerup', 60, 300));
    await flushMicrotasks();
    expect(controller.selection).toBeNull();
    await vi.waitFor(() => {
      expect(taps).toHaveLength(1);
    });
    controller.dispose();
  });

  it('moves the focus with a Shift chord, read by its line, and keeps it on screen', async () => {
    const { canvas, controller, pointer, reader } = selectingView();
    const movements: string[] = [];
    // Each movement lands the focus on the third window's page, 500 px into
    // its content box, on a vertical line.
    const textSelection = (reader as unknown as { interactions: { textSelection: object } })
      .interactions.textSelection;
    Object.assign(textSelection, {
      resolveTextSelectionMovement: ({
        anchor,
        movement,
      }: {
        anchor: ReturnType<typeof caret>;
        movement: string;
      }) => {
        movements.push(movement);
        const focus = {
          ...caret(40, 2),
          geometry: { x: 40, y: 500, width: 0, height: 18 },
          writingMode: 'vertical-rl',
        } as ReturnType<typeof caret>;
        return Promise.resolve({ status: 'resolved', range: exactRange(anchor, focus) });
      },
    });
    controller.mount(document.body);
    controller.scrollTo(500);
    runFrames();
    canvas.dispatchEvent(pointer('pointerdown', 30, 50));
    canvas.dispatchEvent(pointer('pointermove', 60, 200));
    canvas.dispatchEvent(pointer('pointerup', 60, 200));
    await flushMicrotasks();
    runFrames();

    const shift = (key: string) =>
      new KeyboardEvent('keydown', { key, shiftKey: true, cancelable: true });
    window.dispatchEvent(shift('ArrowDown'));
    await flushMicrotasks();
    runFrames();
    expect(movements).toEqual(['lineDown']);
    // The third window starts 900 px in: the focus 930 px down the view,
    // brought in to 40 px above its bottom.
    expect(controller.offset).toBe(500 + (900 - 500 + 30 + 500 + 18) - (600 - 40));

    // On a vertical line, left moves on to the next line.
    window.dispatchEvent(shift('ArrowLeft'));
    await flushMicrotasks();
    expect(movements).toEqual(['lineDown', 'lineDown']);
    controller.dispose();
  });

  it('selects the word under a touch held still and follows it, without scrolling', async () => {
    const { canvas, controller, reader } = selectingView();
    const words: string[] = [];
    const textSelection = (reader as unknown as { interactions: { textSelection: object } })
      .interactions.textSelection;
    Object.assign(textSelection, {
      resolveTextRangeFromPoints: ({
        anchor,
        focus,
        granularity,
      }: {
        anchor: { pageIndex: number; x: number };
        focus: { pageIndex: number; x: number };
        granularity: string;
      }) => {
        words.push(granularity);
        return Promise.resolve({
          status: 'resolved',
          range: exactRange(
            caret(Math.round(anchor.x), anchor.pageIndex),
            caret(Math.round(focus.x), focus.pageIndex),
          ),
        });
      },
    });
    controller.mount(document.body);
    controller.scrollTo(500);
    runFrames();
    const touch = (type: string, x: number, y: number) =>
      new PointerEvent(type, { pointerType: 'touch', isPrimary: true, clientX: x, clientY: y });
    canvas.dispatchEvent(touch('pointerdown', 30, 50));
    await new Promise((resolve) => setTimeout(resolve, 400));
    canvas.dispatchEvent(touch('pointermove', 60, 200));
    canvas.dispatchEvent(touch('pointerup', 60, 200));
    await flushMicrotasks();
    runFrames();
    expect(words[0]).toBe('word');
    expect(controller.selection?.selectedText).toBe('selected text');
    expect(controller.offset).toBe(500);
    controller.dispose();
  });

  it("gives the selection's ends as handles and moves an end dragged by its handle", async () => {
    const { canvas, controller, pointer, reader } = selectingView();
    const textSelection = (
      reader as unknown as {
        interactions: { textSelection: { resolveTextRangeToPoint: () => unknown } };
      }
    ).interactions.textSelection;
    const asked = vi.spyOn(textSelection, 'resolveTextRangeToPoint');
    controller.mount(document.body);
    controller.scrollTo(500);
    runFrames();
    canvas.dispatchEvent(pointer('pointerdown', 30, 50));
    canvas.dispatchEvent(pointer('pointermove', 60, 200));
    canvas.dispatchEvent(pointer('pointerup', 60, 200));
    await flushMicrotasks();
    runFrames();
    const handles = controller.selectionHandles();
    // The focus, dragged to view x 60 over the second window, is the end:
    // where the pointer let go, at the top of that window's content box.
    expect(handles?.focusEdge).toBe('end');
    expect(handles?.end).toEqual({ x: 60, y: 130, width: 0, height: 18 });
    const before = asked.mock.calls.length;
    const drag = controller.beginSelectionHandleDrag('end', { clientX: 80, clientY: 130 });
    expect(drag).not.toBeNull();
    drag?.update({ clientX: 120, clientY: 300 });
    drag?.finish({ clientX: 120, clientY: 300 });
    await flushMicrotasks();
    runFrames();
    expect(asked.mock.calls.length).toBeGreaterThan(before);
    expect(controller.selection?.selectedText).toBe('selected text');
    controller.dispose();
  });

  it('scrolls on under a drag held near the end of the view until the button lets go', async () => {
    const { canvas, controller, pointer } = selectingView();
    controller.mount(document.body);
    controller.scrollTo(500);
    runFrames();
    canvas.dispatchEvent(pointer('pointerdown', 30, 50));
    // 10 px from the view's bottom: 18 px a frame.
    canvas.dispatchEvent(pointer('pointermove', 30, 590));
    await flushMicrotasks();
    runFrames(5);
    expect(controller.offset).toBeGreaterThan(500);
    canvas.dispatchEvent(pointer('pointerup', 30, 590));
    const held = controller.offset;
    runFrames();
    expect(controller.offset).toBe(held);
    controller.dispose();
  });

  it('mirrors the text of the windows on screen once the strip rests, and taps a link activated there', async () => {
    const reader = fakeReader();
    const nodes = (pageIndex: number) => [
      {
        role: 'paragraph' as const,
        text: `page ${String(pageIndex)}`,
        bounds: { x: 0, y: 0, width: 300, height: 20 },
        children: [],
      },
      {
        role: 'link' as const,
        text: `to ${String(pageIndex + 1)}`,
        href: 'next.xhtml',
        bounds: { x: 0, y: 40, width: 60, height: 20 },
        children: [],
      },
    ];
    Object.assign(reader, {
      interactions: {
        enabled: true,
        getPageSemantics: (pageIndex: number) =>
          Promise.resolve({ pageIndex, spreadIndex: pageIndex, nodes: nodes(pageIndex) }),
        getPageTargets: (pageIndex: number) =>
          Promise.resolve({
            pageIndex,
            spreadIndex: pageIndex,
            targets: [
              { kind: 'link', bounds: { x: 0, y: 40, width: 60, height: 20 }, href: 'next.xhtml' },
            ],
          }),
      },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const controller = createScrollController(reader as unknown as Reader, fakeCanvas(), {
      input: false,
      a11y: { enabled: true },
    });
    const taps: { point: { spreadIndex: number } }[] = [];
    controller.on('tap', (tapped) => taps.push(tapped));
    controller.mount(container);
    // The mirror goes in as an idle task once the frame after rest is drawn.
    const mirrors = async (text: string) => {
      await vi.waitFor(() => {
        runFrames();
        expect(container.textContent).toContain(text);
      });
    };
    await mirrors('page 0');
    expect(container.textContent).not.toContain('page 1');

    // Scrolled so the first two windows share the screen: both pages are read.
    controller.scrollTo(500);
    await mirrors('page 1');
    expect(container.textContent).toContain('page 0');

    const links = container.querySelectorAll('a');
    links[1]?.dispatchEvent(new MouseEvent('click', { cancelable: true }));
    await vi.waitFor(() => {
      expect(taps).toHaveLength(1);
    });
    expect(taps[0]?.point.spreadIndex).toBe(1);
    controller.dispose();
    expect(container.querySelector('[aria-live]')).toBeNull();
    container.remove();
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
