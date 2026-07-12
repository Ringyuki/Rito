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
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveSameFlowRange']>>>();
    const anchor = caret(0);
    const moveFocus = caret(3);
    const finalFocus = caret(8);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(moveFocus))
      .mockResolvedValueOnce(resolvedCaret(finalFocus));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveSameFlowRange']>()
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
});
