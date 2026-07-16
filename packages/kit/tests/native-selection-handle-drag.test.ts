import { describe, expect, it, vi } from 'vitest';
import type { ReaderTextCaretResolution, ReaderTextSelectionInteractions } from '@ritojs/core';
import { createNativeSelectionEngine } from '../src/interaction/selection/native-engine';
import type { NativeSelectionHandleDrag } from '../src/interaction/selection/native-types';
import {
  capabilityFrom,
  caret,
  deferred,
  exactRange,
  flushMicrotasks,
  point,
  resolvedCaret,
} from './helpers/native-selection';

describe('native selection handle drag', () => {
  it('starts only from a selected snapshot and treats an immediate finish as authoritative', async () => {
    const start = caret(1);
    const end = caret(8);
    const finished = caret(3);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const adjusted = exactRange(end, finished, 'backward', 'immediate finish');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(end))
      .mockResolvedValueOnce(resolvedCaret(finished));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline })
      .mockResolvedValueOnce({ status: 'resolved', range: adjusted });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    expect(engine.beginHandleDrag('start')).toBeNull();
    await seedSelection(engine, 1, 8);
    const drag = requireDrag(engine.beginHandleDrag('start'));

    expect(engine.getState()).toBe('selecting');
    expect(engine.getSnapshot()?.range).toBe(baseline);
    expect(resolveCaret).toHaveBeenCalledTimes(2);
    expect(resolveRange).toHaveBeenCalledOnce();

    drag.finish(point(3));
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.range).toBe(adjusted);
    expect(resolveCaret).toHaveBeenCalledTimes(3);
    expect(resolveRange).toHaveBeenLastCalledWith(end, finished);
  });

  it('publishes the grabbed start caret as focus and restores baseline focus on cancel', async () => {
    const start = caret(1);
    const end = caret(8);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(end));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine, 1, 8);
    const drag = requireDrag(engine.beginHandleDrag('start'));

    expect(engine.getSnapshot()).toMatchObject({
      range: baseline,
      focusDirection: 'backward',
      focusCaret: { pageIndex: start.pageIndex, geometry: start.geometry },
    });
    drag.cancel();
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()).toMatchObject({
      range: baseline,
      focusDirection: 'forward',
      focusCaret: { pageIndex: end.pageIndex, geometry: end.geometry },
    });
  });

  it.each([
    { edge: 'start', fixedOffset: 8, movingOffset: 3, direction: 'backward' },
    { edge: 'end', fixedOffset: 1, movingOffset: 6, direction: 'forward' },
  ] as const)('fixes the opposite exact caret while dragging the $edge handle', async (entry) => {
    const start = caret(1);
    const end = caret(8);
    const fixed = entry.edge === 'start' ? end : start;
    const moving = caret(entry.movingOffset);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const adjusted = exactRange(fixed, moving, entry.direction, 'adjusted');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(end))
      .mockResolvedValueOnce(resolvedCaret(moving))
      .mockResolvedValueOnce(resolvedCaret(moving));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline })
      .mockResolvedValueOnce({ status: 'resolved', range: adjusted })
      .mockResolvedValueOnce({ status: 'resolved', range: adjusted });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine, 1, 8);
    const drag = requireDrag(engine.beginHandleDrag(entry.edge));
    drag.update(point(entry.movingOffset));
    await flushMicrotasks();

    expect(resolveRange).toHaveBeenLastCalledWith(fixed, moving);
    expect(engine.getSnapshot()?.text).toBe('adjusted');

    drag.finish(point(entry.movingOffset));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.range).toBe(adjusted);
    expect(resolveRange.mock.calls.slice(1).map(([anchor]) => anchor)).toEqual([fixed, fixed]);
  });

  it('keeps the fixed caret when the moving endpoint crosses it in both directions', async () => {
    const start = caret(1);
    const fixedEnd = caret(8);
    const crossed = caret(11);
    const crossedBack = caret(4);
    const baseline = exactRange(start, fixedEnd, 'forward', 'baseline');
    const forward = exactRange(fixedEnd, crossed, 'forward', 'crossed');
    const backward = exactRange(fixedEnd, crossedBack, 'backward', 'crossed back');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(fixedEnd))
      .mockResolvedValueOnce(resolvedCaret(crossed))
      .mockResolvedValueOnce(resolvedCaret(crossedBack))
      .mockResolvedValueOnce(resolvedCaret(crossedBack));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline })
      .mockResolvedValueOnce({ status: 'resolved', range: forward })
      .mockResolvedValueOnce({ status: 'resolved', range: backward })
      .mockResolvedValueOnce({ status: 'resolved', range: backward });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine, 1, 8);
    const drag = requireDrag(engine.beginHandleDrag('start'));
    drag.update(point(11));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.focusDirection).toBe('forward');
    expect(engine.getSnapshot()?.range.start).toBe(fixedEnd);

    drag.update(point(4));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.focusDirection).toBe('backward');
    drag.finish(point(4));
    await flushMicrotasks();

    expect(resolveRange.mock.calls.slice(1).map(([anchor]) => anchor)).toEqual([
      fixedEnd,
      fixedEnd,
      fixedEnd,
    ]);
    expect(engine.getSnapshot()?.range.end).toBe(fixedEnd);
  });

  it('cancel restores the baseline and makes the old drag object inert', async () => {
    const pendingRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const start = caret(1);
    const end = caret(8);
    const moving = caret(5);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const adjusted = exactRange(start, moving, 'forward', 'adjusted');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(end))
      .mockResolvedValueOnce(resolvedCaret(moving));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline })
      .mockReturnValueOnce(pendingRange.promise);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine, 1, 8);
    const oldDrag = requireDrag(engine.beginHandleDrag('end'));
    oldDrag.update(point(5));
    await flushMicrotasks();
    oldDrag.cancel();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.range).toBe(baseline);
    pendingRange.resolve({ status: 'resolved', range: adjusted });
    await flushMicrotasks();
    expect(engine.getSnapshot()?.range).toBe(baseline);

    const currentDrag = requireDrag(engine.beginHandleDrag('start'));
    oldDrag.update(point(6));
    oldDrag.finish(point(6));
    oldDrag.cancel();
    expect(engine.getState()).toBe('selecting');
    expect(resolveCaret).toHaveBeenCalledTimes(3);
    currentDrag.cancel();
    expect(engine.getState()).toBe('selected');
  });

  it('invalidates a pending handle lookup and rejects every late callback', async () => {
    const pendingCaret = deferred<ReaderTextCaretResolution | undefined>();
    const start = caret(1);
    const end = caret(8);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(end))
      .mockReturnValueOnce(pendingCaret.promise);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine, 1, 8);
    const drag = requireDrag(engine.beginHandleDrag('end'));
    drag.update(point(5));
    engine.invalidate();
    pendingCaret.resolve(resolvedCaret(caret(5)));
    await flushMicrotasks();
    drag.finish(point(5));
    drag.cancel();

    expect(engine.getState()).toBe('idle');
    expect(engine.getSnapshot()).toBeNull();
    expect(resolveRange).toHaveBeenCalledOnce();
  });

  it('uses an in-flight move when a fast final lookup is cancelled', async () => {
    const pendingRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const start = caret(1);
    const end = caret(8);
    const moving = caret(6);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const adjusted = exactRange(start, moving, 'forward', 'fast handle drag');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(end))
      .mockResolvedValueOnce(resolvedCaret(moving))
      .mockResolvedValueOnce(undefined);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline })
      .mockReturnValueOnce(pendingRange.promise);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine, 1, 8);
    const drag = requireDrag(engine.beginHandleDrag('end'));
    drag.update(point(6));
    await flushMicrotasks();
    drag.finish(point(6));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');

    pendingRange.resolve({ status: 'resolved', range: adjusted });
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('fast handle drag');
  });
});

async function seedSelection(
  engine: ReturnType<typeof createNativeSelectionEngine>,
  anchorX: number,
  focusX: number,
): Promise<void> {
  engine.handlePointerDown(point(anchorX));
  await flushMicrotasks();
  engine.handlePointerUp(point(focusX));
  await flushMicrotasks();
  expect(engine.getState()).toBe('selected');
}

function requireDrag(drag: NativeSelectionHandleDrag | null): NativeSelectionHandleDrag {
  expect(drag).not.toBeNull();
  if (!drag) throw new Error('expected native selection handle drag');
  return drag;
}
