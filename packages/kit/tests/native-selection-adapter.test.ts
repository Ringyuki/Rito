import { describe, expect, it, vi } from 'vitest';
import { createLayoutConfig } from '@ritojs/core';
import type {
  ReaderTextRange,
  ReaderTextCaret,
  ReaderTextSelectionInteractions,
  TextMeasurer,
} from '@ritojs/core';
import { createSelectionEngine } from '../src/interaction';
import type { Spread } from '../src/interaction';
import { createCoordinateMapper } from '../src/controller/geometry/coordinate-mapper';
import type { NativeSelectionProjection } from '../src/interaction/selection/engine';
import {
  captureSelectionGesture,
  captureSelectionInteraction,
  isSelectionGestureSuperseded,
  ownsSelectionGesture,
  ownsSelectionInteraction,
  withSelectionGestureProjection,
} from '../src/interaction/selection/selection-interaction-owner';
import {
  capabilityWithRangeToPoint,
  caret,
  deferred,
  flushMicrotasks,
} from './helpers/native-selection';

const config = createLayoutConfig({
  width: 620,
  height: 400,
  margin: 0,
  spread: 'double',
  spreadGap: 20,
});
const spread: Spread = {
  index: 0,
  left: { index: 0, bounds: rect(0, 0), content: [] },
  right: { index: 1, bounds: rect(0, 0), content: [] },
};
const measurer: TextMeasurer = {
  measureText: (text) => ({ width: text.length * 10, height: 20 }),
};
const projection: NativeSelectionProjection = {
  spreadContentToPage(x, y) {
    if (x >= 320 && x <= 620) return { pageIndex: 1, x: x - 320, y };
    if (x >= 0 && x <= 300) return { pageIndex: 0, x, y };
    return null;
  },
  isPageVisible: (pageIndex) => pageIndex === 0 || pageIndex === 1,
  pageContentToSpread(pageIndex, value) {
    if (pageIndex !== 0 && pageIndex !== 1) throw new RangeError('not visible');
    return { ...value, x: value.x + (pageIndex === 1 ? 320 : 0) };
  },
};
const resolveTextRangeFromPoints: ReaderTextSelectionInteractions['resolveTextRangeFromPoints'] =
  () => Promise.resolve({ status: 'miss' });

