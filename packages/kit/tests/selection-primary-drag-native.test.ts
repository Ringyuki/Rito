import { createLayoutConfig } from '@ritojs/core';
import type { ReaderTextSelectionInteractions, TextMeasurer } from '@ritojs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrimarySelectionDragNavigation } from '../src/controller/facade/selection-primary-drag';
import { SELECTION_EDGE_DWELL_MS } from '../src/controller/facade/selection-edge-navigation';
import type { Internals } from '../src/controller/facade/types';
import { bindPointerEvents } from '../src/controller/wiring/pointer';
import { createSelectionEngine } from '../src/interaction';
import type { Spread } from '../src/interaction';
import type { NativeSelectionProjection } from '../src/interaction/selection/engine';
import {
  withSelectionGestureProjection,
  type SelectionGestureLease,
} from '../src/interaction/selection/selection-interaction-owner';
import { createDomTarget, pointer, pointerPosition } from './helpers/dom-input';
import {
  capabilityWithRangeToPoint,
  caret,
  exactRange,
  flushMicrotasks,
  resolvedCaret,
} from './helpers/native-selection';

afterEach(() => {
  vi.useRealTimers();
});

describe('primary selection native projection integration', () => {
  it('finalizes a projection-reentrant edge release through the new page', async () => {
    vi.useFakeTimers();
    const resolveCaret = vi.fn<ReaderTextSelectionInteractions['resolveCaret']>((point) =>
      Promise.resolve(resolvedCaret(caret(point.pageIndex === 0 ? 10 : 40, point.pageIndex))),
    );
    const capability = capabilityWithRangeToPoint({
      resolveCaret,
      resolveTextRange: (anchor, focus) =>
        Promise.resolve({
          status: 'resolved',
          range: exactRange(anchor, focus, 'forward', 'cross-spread text'),
        }),
      resolveTextRangeFromPoints: () => Promise.resolve({ status: 'miss' }),
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, singlePageProjection(0, 300));
    const dom = createDomTarget();
    const canvas = dom.target as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => surfaceRect;
    const internals = createInternals(engine);
    let released = false;
    const click = vi.fn();
    const navigation = createPrimarySelectionDragNavigation(internals, canvas, {
      ensureSelectionSpread: vi.fn(),
      prepareSpreadForJump: vi.fn(() => 'ready'),
      supersedeForSelectionIntent: () => {
        internals.coordState.contentInteractionGeneration += 1;
        return { owns: () => true };
      },
      jumpToSpreadIfReady: (target: number, gesture: SelectionGestureLease) => {
        internals.coordState.contentInteractionGeneration += 1;
        internals.coordState.selectionProjectionTransfer = { targetSpreadIndex: target, gesture };
        internals.currentSpread = target;
        internals.coordState.mapper = mapperWithWidth(100);
        try {
          withSelectionGestureProjection(engine, gesture, () => {
            engine.setSpread(spread, config, measurer, singlePageProjection(1, 100));
          });
        } finally {
          internals.coordState.selectionProjectionTransfer = null;
        }
        return 'committed';
      },
    } as never);
    const disposeSelection = engine.onSelectionChange(() => {
      if (released || internals.currentSpread !== 1 || engine.getState() !== 'selecting') return;
      released = true;
      dom.emit('pointerup', pointer(1, 299, 25));
    });
    const disposePointer = bindPointerEvents(canvas, engine, pointerPosition, click, navigation);

    dom.emit('pointerdown', pointer(1, 299, 25));
    await flushMicrotasks();
    dom.emit('pointermove', pointer(1, 299, 25));
    await flushMicrotasks();
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    await flushMicrotasks();

    expect(released).toBe(true);
    expect(resolveCaret).toHaveBeenLastCalledWith({ pageIndex: 1, x: 100, y: 25 });
    expect(engine.getState()).toBe('selected');
    expect(engine.getText()).toBe('cross-spread text');
    expect(click).not.toHaveBeenCalled();
    disposePointer();
    disposeSelection();
    engine.dispose();
  });

  it('adopts the same exact native gesture across two consecutive projection jumps', async () => {
    vi.useFakeTimers();
    const resolveCaret = vi.fn<ReaderTextSelectionInteractions['resolveCaret']>((point) =>
      Promise.resolve(resolvedCaret(caret(10 + point.pageIndex * 20, point.pageIndex))),
    );
    const resolveTextRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>(
      (anchor, focus) =>
        Promise.resolve({
          status: 'resolved',
          range: exactRange(anchor, focus, 'forward', 'through page ' + String(focus.pageIndex)),
        }),
    );
    const capability = capabilityWithRangeToPoint({
      resolveCaret,
      resolveTextRange,
      resolveTextRangeFromPoints: () => Promise.resolve({ status: 'miss' }),
    });
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, singlePageProjection(0, 300));
    const dom = createDomTarget();
    const canvas = dom.target as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => surfaceRect;
    const internals = createInternals(engine);
    (internals.reader as { totalSpreads: number }).totalSpreads = 3;
    const jumps: number[] = [];
    const navigation = createPrimarySelectionDragNavigation(internals, canvas, {
      ensureSelectionSpread: vi.fn(),
      prepareSpreadForJump: vi.fn(() => 'ready'),
      supersedeForSelectionIntent: () => {
        internals.coordState.contentInteractionGeneration += 1;
        return { owns: () => true };
      },
      jumpToSpreadIfReady: (target: number, gesture: SelectionGestureLease) => {
        internals.coordState.contentInteractionGeneration += 1;
        internals.coordState.selectionProjectionTransfer = { targetSpreadIndex: target, gesture };
        internals.currentSpread = target;
        internals.coordState.mapper = mapperWithWidth(100);
        jumps.push(target);
        try {
          withSelectionGestureProjection(engine, gesture, () => {
            engine.setSpread(spread, config, measurer, singlePageProjection(target, 100));
          });
        } finally {
          internals.coordState.selectionProjectionTransfer = null;
        }
        return 'committed';
      },
    } as never);
    const dispose = bindPointerEvents(canvas, engine, pointerPosition, vi.fn(), navigation);

    dom.emit('pointerdown', pointer(1, 299, 25));
    await flushMicrotasks();
    dom.emit('pointermove', pointer(1, 299, 25));
    await flushMicrotasks();
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    await flushMicrotasks();
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    await flushMicrotasks();
    dom.emit('pointerup', pointer(1, 299, 25));
    await flushMicrotasks();

    expect(jumps).toEqual([1, 2]);
    expect(internals.currentSpread).toBe(2);
    expect(resolveCaret).toHaveBeenLastCalledWith({ pageIndex: 2, x: 100, y: 25 });
    expect(resolveTextRange.mock.calls.map(([, focus]) => focus.pageIndex)).toContain(2);
    expect(engine.getState()).toBe('selected');
    expect(engine.getText()).toBe('through page 2');
    dispose();
    engine.dispose();
  });
});

