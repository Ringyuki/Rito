import { describe, expect, it, vi } from 'vitest';
import type { ReaderTextSelectionInteractions } from '@ritojs/core';
import { createNativeSelectionEngine } from '../src/interaction/selection/native-engine';
import {
  capabilityFrom,
  caret,
  deferred,
  exactRange,
  flushMicrotasks,
  point,
} from './helpers/native-selection';

describe('native semantic selection granularity', () => {
  it('publishes a word seed and keeps the original point while dragging', async () => {
    const anchorPoint = point(2);
    const focusPoint = point(8);
    const seed = exactRange(caret(2), caret(5), 'forward', 'seed');
    const dragged = exactRange(caret(2), caret(8), 'forward', 'dragged');
    const resolveCaret = vi.fn<ReaderTextSelectionInteractions['resolveCaret']>();
    const resolveTextRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const resolveTextRangeFromPoints = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
      .mockResolvedValueOnce({ status: 'resolved', range: seed })
      .mockResolvedValue({ status: 'resolved', range: dragged });
    const engine = createNativeSelectionEngine(
      capabilityFrom(resolveCaret, resolveTextRange, resolveTextRangeFromPoints),
    );

    engine.handlePointerDown(anchorPoint, 'word');
    expect(resolveTextRangeFromPoints).toHaveBeenCalledWith({
      anchor: anchorPoint,
      focus: anchorPoint,
      granularity: 'word',
    });
    await flushMicrotasks();
    expect(engine.getSnapshot()?.text).toBe('seed');

    engine.handlePointerMove(focusPoint);
    await flushMicrotasks();
    engine.handlePointerUp(focusPoint);
    await flushMicrotasks();

    expect(resolveTextRangeFromPoints).toHaveBeenNthCalledWith(2, {
      anchor: anchorPoint,
      focus: focusPoint,
      granularity: 'word',
    });
    expect(resolveTextRangeFromPoints).toHaveBeenNthCalledWith(3, {
      anchor: anchorPoint,
      focus: focusPoint,
      granularity: 'word',
    });
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('dragged');
    expect(resolveCaret).not.toHaveBeenCalled();
    expect(resolveTextRange).not.toHaveBeenCalled();
  });

  it('coalesces semantic moves to the latest focus without changing the anchor', async () => {
    const seedRead =
      deferred<
        Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>>
      >();
    const anchorPoint = point(1);
    const latestPoint = point(9);
    const latest = exactRange(caret(1), caret(9), 'forward', 'latest');
    const resolveTextRangeFromPoints = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
      .mockReturnValueOnce(seedRead.promise)
      .mockResolvedValue({ status: 'resolved', range: latest });
    const engine = createNativeSelectionEngine(
      capabilityFrom(vi.fn(), vi.fn(), resolveTextRangeFromPoints),
    );

    engine.handlePointerDown(anchorPoint, 'paragraph');
    engine.handlePointerMove(point(4));
    engine.handlePointerMove(latestPoint);
    seedRead.resolve({
      status: 'resolved',
      range: exactRange(caret(1), caret(2), 'forward', 'obsolete seed'),
    });
    await flushMicrotasks();

    expect(resolveTextRangeFromPoints).toHaveBeenCalledTimes(2);
    expect(resolveTextRangeFromPoints).toHaveBeenLastCalledWith({
      anchor: anchorPoint,
      focus: latestPoint,
      granularity: 'paragraph',
    });
    expect(engine.getSnapshot()?.text).toBe('latest');
  });

  it('lets a resolved final sample bypass an obsolete pending seed', async () => {
    const seedRead =
      deferred<
        Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>>
      >();
    const anchorPoint = point(1);
    const finalPoint = point(7);
    const finalRange = exactRange(caret(1), caret(7), 'forward', 'final');
    const resolveTextRangeFromPoints = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
      .mockReturnValueOnce(seedRead.promise)
      .mockResolvedValueOnce({ status: 'resolved', range: finalRange });
    const engine = createNativeSelectionEngine(
      capabilityFrom(vi.fn(), vi.fn(), resolveTextRangeFromPoints),
    );

    engine.handlePointerDown(anchorPoint, 'word');
    engine.handlePointerUp(finalPoint);
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('final');
    seedRead.resolve({
      status: 'resolved',
      range: exactRange(caret(1), caret(3), 'forward', 'obsolete'),
    });
    await flushMicrotasks();
    expect(engine.getSnapshot()?.text).toBe('final');
  });

  it.each([
    { name: 'misses', resolution: { status: 'miss' } as const },
    { name: 'is cancelled', resolution: undefined },
  ])('waits for a pending seed when an in-place final sample $name', async ({ resolution }) => {
    const seedRead =
      deferred<
        Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>>
      >();
    const anchorPoint = point(1);
    const seed = exactRange(caret(1), caret(4), 'forward', 'word seed');
    const resolveTextRangeFromPoints = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
      .mockReturnValueOnce(seedRead.promise)
      .mockResolvedValueOnce(resolution);
    const engine = createNativeSelectionEngine(
      capabilityFrom(vi.fn(), vi.fn(), resolveTextRangeFromPoints),
    );

    engine.handlePointerDown(anchorPoint, 'word');
    engine.handlePointerUp(anchorPoint);
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');

    seedRead.resolve({ status: 'resolved', range: seed });
    await flushMicrotasks();
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('word seed');
  });

  it.each([undefined, { status: 'unavailable', reason: 'visualGeometryUnavailable' }] as const)(
    'fails closed when the initial semantic seed resolves as %j',
    async (resolution) => {
      const resolveTextRangeFromPoints = vi
        .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
        .mockResolvedValue(resolution);
      const engine = createNativeSelectionEngine(
        capabilityFrom(vi.fn(), vi.fn(), resolveTextRangeFromPoints),
      );

      engine.handlePointerDown(point(1), 'paragraph');
      await flushMicrotasks();

      expect(engine.getState()).toBe('idle');
      expect(engine.getSnapshot()).toBeNull();
    },
  );
});
