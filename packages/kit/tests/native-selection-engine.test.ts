import { describe, expect, it, vi } from 'vitest';
import type { ReaderTextCaretResolution, ReaderTextSelectionInteractions } from '@ritojs/core';
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

describe('native exact selection engine', () => {
  it('queues move and final up while down is pending, then selects only after the final range', async () => {
    const anchorRead = deferred<ReaderTextCaretResolution | undefined>();
    const focusRead = deferred<ReaderTextCaretResolution | undefined>();
    const rangeRead =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(1);
    const focus = caret(8);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockReturnValueOnce(anchorRead.promise)
      .mockReturnValueOnce(focusRead.promise);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockReturnValue(rangeRead.promise);
    const capability = capabilityFrom(resolveCaret, resolveRange);
    const engine = createNativeSelectionEngine(capability);

    engine.handlePointerDown(point(1));
    engine.handlePointerMove(point(4));
    engine.handlePointerUp(point(8));
    expect(engine.getState()).toBe('selecting');
    expect(resolveCaret).toHaveBeenCalledTimes(1);

    anchorRead.resolve(resolvedCaret(anchor));
    await flushMicrotasks();
    expect(resolveCaret).toHaveBeenCalledTimes(2);
    expect(resolveCaret).toHaveBeenLastCalledWith(point(8));

    focusRead.resolve(resolvedCaret(focus));
    await flushMicrotasks();
    expect(resolveRange).toHaveBeenCalledWith(anchor, focus);
    expect(engine.getState()).toBe('selecting');

    const range = exactRange(anchor, focus, 'forward', 'final text');
    rangeRead.resolve({ status: 'resolved', range });
    await flushMicrotasks();
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()).toMatchObject({
      range,
      text: 'final text',
      rects: range.rects,
      sourceLocator: range.sourceLocator,
      focusDirection: 'forward',
      focusCaret: { pageIndex: 0, geometry: focus.geometry },
    });
  });

  it('keeps one focus pipeline in flight and coalesces queued moves to the latest point', async () => {
    const firstFocus = deferred<ReaderTextCaretResolution | undefined>();
    const latestFocus = deferred<ReaderTextCaretResolution | undefined>();
    const anchor = caret(0);
    const latest = caret(9);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockReturnValueOnce(firstFocus.promise)
      .mockReturnValueOnce(latestFocus.promise);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValue({ status: 'resolved', range: exactRange(anchor, latest) });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(0));
    await flushMicrotasks();
    engine.handlePointerMove(point(2));
    engine.handlePointerMove(point(5));
    engine.handlePointerMove(point(9));
    expect(resolveCaret).toHaveBeenCalledTimes(2);

    firstFocus.resolve(resolvedCaret(caret(2)));
    await flushMicrotasks();
    expect(resolveRange).not.toHaveBeenCalled();
    expect(resolveCaret).toHaveBeenCalledTimes(3);
    expect(resolveCaret).toHaveBeenLastCalledWith(point(9));

    latestFocus.resolve(resolvedCaret(latest));
    await flushMicrotasks();
    expect(resolveRange).toHaveBeenCalledOnce();
    expect(engine.getSnapshot()?.text).toBe('selected text');
  });

  it('drops a range result when a newer move arrives and publishes only the latest range', async () => {
    const oldRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(0);
    const oldFocus = caret(3);
    const latestFocus = caret(7);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(oldFocus))
      .mockResolvedValueOnce(resolvedCaret(latestFocus));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockReturnValueOnce(oldRange.promise)
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, latestFocus, 'forward', 'latest'),
      });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));
    const publishedTexts: string[] = [];
    engine.onChange(({ snapshot }) => {
      if (snapshot) publishedTexts.push(snapshot.text);
    });

    engine.handlePointerDown(point(0));
    await flushMicrotasks();
    engine.handlePointerMove(point(3));
    await flushMicrotasks();
    expect(resolveRange).toHaveBeenCalledOnce();
    engine.handlePointerMove(point(7));

    oldRange.resolve({
      status: 'resolved',
      range: exactRange(anchor, oldFocus, 'forward', 'obsolete'),
    });
    await flushMicrotasks();

    expect(resolveRange).toHaveBeenCalledTimes(2);
    expect(publishedTexts).toEqual(['latest']);
    expect(engine.getSnapshot()?.text).toBe('latest');
  });

  it.each(['clear', 'invalidate'] as const)('%s cancels a pending epoch', async (operation) => {
    const anchorRead = deferred<ReaderTextCaretResolution | undefined>();
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockReturnValue(anchorRead.promise);
    const resolveRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(1));
    engine.handlePointerUp(point(4));
    engine[operation]();
    anchorRead.resolve(resolvedCaret(caret(1)));
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.getSnapshot()).toBeNull();
    expect(resolveCaret).toHaveBeenCalledOnce();
    expect(resolveRange).not.toHaveBeenCalled();
  });

  it('dispose cancels a pending range and suppresses later input and publication', async () => {
    const pendingRange =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveTextRange']>>>();
    const anchor = caret(1);
    const focus = caret(5);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(focus));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockReturnValue(pendingRange.promise);
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));
    const listener = vi.fn();
    engine.onChange(listener);

    engine.handlePointerDown(point(1));
    await flushMicrotasks();
    engine.handlePointerUp(point(5));
    await flushMicrotasks();
    engine.dispose();
    pendingRange.resolve({ status: 'resolved', range: exactRange(anchor, focus) });
    await flushMicrotasks();
    engine.handlePointerDown(point(9));

    expect(engine.getState()).toBe('disposed');
    expect(engine.getSnapshot()).toBeNull();
    expect(resolveCaret).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats an undefined authoritative capability result as cancellation', async () => {
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValue(undefined);
    const resolveRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const capability = capabilityFrom(resolveCaret, resolveRange);
    const engine = createNativeSelectionEngine(capability);

    engine.handlePointerDown(point(1));
    engine.handlePointerMove(point(4));
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.getSnapshot()).toBeNull();
    expect(resolveRange).not.toHaveBeenCalled();
  });

  it('publishes backward focus direction and preserves page-content range data', async () => {
    const anchor = caret(9);
    const focus = caret(2);
    const range = exactRange(anchor, focus, 'backward', 'reverse');
    const capability = capabilityFrom(
      vi
        .fn<ReaderTextSelectionInteractions['resolveCaret']>()
        .mockResolvedValueOnce(resolvedCaret(anchor))
        .mockResolvedValueOnce(resolvedCaret(focus)),
      vi
        .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
        .mockResolvedValue({ status: 'resolved', range }),
    );
    const engine = createNativeSelectionEngine(capability);

    engine.handlePointerDown(point(9));
    await flushMicrotasks();
    engine.handlePointerUp(point(2));
    await flushMicrotasks();

    expect(engine.getSnapshot()).toEqual({
      range,
      text: 'reverse',
      rects: range.rects,
      sourceLocator: range.sourceLocator,
      focusDirection: 'backward',
      focusCaret: { pageIndex: 0, geometry: focus.geometry },
    });
  });

  it('keeps the original anchor while one gesture crosses it and reverses direction', async () => {
    const anchor = caret(5);
    const forwardFocus = caret(9);
    const backwardFocus = caret(2);
    const forwardRange = exactRange(anchor, forwardFocus, 'forward', 'forward');
    const backwardRange = exactRange(anchor, backwardFocus, 'backward', 'backward');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor))
      .mockResolvedValueOnce(resolvedCaret(forwardFocus))
      .mockResolvedValueOnce(resolvedCaret(backwardFocus))
      .mockResolvedValueOnce(resolvedCaret(backwardFocus));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: forwardRange })
      .mockResolvedValueOnce({ status: 'resolved', range: backwardRange })
      .mockResolvedValueOnce({ status: 'resolved', range: backwardRange });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    engine.handlePointerDown(point(5));
    await flushMicrotasks();
    engine.handlePointerMove(point(9));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.focusDirection).toBe('forward');

    engine.handlePointerMove(point(2));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.focusDirection).toBe('backward');
    expect(engine.getSnapshot()?.text).toBe('backward');

    engine.handlePointerUp(point(2));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.focusDirection).toBe('backward');
    expect(resolveRange.mock.calls.map(([start]) => start)).toEqual([anchor, anchor, anchor]);
  });

  it('reports only current errors and never creates a stale result', async () => {
    const first = deferred<ReaderTextCaretResolution | undefined>();
    const second = deferred<ReaderTextCaretResolution | undefined>();
    const onError = vi.fn();
    const capability = capabilityFrom(
      vi
        .fn<ReaderTextSelectionInteractions['resolveCaret']>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>(),
    );
    const engine = createNativeSelectionEngine(capability, { onError });

    engine.handlePointerDown(point(1));
    engine.clear();
    first.reject(new Error('stale'));
    await flushMicrotasks();
    expect(onError).not.toHaveBeenCalled();

    engine.handlePointerDown(point(2));
    second.reject(new Error('current'));
    await flushMicrotasks();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'current' }));
    expect(engine.getState()).toBe('idle');
  });
});