const config = createLayoutConfig({ width: 300, height: 200, margin: 0, spread: 'single' });
const spread: Spread = {
  index: 0,
  left: { index: 0, bounds: { x: 0, y: 0, width: 300, height: 200 }, content: [] },
};
const measurer: TextMeasurer = {
  measureText: (text) => ({ width: text.length * 10, height: 20 }),
};
const surfaceRect = {
  left: 0,
  right: 300,
  top: 0,
  bottom: 200,
} as DOMRect;

function createInternals(engine: ReturnType<typeof createSelectionEngine>): Internals {
  return {
    currentSpread: 0,
    reader: { totalSpreads: 2, pagination: { complete: true } },
    engines: { selection: engine },
    coordState: {
      mapper: mapperWithWidth(300),
      contentInteractionGeneration: 0,
      selectionProjectionTransfer: null,
    },
  } as unknown as Internals;
}

function singlePageProjection(pageIndex: number, width: number): NativeSelectionProjection {
  return {
    spreadContentToPage: (x, y) => (x >= 0 && x <= width ? { pageIndex, x, y } : null),
    isPageVisible: (candidate) => candidate === pageIndex,
    pageContentToSpread: (_candidate, value) => value,
  };
}

function mapperWithWidth(contentWidth: number): NonNullable<Internals['coordState']['mapper']> {
  return {
    cssToSpreadContent: (x: number, y: number) => ({ x, y }),
    getPages: () => [
      {
        pageIndex: 0,
        side: 'single' as const,
        contentOriginX: 0,
        contentOriginY: 0,
        spreadContentOriginX: 0,
        contentWidth,
        contentHeight: 100,
      },
    ],
  } as unknown as NonNullable<Internals['coordState']['mapper']>;
}
