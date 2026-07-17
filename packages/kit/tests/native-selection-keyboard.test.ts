import type {
  ReaderTextSelectionInteractions,
  ReaderTextSelectionMovementResolution,
} from '@ritojs/core';
import { describe, expect, it, vi } from 'vitest';
import { createNativeSelectionEngine } from '../src/interaction/selection/native-engine';
import {
  caret,
  deferred,
  exactRange,
  flushMicrotasks,
  point,
  resolvedCaret,
} from './helpers/native-selection';

describe('native exact keyboard selection', () => {
  it('keeps the original anchor and carries sticky inline position across visual lines', async () => {
    const anchor = caret(2);
    const initialFocus = caret(6);
    const nextFocus = caret(9);
    const finalFocus = caret(12);
    const resolveMovement = vi
      .fn<NonNullable<ReaderTextSelectionInteractions['resolveTextSelectionMovement']>>()
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, nextFocus, 'forward', 'first'),
        preferredInlinePosition: 41,
      })
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, finalFocus, 'forward', 'second'),
        preferredInlinePosition: 41,
      });
    const engine = await selectedEngine(anchor, initialFocus, resolveMovement);

    const first = engine.beginKeyboardMovement('lineDown');
    expect(first).not.toBeNull();
    await expect(first?.result).resolves.toMatchObject({ status: 'resolved' });
    expect(engine.getSnapshot()?.range.focus).toBe(initialFocus);
    expect(first?.commit()).toBe(true);
    first?.finish();
    const second = engine.beginKeyboardMovement('lineDown');
    await expect(second?.result).resolves.toMatchObject({ status: 'resolved' });
    expect(second?.commit()).toBe(true);

    expect(resolveMovement).toHaveBeenNthCalledWith(1, {
      anchor,
      focus: initialFocus,
      movement: 'lineDown',
    });
    expect(resolveMovement).toHaveBeenNthCalledWith(2, {
      anchor,
      focus: nextFocus,
      movement: 'lineDown',
      preferredInlinePosition: 41,
    });
    expect(engine.getSnapshot()?.range.focus).toBe(finalFocus);
    second?.finish();
  });

  it('retains a collapsed shaped range so a later reverse movement can cross the anchor', async () => {
    const anchor = caret(4);
    const focus = caret(7);
    const collapsed = exactRange(anchor, anchor, 'forward', '');
    const reverseFocus = caret(2);
    const resolveMovement = vi
      .fn<NonNullable<ReaderTextSelectionInteractions['resolveTextSelectionMovement']>>()
      .mockResolvedValueOnce({ status: 'resolved', range: collapsed })
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, reverseFocus, 'backward', 'reversed'),
      });
    const engine = await selectedEngine(anchor, focus, resolveMovement);

    const collapse = engine.beginKeyboardMovement('characterLeft');
    await collapse?.result;
    expect(collapse?.commit()).toBe(true);
    collapse?.finish();
    expect(engine.getSnapshot()?.text).toBe('');
    expect(engine.canExtendKeyboardSelection()).toBe(true);

    const reverse = engine.beginKeyboardMovement('characterLeft');
    await reverse?.result;
    expect(reverse?.commit()).toBe(true);
    reverse?.finish();
    expect(resolveMovement).toHaveBeenLastCalledWith({
      anchor,
      focus: anchor,
      movement: 'characterLeft',
    });
    expect(engine.getSnapshot()?.text).toBe('reversed');
  });

  it('keeps the projection lease active and retries one movement after a revision append', async () => {
    const stale = deferred<ReaderTextSelectionMovementResolution | undefined>();
    const current = deferred<ReaderTextSelectionMovementResolution | undefined>();
    const anchor = caret(1);
    const focus = caret(5);
    const resolveMovement = vi
      .fn<NonNullable<ReaderTextSelectionInteractions['resolveTextSelectionMovement']>>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const engine = await selectedEngine(anchor, focus, resolveMovement);
    const command = engine.beginKeyboardMovement('chapterEnd');
    const lease = engine.captureActiveGesture();

    expect(command?.isActive()).toBe(true);
    expect(lease?.isActive()).toBe(true);
    engine.acceptRevisionAppend();
    stale.resolve({
      status: 'resolved',
      range: exactRange(anchor, caret(20), 'forward', 'stale'),
    });
    await flushMicrotasks();
    expect(resolveMovement).toHaveBeenCalledTimes(2);
    expect(engine.getSnapshot()?.range.focus).toBe(focus);

    const movedFocus = caret(24);
    current.resolve({
      status: 'resolved',
      range: exactRange(anchor, movedFocus, 'forward', 'current'),
    });

    await expect(command?.result).resolves.toMatchObject({ status: 'resolved' });
    expect(engine.getSnapshot()?.range.focus).toBe(focus);
    expect(command?.commit()).toBe(true);
    expect(engine.getSnapshot()?.range.focus).toBe(movedFocus);
    expect(lease?.isActive()).toBe(true);
    command?.finish();
    expect(lease?.isActive()).toBe(false);
  });

  it('does not start without the optional movement capability', async () => {
    const engine = await selectedEngine(caret(1), caret(3));
    expect(engine.canExtendKeyboardSelection()).toBe(false);
    expect(engine.beginKeyboardMovement('characterRight')).toBeNull();
  });

  it('lets a physical handle drag synchronously supersede an in-flight keyboard command', async () => {
    const pending = deferred<ReaderTextSelectionMovementResolution | undefined>();
    const resolveMovement = vi
      .fn<NonNullable<ReaderTextSelectionInteractions['resolveTextSelectionMovement']>>()
      .mockReturnValue(pending.promise);
    const engine = await selectedEngine(caret(1), caret(5), resolveMovement);
    const command = engine.beginKeyboardMovement('characterRight');

    const drag = engine.beginHandleDrag('end');
    expect(drag).not.toBeNull();
    expect(command?.isActive()).toBe(false);
    pending.resolve(undefined);
    await expect(command?.result).resolves.toEqual({ status: 'cancelled' });
    expect(command?.commit()).toBe(false);
    drag?.cancel();
  });

  it('preserves the sticky inline position when a non-vertical command is cancelled', async () => {
    const cancelled = deferred<ReaderTextSelectionMovementResolution | undefined>();
    const anchor = caret(2);
    const initialFocus = caret(6);
    const lineFocus = caret(9);
    const finalFocus = caret(12);
    const resolveMovement = vi
      .fn<NonNullable<ReaderTextSelectionInteractions['resolveTextSelectionMovement']>>()
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, lineFocus, 'forward', 'line'),
        preferredInlinePosition: 41,
      })
      .mockReturnValueOnce(cancelled.promise)
      .mockResolvedValueOnce({
        status: 'resolved',
        range: exactRange(anchor, finalFocus, 'forward', 'final'),
        preferredInlinePosition: 41,
      });
    const engine = await selectedEngine(anchor, initialFocus, resolveMovement);

    const first = engine.beginKeyboardMovement('lineDown');
    await first?.result;
    expect(first?.commit()).toBe(true);
    first?.finish();

    const stale = engine.beginKeyboardMovement('characterRight');
    stale?.finish();
    cancelled.resolve({
      status: 'resolved',
      range: exactRange(anchor, caret(10), 'forward', 'cancelled'),
    });
    await expect(stale?.result).resolves.toEqual({ status: 'cancelled' });
    expect(stale?.commit()).toBe(false);

    const next = engine.beginKeyboardMovement('lineDown');
    await next?.result;
    expect(resolveMovement).toHaveBeenLastCalledWith({
      anchor,
      focus: lineFocus,
      movement: 'lineDown',
      preferredInlinePosition: 41,
    });
    expect(next?.commit()).toBe(true);
    next?.finish();
    expect(engine.getSnapshot()?.range.focus).toBe(finalFocus);
  });
});

async function selectedEngine(
  anchor: ReturnType<typeof caret>,
  focus: ReturnType<typeof caret>,
  resolveTextSelectionMovement?: NonNullable<
    ReaderTextSelectionInteractions['resolveTextSelectionMovement']
  >,
) {
  const capability: ReaderTextSelectionInteractions = {
    resolveCaret: vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor)),
    resolveTextRange: vi.fn(),
    resolveTextRangeToPoint: vi.fn().mockResolvedValue({
      status: 'resolved',
      range: exactRange(anchor, focus, 'forward', 'initial'),
    }),
    resolveTextRangeFromPoints: vi.fn(),
    ...(resolveTextSelectionMovement ? { resolveTextSelectionMovement } : {}),
  };
  const engine = createNativeSelectionEngine(capability);
  engine.handlePointerDown(point(1));
  await flushMicrotasks();
  engine.handlePointerUp(point(5));
  await flushMicrotasks();
  expect(engine.getState()).toBe('selected');
  return engine;
}