describe('native SelectionEngine adapter', () => {
  it('keeps an empty caret miss in the same interaction lifecycle', async () => {
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi.fn().mockResolvedValue({ status: 'miss' }),
      resolveTextRange: vi.fn(),
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 10, y: 12 });
    const lease = captureSelectionGesture(engine);
    if (!lease) throw new Error('missing active primary selection lease');
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(ownsSelectionGesture(lease)).toBe(false);
    expect(isSelectionGestureSuperseded(lease)).toBe(false);
  });

  it('projects a cross-page semantic focus through the real adapter entry', async () => {
    const range = exactRange(caret(10), caret(40, 1));
    const resolveCaret = vi.fn<ReaderTextSelectionInteractions['resolveCaret']>();
    const resolveTextRangeFromPoints = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
      .mockResolvedValue({ status: 'resolved', range });
    const capability = capabilityWithRangeToPoint({
      resolveCaret,
      resolveTextRange: vi.fn(),
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 10, y: 12 }, 'paragraph');
    await flushMicrotasks();

    expect(resolveTextRangeFromPoints).toHaveBeenCalledWith({
      anchor: { pageIndex: 0, x: 10, y: 12 },
      focus: { pageIndex: 0, x: 10, y: 12 },
      granularity: 'paragraph',
    });
    expect(resolveCaret).not.toHaveBeenCalled();
    expect(engine.getText()).toBe('exact text');
    expect(engine.getFocusRect()).toEqual({ x: 360, y: 0, width: 0, height: 18 });
    expect(engine.getHandleCarets()).toEqual({
      start: { x: 10, y: 0, width: 0, height: 18 },
      end: { x: 360, y: 0, width: 0, height: 18 },
      focusEdge: 'end',
    });

    engine.handlePointerUp({ x: 10, y: 12 });
    await flushMicrotasks();
    expect(engine.getState()).toBe('selected');
  });

  it('maps right-page points and exact rects without exposing a legacy range', async () => {
    const anchor = caret(10, 1);
    const focus = caret(40, 1);
    const range = exactRange(anchor, focus);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce({ status: 'resolved', pageIndex: 1, spreadIndex: 0, caret: anchor })
      .mockResolvedValueOnce({ status: 'resolved', pageIndex: 1, spreadIndex: 0, caret: focus });
    const capability = capabilityWithRangeToPoint({
      resolveCaret,
      resolveTextRange: vi.fn().mockResolvedValue({ status: 'resolved', range }),
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 330, y: 12 });
    engine.handlePointerUp({ x: 360, y: 12 });
    await flushMicrotasks();

    expect(resolveCaret).toHaveBeenNthCalledWith(1, {
      pageIndex: 1,
      x: 10,
      y: 12,
    });
    expect(resolveCaret).toHaveBeenNthCalledWith(2, {
      pageIndex: 1,
      x: 40,
      y: 12,
    });
    expect(engine.getState()).toBe('selected');
    expect(engine.hasSelection()).toBe(true);
    expect(engine.getSelection()).toBeNull();
    expect(engine.getSnapshot()).toBeNull();
    expect(engine.getText()).toBe('exact text');
    expect(engine.getSourceLocator()).toEqual(range.sourceLocator);
    expect(engine.getRects()).toEqual([{ x: 330, y: 2, width: 30, height: 18 }]);
    expect(engine.getFocusRect()).toEqual({ x: 360, y: 0, width: 0, height: 18 });
    expect(engine.getFocusEdge()).toBe('end');
    expect(engine.getHandleCarets()).toEqual({
      start: { x: 330, y: 0, width: 0, height: 18 },
      end: { x: 360, y: 0, width: 0, height: 18 },
      focusEdge: 'end',
    });
  });

  it('projects normalized endpoints independently from a backward focus', async () => {
    const anchor = caret(70, 1);
    const focus = caret(6);
    const range = exactRange(anchor, focus, 'backward');
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi
        .fn<ReaderTextSelectionInteractions['resolveCaret']>()
        .mockResolvedValueOnce({ status: 'resolved', pageIndex: 1, spreadIndex: 0, caret: anchor })
        .mockResolvedValueOnce({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: focus }),
      resolveTextRange: vi.fn().mockResolvedValue({ status: 'resolved', range }),
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 390, y: 12 });
    engine.handlePointerUp({ x: 6, y: 12 });
    await flushMicrotasks();

    expect(engine.getFocusRect()).toEqual({ x: 6, y: 0, width: 0, height: 18 });
    expect(engine.getFocusEdge()).toBe('start');
    expect(engine.getHandleCarets()).toEqual({
      start: { x: 6, y: 0, width: 0, height: 18 },
      end: { x: 390, y: 0, width: 0, height: 18 },
      focusEdge: 'start',
    });
  });

  it('projects an epoch-bound handle drag and restores its baseline on cancel', async () => {
    const start = caret(10);
    const end = caret(40, 1);
    const movedStart = caret(20);
    const baseline = exactRange(start, end);
    const moved = exactRange(end, movedStart, 'backward');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValue({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: movedStart });
    const resolveTextRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValue({ status: 'resolved', range: moved });
    const capability = capabilityWithRangeToPoint({
      resolveCaret,
      resolveTextRange,
      resolveTextRangeFromPoints: vi
        .fn()
        .mockResolvedValue({ status: 'resolved', range: baseline }),
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);
    engine.handlePointerDown({ x: 10, y: 12 }, 'paragraph');
    await flushMicrotasks();
    engine.handlePointerUp({ x: 10, y: 12 });
    await flushMicrotasks();

    const drag = engine.beginHandleDrag('start');
    expect(drag).not.toBeNull();
    const interaction = captureSelectionInteraction(engine);
    expect(interaction && ownsSelectionInteraction(interaction)).toBe(true);
    expect(engine.getState()).toBe('selecting');
    drag?.update({ x: 20, y: 12 });
    await flushMicrotasks();

    expect(resolveCaret).toHaveBeenCalledWith({ pageIndex: 0, x: 20, y: 12 });
    expect(resolveTextRange).toHaveBeenCalledWith(end, movedStart);
    expect(engine.getHandleCarets()).toEqual({
      start: { x: 20, y: 0, width: 0, height: 18 },
      end: { x: 360, y: 0, width: 0, height: 18 },
      focusEdge: 'start',
    });

    drag?.cancel();
    expect(interaction && ownsSelectionInteraction(interaction)).toBe(false);
    expect(engine.getState()).toBe('selected');
    expect(engine.getHandleCarets()).toEqual({
      start: { x: 10, y: 0, width: 0, height: 18 },
      end: { x: 360, y: 0, width: 0, height: 18 },
      focusEdge: 'end',
    });
  });

  it('rejects a handle session cleared by a synchronous selection listener', async () => {
    const range = exactRange(caret(10), caret(40));
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi.fn(),
      resolveTextRange: vi.fn(),
      resolveTextRangeFromPoints: vi.fn().mockResolvedValue({ status: 'resolved', range }),
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);
    engine.handlePointerDown({ x: 10, y: 12 }, 'paragraph');
    engine.handlePointerUp({ x: 10, y: 12 });
    await flushMicrotasks();

    const stop = engine.onSelectionChange(() => {
      if (engine.getState() === 'selecting') engine.clear();
    });
    const drag = engine.beginHandleDrag('end');

    expect(drag).toBeNull();
    expect(engine.getState()).toBe('idle');
    expect(engine.hasSelection()).toBe(false);
    stop();
  });

  it('keeps capability presence authoritative when the native revision is unavailable', async () => {
    const resolveTextRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi.fn().mockResolvedValue(undefined),
      resolveTextRange,
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 10, y: 12 });
    engine.handlePointerUp({ x: 50, y: 12 });
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.hasSelection()).toBe(false);
    expect(engine.getText()).toBe('');
    expect(resolveTextRange).not.toHaveBeenCalled();
  });

  it('projects a text-range range across both visible pages', async () => {
    const anchor = caret(1);
    const focus = caret(10, 1);
    const range = {
      ...exactRange(anchor, focus),
      rects: [
        { pageIndex: 0, spreadIndex: 0, x: 1, y: 2, width: 20, height: 18 },
        { pageIndex: 1, spreadIndex: 0, x: 1, y: 2, width: 30, height: 18 },
      ],
    };
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi
        .fn<ReaderTextSelectionInteractions['resolveCaret']>()
        .mockResolvedValueOnce({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: anchor })
        .mockResolvedValueOnce({ status: 'resolved', pageIndex: 1, spreadIndex: 0, caret: focus }),
      resolveTextRange: vi.fn().mockResolvedValue({ status: 'resolved', range }),
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 1, y: 10 });
    engine.handlePointerUp({ x: 330, y: 10 });
    await flushMicrotasks();

    expect(engine.getRects()).toEqual([
      { x: 1, y: 2, width: 20, height: 18 },
      { x: 321, y: 2, width: 30, height: 18 },
    ]);
    expect(engine.getFocusRect()).toEqual({ x: 330, y: 0, width: 0, height: 18 });
  });

  it('forwards an append revision and replays the latest projected sample', async () => {
    const range = exactRange(caret(10), caret(40));
    const resolveTextRangeFromPoints = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
      .mockResolvedValue({ status: 'resolved', range });
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi.fn(),
      resolveTextRange: vi.fn(),
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);
    engine.handlePointerDown({ x: 10, y: 12 }, 'paragraph');
    await flushMicrotasks();
    engine.handlePointerMove({ x: 40, y: 12 });
    await flushMicrotasks();

    engine.acceptRevisionAppend();
    await flushMicrotasks();

    expect(resolveTextRangeFromPoints).toHaveBeenCalledTimes(3);
    expect(resolveTextRangeFromPoints).toHaveBeenLastCalledWith({
      anchor: { pageIndex: 0, x: 10, y: 12 },
      focus: { pageIndex: 0, x: 40, y: 12 },
      granularity: 'paragraph',
    });
    expect(engine.getState()).toBe('selecting');
    expect(engine.getText()).toBe('exact text');
    expect(engine.getRects()).toEqual([{ x: 330, y: 2, width: 30, height: 18 }]);
  });

  it('reprojects only the exact active primary gesture authorized by its lease', async () => {
    const baseline = exactRange(caret(10), caret(20));
    const moved = exactRange(caret(10), caret(80, 1));
    const resolveTextRangeFromPoints = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
      .mockImplementation(({ focus }) =>
        Promise.resolve({
          status: 'resolved',
          range: focus.pageIndex === 1 ? moved : baseline,
        }),
      );
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi.fn(),
      resolveTextRange: vi.fn(),
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, singlePageProjection(0));
    engine.handlePointerDown({ x: 10, y: 12 }, 'paragraph');
    await flushMicrotasks();
    const lease = captureSelectionGesture(engine);
    if (!lease) throw new Error('missing active primary selection lease');

    withSelectionGestureProjection(engine, lease, () => {
      engine.setSpread(spread, config, measurer, singlePageProjection(1));
    });
    engine.handlePointerMove({ x: 80, y: 12 });
    await flushMicrotasks();

    expect(ownsSelectionGesture(lease)).toBe(true);
    expect(engine.getState()).toBe('selecting');
    expect(resolveTextRangeFromPoints).toHaveBeenLastCalledWith({
      anchor: { pageIndex: 0, x: 10, y: 12 },
      focus: { pageIndex: 1, x: 80, y: 12 },
      granularity: 'paragraph',
    });
    expect(engine.getText()).toBe('exact text');

    engine.handlePointerUp({ x: 80, y: 12 });
    expect(ownsSelectionGesture(lease)).toBe(false);
    await flushMicrotasks();
    expect(engine.getState()).toBe('selected');
  });

  it('does not let the handle-only compatibility flag preserve a primary gesture', async () => {
    const range = exactRange(caret(10), caret(20));
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi.fn(),
      resolveTextRange: vi.fn(),
      resolveTextRangeFromPoints: vi.fn().mockResolvedValue({ status: 'resolved', range }),
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, singlePageProjection(0));
    engine.handlePointerDown({ x: 10, y: 12 }, 'paragraph');
    await flushMicrotasks();

    engine.setSpread(spread, config, measurer, singlePageProjection(1), {
      preserveNativeHandleDrag: true,
    });

    expect(engine.getState()).toBe('idle');
    expect(engine.hasSelection()).toBe(false);
  });

  it('reprojects an active handle session onto a known spread without invalidating it', async () => {
    const start = caret(10);
    const end = caret(40);
    const movedEnd = caret(80, 1);
    const baseline = exactRange(start, end);
    const moved = exactRange(start, movedEnd);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValue({ status: 'resolved', pageIndex: 1, spreadIndex: 1, caret: movedEnd });
    const capability = capabilityWithRangeToPoint({
      resolveCaret,
      resolveTextRange: vi.fn().mockResolvedValue({ status: 'resolved', range: moved }),
      resolveTextRangeFromPoints: vi
        .fn()
        .mockResolvedValue({ status: 'resolved', range: baseline }),
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, singlePageProjection(0));
    engine.handlePointerDown({ x: 10, y: 12 }, 'paragraph');
    engine.handlePointerUp({ x: 10, y: 12 });
    await flushMicrotasks();

    const drag = engine.beginHandleDrag('end');
    expect(drag).not.toBeNull();
    engine.setSpread(spread, config, measurer, singlePageProjection(1), {
      preserveNativeHandleDrag: true,
    });

    expect(engine.getState()).toBe('selecting');
    expect(engine.hasSelection()).toBe(true);
    expect(engine.getHandleCarets()).toEqual({
      start: null,
      end: null,
      focusEdge: 'end',
    });

    drag?.finish({ x: 80, y: 12 });
    await flushMicrotasks();

    expect(resolveCaret).toHaveBeenCalledWith({ pageIndex: 1, x: 80, y: 12 });
    expect(engine.getState()).toBe('selected');
    expect(engine.getText()).toBe('exact text');
    expect(engine.getHandleCarets()).toEqual({
      start: null,
      end: { x: 80, y: 0, width: 0, height: 18 },
      focusEdge: 'end',
    });
  });

  it('does not preserve a retained range when no handle session owns the transfer', async () => {
    const range = exactRange(caret(10), caret(40));
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi.fn(),
      resolveTextRange: vi.fn(),
      resolveTextRangeFromPoints: vi.fn().mockResolvedValue({ status: 'resolved', range }),
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, singlePageProjection(0));
    engine.handlePointerDown({ x: 10, y: 12 }, 'paragraph');
    engine.handlePointerUp({ x: 10, y: 12 });
    await flushMicrotasks();

    engine.setSpread(spread, config, measurer, singlePageProjection(1), {
      preserveNativeHandleDrag: true,
    });

    expect(engine.getState()).toBe('idle');
    expect(engine.hasSelection()).toBe(false);
  });

  it('invalidates an in-flight caret when the visible spread changes', async () => {
    const pending =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveCaret']>>>();
    const resolveTextRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi.fn().mockReturnValue(pending.promise),
      resolveTextRange,
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);
    engine.handlePointerDown({ x: 10, y: 12 });
    engine.handlePointerUp({ x: 50, y: 12 });

    engine.setSpread(spread, config, measurer, projection);
    pending.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: caret(10) });
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.hasSelection()).toBe(false);
    expect(resolveTextRange).not.toHaveBeenCalled();
  });

  it('dispose cancels work and ignores later pointer input', async () => {
    const pending =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveCaret']>>>();
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockReturnValue(pending.promise);
    const resolveTextRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const capability = capabilityWithRangeToPoint({
      resolveCaret,
      resolveTextRange,
      resolveTextRangeFromPoints,
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);
    engine.handlePointerDown({ x: 10, y: 12 });

    engine.dispose();
    pending.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: caret(10) });
    await flushMicrotasks();
    engine.handlePointerDown({ x: 20, y: 12 });

    expect(resolveCaret).toHaveBeenCalledOnce();
    expect(resolveTextRange).not.toHaveBeenCalled();
    expect(engine.getState()).toBe('idle');
  });

  it('keeps cross-page native selection while a strict single-page mapper hides offscreen geometry', async () => {
    const anchor = caret(1);
    const focus = caret(5, 1);
    const range = {
      ...exactRange(anchor, focus),
      rects: [
        { pageIndex: 0, spreadIndex: 0, x: 1, y: 2, width: 3, height: 18 },
        { pageIndex: 1, spreadIndex: 1, x: 1, y: 2, width: 4, height: 18 },
      ],
    };
    const resolveTextRangeFromPoints = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
      .mockResolvedValue({ status: 'resolved', range });
    const capability = capabilityWithRangeToPoint({
      resolveCaret: vi.fn(),
      resolveTextRange: vi.fn(),
      resolveTextRangeFromPoints,
    });
    const singleConfig = createLayoutConfig({
      width: 300,
      height: 400,
      margin: 0,
      spread: 'single',
    });
    const singleSpread: Spread = {
      index: 0,
      left: { index: 0, bounds: rect(0, 0), content: [] },
    };
    const singleMapper = createCoordinateMapper(singleConfig, singleSpread, 1);
    const engine = createSelectionEngine(capability);
    const onError = vi.fn();
    engine.onError(onError);
    engine.setSpread(singleSpread, singleMapper.selectionConfig, measurer, singleMapper);

    engine.handlePointerDown({ x: 1, y: 10 }, 'paragraph');
    engine.handlePointerUp({ x: 1, y: 10 });
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.hasSelection()).toBe(true);
    expect(engine.getText()).toBe('exact text');
    expect(engine.getSourceLocator()).toEqual(range.sourceLocator);
    expect(engine.getRects()).toEqual([{ x: 1, y: 2, width: 3, height: 18 }]);
    expect(engine.getFocusRect()).toBeNull();
    expect(engine.getHandleCarets()).toEqual({
      start: { x: 1, y: 0, width: 0, height: 18 },
      end: null,
      focusEdge: 'end',
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not synthesize exact handle carets for the legacy layout path', () => {
    expect(createSelectionEngine().getHandleCarets()).toBeNull();
  });
});

function exactRange(
  anchor: ReaderTextCaret,
  focus: ReaderTextCaret,
  direction: 'forward' | 'backward' = 'forward',
): ReaderTextRange {
  const start = direction === 'forward' ? anchor : focus;
  const end = direction === 'forward' ? focus : anchor;
  return {
    anchor,
    focus,
    start,
    end,
    selectedText: 'exact text',
    sourceLocator: {
      href: 'chapter.xhtml',
      sourceRange: {
        start: { nodePath: [0], textOffset: 10 },
        end: { nodePath: [0], textOffset: 40 },
      },
    },
    rects: [{ pageIndex: 1, spreadIndex: 0, x: 10, y: 2, width: 30, height: 18 }],
  };
}

function rect(x: number, y: number) {
  return { x, y, width: 300, height: 400 };
}

function singlePageProjection(pageIndex: number): NativeSelectionProjection {
  return {
    spreadContentToPage: (x, y) => ({ pageIndex, x, y }),
    isPageVisible: (candidate) => candidate === pageIndex,
    pageContentToSpread: (_candidate, value) => value,
  };
}
