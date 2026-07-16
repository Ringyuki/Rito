import { describe, expect, it, vi } from 'vitest';
import type { ReaderTextSelectionInteractions } from '@ritojs/core';
import { createNativeSelectionEngine } from '../src/interaction/selection/native-engine';
import {
  caret,
  deferred,
  exactRange,
  flushMicrotasks,
  point,
  resolvedCaret,
} from './helpers/native-selection';

describe('native selection revision append lifecycle', () => {
  it('keeps a stable character anchor and replays only the latest move', async () => {
    const staleRange =
      deferred<
        Awaited<ReturnType<NonNullable<ReaderTextSelectionInteractions['resolveTextRangeToPoint']>>>
      >();
    const oldAnchor = caret(1);
    const reboundAnchor = caret(1);
    const currentFocus = caret(9);
    const nextFocus = caret(10);
    const latestRange = exactRange(reboundAnchor, currentFocus, 'forward', 'latest append');
    const nextRange = exactRange(reboundAnchor, nextFocus, 'forward', 'next append');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(oldAnchor));
    const resolveTextRangeToPoint = vi
      .fn<NonNullable<ReaderTextSelectionInteractions['resolveTextRangeToPoint']>>()
      .mockReturnValueOnce(staleRange.promise)
      .mockResolvedValueOnce({ status: 'resolved', range: latestRange })
      .mockResolvedValueOnce({ status: 'resolved', range: nextRange });
    const engine = createNativeSelectionEngine({
      resolveCaret,
      resolveTextRange: vi.fn(),
      resolveTextRangeToPoint,
      resolveTextRangeFromPoints: vi.fn(),
    });

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(4));
    engine.handlePointerMove(point(9));

    engine.acceptRevisionAppend();
    await flushMicrotasks();

    expect(resolveCaret.mock.calls.map(([sample]) => sample.x)).toEqual([1]);
    expect(resolveTextRangeToPoint.mock.calls.map(([, sample]) => sample.x)).toEqual([4, 9]);
    expect(resolveTextRangeToPoint).toHaveBeenLastCalledWith(oldAnchor, point(9));
    expect(engine.getSnapshot()?.text).toBe('latest append');

    engine.handlePointerMove(point(10));
    await flushMicrotasks();

    expect(resolveTextRangeToPoint).toHaveBeenLastCalledWith(reboundAnchor, point(10));
    expect(engine.getSnapshot()?.range).toBe(nextRange);

    staleRange.resolve({
      status: 'resolved',
      range: exactRange(oldAnchor, caret(4), 'forward', 'stale append'),
    });
    await flushMicrotasks();

    expect(resolveTextRangeToPoint).toHaveBeenCalledTimes(3);
    expect(engine.getSnapshot()?.range).toBe(nextRange);
  });

  it('replays a final handle sample and ignores its old revision response', async () => {
    const staleFinal =
      deferred<
        Awaited<ReturnType<NonNullable<ReaderTextSelectionInteractions['resolveTextRangeToPoint']>>>
      >();
    const start = caret(1);
    const end = caret(8);
    const currentFocus = caret(6);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const finalRange = exactRange(start, currentFocus, 'forward', 'current final');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start));
    const resolveTextRangeToPoint = vi
      .fn<NonNullable<ReaderTextSelectionInteractions['resolveTextRangeToPoint']>>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline })
      .mockReturnValueOnce(staleFinal.promise)
      .mockResolvedValueOnce({ status: 'resolved', range: finalRange });
    const engine = createNativeSelectionEngine({
      resolveCaret,
      resolveTextRange: vi.fn(),
      resolveTextRangeToPoint,
      resolveTextRangeFromPoints: vi.fn(),
    });

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerUp(point(8));
    await flushMicrotasks();
    const drag = engine.beginHandleDrag('end');
    if (!drag) throw new Error('expected handle drag');

    drag.finish(point(6));
    engine.acceptRevisionAppend();
    await flushMicrotasks();

    expect(resolveCaret.mock.calls.map(([sample]) => sample.x)).toEqual([1]);
    expect(resolveTextRangeToPoint.mock.calls.map(([, sample]) => sample.x)).toEqual([8, 6, 6]);
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.range).toBe(finalRange);

    staleFinal.resolve({
      status: 'resolved',
      range: exactRange(start, caret(4), 'forward', 'stale final'),
    });
    await flushMicrotasks();

    expect(resolveTextRangeToPoint).toHaveBeenCalledTimes(3);
    expect(engine.getSnapshot()?.range).toBe(finalRange);
  });
});
