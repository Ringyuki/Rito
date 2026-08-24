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
  resolvedCaret,
} from './helpers/native-selection';

describe('native selection final sample', () => {
  it('bypasses an obsolete pending move range', async () => {
    const pendingMoveRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(0);
    const moveFocus = caret(3);
    const finalFocus = caret(8);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(moveFocus))
      .mockResolvedValueOnce(resolvedCaret(finalFocus));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockReturnValueOnce(pendingMoveRange.promise)
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, finalFocus, 'forward', 'final'),
      });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(0));
    await flushMicrotasks();
    engine.handlePointerMove(point(3));
    await flushMicrotasks();
    expect(resolveRange).toHaveBeenCalledOnce();

    engine.handlePointerUp(point(8));
    await flushMicrotasks();

    expect(resolveRange).toHaveBeenCalledTimes(2);
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('final');

    pendingMoveRange.resolve({
      status: 'resolved',
      range: exactRange(anchor, moveFocus, 'forward', 'obsolete'),
    });
    await flushMicrotasks();
    expect(engine.getSnapshot()?.text).toBe('final');
  });

  it.each([
    {
      name: 'miss',
      final: { status: 'miss', pageIndex: 0, spreadIndex: 0 } as const,
    },
    {
      name: 'unavailable',
      final: {
        status: 'unavailable',
        pageIndex: 0,
        spreadIndex: 0,
        reason: 'visualGeometryUnavailable',
      } as const,
    },
  ])('keeps the last valid drag range when the final point is $name', async ({ final }) => {
    const anchor = caret(1);
    const lastValidFocus = caret(5);
    const range = exactRange(anchor, lastValidFocus, 'forward', 'last valid');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(lastValidFocus))
      .mockResolvedValueOnce(final);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValue({ status: 'resolved', range });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(5));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');
    expect(engine.getSnapshot()?.text).toBe('last valid');

    engine.handlePointerUp(point(7));
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('last valid');
    expect(resolveRange).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'miss',
      final: { status: 'miss', pageIndex: 0, spreadIndex: 0 } as const,
    },
    {
      name: 'unavailable',
      final: {
        status: 'unavailable',
        pageIndex: 0,
        spreadIndex: 0,
        reason: 'visualGeometryUnavailable',
      } as const,
    },
  ])('waits for a pending valid move when the final point is $name', async ({ final }) => {
    const pendingMoveRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(1);
    const lastValidFocus = caret(5);
    const range = exactRange(anchor, lastValidFocus, 'forward', 'pending valid');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(lastValidFocus))
      .mockResolvedValueOnce(final);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockReturnValue(pendingMoveRange.promise);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(5));
    await flushMicrotasks();
    expect(resolveRange).toHaveBeenCalledOnce();

    engine.handlePointerUp(point(7));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');
    expect(engine.getSnapshot()).toBeNull();

    pendingMoveRange.resolve({ status: 'resolved', range });
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('pending valid');
  });

  it('prefers a pending newer valid move over an older published range after a final miss', async () => {
    const pendingNewerRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(1);
    const oldFocus = caret(3);
    const newerFocus = caret(6);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(oldFocus))
      .mockResolvedValueOnce(resolvedCaret(newerFocus))
      .mockResolvedValueOnce({ status: 'miss', pageIndex: 0, spreadIndex: 0 });
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, oldFocus, 'forward', 'old'),
      })
      .mockReturnValueOnce(pendingNewerRange.promise);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(3));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.text).toBe('old');

    engine.handlePointerMove(point(6));
    await flushMicrotasks();
    expect(resolveRange).toHaveBeenCalledTimes(2);
    engine.handlePointerUp(point(8));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');
    expect(engine.getSnapshot()?.text).toBe('old');

    pendingNewerRange.resolve({
      status: 'resolved',
      range: exactRange(anchor, newerFocus, 'forward', 'newer'),
    });
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('newer');
  });

  it('hard-cancels when a pending move returns undefined after a final miss', async () => {
    const pendingMoveRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(1);
    const oldFocus = caret(3);
    const newerFocus = caret(6);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(oldFocus))
      .mockResolvedValueOnce(resolvedCaret(newerFocus))
      .mockResolvedValueOnce({ status: 'miss', pageIndex: 0, spreadIndex: 0 });
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, oldFocus, 'forward', 'old'),
      })
      .mockReturnValueOnce(pendingMoveRange.promise);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(3));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.text).toBe('old');

    engine.handlePointerMove(point(6));
    await flushMicrotasks();
    engine.handlePointerUp(point(8));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');

    pendingMoveRange.resolve(undefined);
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.getSnapshot()).toBeNull();
  });

  it('finishes empty when the final point misses before any valid range exists', async () => {
    const anchor = caret(1);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce({ status: 'miss', pageIndex: 0, spreadIndex: 0 });
    const resolveRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerUp(point(7));
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.getSnapshot()).toBeNull();
    expect(resolveRange).not.toHaveBeenCalled();
  });
});
