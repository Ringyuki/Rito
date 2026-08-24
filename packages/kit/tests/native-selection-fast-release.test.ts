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

describe('native selection fast release', () => {
  it('waits for an in-flight move when the pointer-up lookup is cancelled', async () => {
    const pendingMoveRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(1);
    const moveFocus = caret(6);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(moveFocus))
      .mockResolvedValueOnce(undefined);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockReturnValueOnce(pendingMoveRange.promise);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(6));
    await flushMicrotasks();
    expect(resolveRange).toHaveBeenCalledOnce();

    engine.handlePointerUp(point(6));
    await flushMicrotasks();

    expect(engine.getState()).toBe('selecting');
    expect(engine.getSnapshot()).toBeNull();

    pendingMoveRange.resolve({
      status: 'resolved',
      range: exactRange(anchor, moveFocus, 'forward', 'fast drag'),
    });
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('fast drag');
  });

  it('waits for an in-flight move when the pointer-up range lookup is cancelled', async () => {
    const pendingMoveRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(1);
    const moveFocus = caret(6);
    const finalFocus = caret(7);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(moveFocus))
      .mockResolvedValueOnce(resolvedCaret(finalFocus));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockReturnValueOnce(pendingMoveRange.promise)
      .mockResolvedValueOnce(undefined);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(6));
    await flushMicrotasks();
    engine.handlePointerUp(point(7));
    await flushMicrotasks();

    expect(engine.getState()).toBe('selecting');

    pendingMoveRange.resolve({
      status: 'resolved',
      range: exactRange(anchor, moveFocus, 'forward', 'range fallback'),
    });
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('range fallback');
  });

  it('does not let a cancelled move discard a newer in-flight final range', async () => {
    const pendingMoveRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const pendingFinalRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(1);
    const moveFocus = caret(5);
    const finalFocus = caret(8);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(moveFocus))
      .mockResolvedValueOnce(resolvedCaret(finalFocus));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockReturnValueOnce(pendingMoveRange.promise)
      .mockReturnValueOnce(pendingFinalRange.promise);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(5));
    await flushMicrotasks();
    engine.handlePointerUp(point(8));
    await flushMicrotasks();
    expect(resolveRange).toHaveBeenCalledTimes(2);

    pendingMoveRange.resolve(undefined);
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');

    pendingFinalRange.resolve({
      status: 'resolved',
      range: exactRange(anchor, finalFocus, 'forward', 'final wins'),
    });
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('final wins');
  });

  it('keeps a published drag range when the final lookup is cancelled', async () => {
    const anchor = caret(1);
    const moveFocus = caret(5);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(moveFocus))
      .mockResolvedValueOnce(undefined);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, moveFocus, 'forward', 'published'),
      });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(5));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.text).toBe('published');

    engine.handlePointerUp(point(5));
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.text).toBe('published');
  });

  it('still collapses a selection when the final range resolves at the anchor', async () => {
    const anchor = caret(1);
    const moveFocus = caret(5);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(moveFocus))
      .mockResolvedValueOnce(resolvedCaret(anchor));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, moveFocus, 'forward', 'temporary'),
      })
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, anchor, 'forward', ''),
      });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(5));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.text).toBe('temporary');

    engine.handlePointerUp(point(1));
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.getSnapshot()).toBeNull();
  });

  it('uses a pending collapsed move when the final lookup is cancelled', async () => {
    const pendingCollapsedRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(1);
    const oldFocus = caret(5);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(oldFocus))
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(undefined);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, oldFocus, 'forward', 'old selection'),
      })
      .mockReturnValueOnce(pendingCollapsedRange.promise);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerMove(point(5));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.text).toBe('old selection');

    engine.handlePointerMove(point(1));
    await flushMicrotasks();
    engine.handlePointerUp(point(1));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');

    pendingCollapsedRange.resolve({
      status: 'resolved',
      range: exactRange(anchor, anchor, 'forward', ''),
    });
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.getSnapshot()).toBeNull();
  });
});
