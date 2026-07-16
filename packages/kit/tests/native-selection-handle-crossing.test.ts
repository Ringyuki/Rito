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

describe('native selection handle transient samples', () => {
  it('retains the last stable snapshot while crossing through a collapsed range', async () => {
    const start = caret(1);
    const fixedEnd = caret(8);
    const crossed = caret(11);
    const baseline = exactRange(start, fixedEnd, 'forward', 'baseline');
    const collapsed = exactRange(fixedEnd, fixedEnd, 'forward', '');
    const adjusted = exactRange(fixedEnd, crossed, 'forward', 'crossed');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(fixedEnd))
      .mockResolvedValueOnce(resolvedCaret(fixedEnd))
      .mockResolvedValueOnce(resolvedCaret(crossed))
      .mockResolvedValueOnce(resolvedCaret(crossed));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline })
      .mockResolvedValueOnce({ status: 'resolved', range: collapsed })
      .mockResolvedValueOnce({ status: 'resolved', range: adjusted })
      .mockResolvedValueOnce({ status: 'resolved', range: adjusted });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine);
    const changes: Array<string | null> = [];
    engine.onChange(({ snapshot }) => changes.push(snapshot?.text ?? null));
    const drag = requireDrag(engine.beginHandleDrag('start'));
    drag.update(point(8));
    await flushMicrotasks();

    expect(engine.getState()).toBe('selecting');
    expect(engine.getSnapshot()?.range).toBe(baseline);
    expect(changes).toEqual(['baseline']);

    drag.update(point(11));
    await flushMicrotasks();
    drag.finish(point(11));
    await flushMicrotasks();

    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.range).toBe(adjusted);
    expect(resolveRange.mock.calls.slice(1).map(([anchor]) => anchor)).toEqual([
      fixedEnd,
      fixedEnd,
      fixedEnd,
    ]);
  });

  it('retains the active drag after a transient cancelled capability sample', async () => {
    const start = caret(1);
    const end = caret(8);
    const moving = caret(6);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const adjusted = exactRange(start, moving, 'forward', 'adjusted');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(end))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(resolvedCaret(moving))
      .mockResolvedValueOnce(resolvedCaret(moving));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline })
      .mockResolvedValueOnce({ status: 'resolved', range: adjusted })
      .mockResolvedValueOnce({ status: 'resolved', range: adjusted });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine);
    const drag = requireDrag(engine.beginHandleDrag('end'));
    drag.update(point(5));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');
    expect(engine.getSnapshot()?.range).toBe(baseline);

    drag.update(point(6));
    await flushMicrotasks();
    drag.finish(point(6));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.range).toBe(adjusted);
  });

  it('uses the stable snapshot when fast release races a cancelled move', async () => {
    const pendingMove = deferred<ReaderTextCaretResolution | undefined>();
    const start = caret(1);
    const end = caret(8);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(end))
      .mockReturnValueOnce(pendingMove.promise)
      .mockResolvedValueOnce(undefined);
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine);
    const drag = requireDrag(engine.beginHandleDrag('end'));
    drag.update(point(6));
    drag.finish(point(7));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selecting');

    pendingMove.resolve(undefined);
    await flushMicrotasks();
    expect(engine.getState()).toBe('selected');
    expect(engine.getSnapshot()?.range).toBe(baseline);
  });

  it('clears selection when the final authoritative handle range is collapsed', async () => {
    const start = caret(1);
    const end = caret(8);
    const baseline = exactRange(start, end, 'forward', 'baseline');
    const collapsed = exactRange(start, start, 'forward', '');
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(end))
      .mockResolvedValueOnce(resolvedCaret(start))
      .mockResolvedValueOnce(resolvedCaret(start));
    const resolveRange = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRange']>()
      .mockResolvedValueOnce({ status: 'resolved', range: baseline })
      .mockResolvedValueOnce({ status: 'resolved', range: collapsed })
      .mockResolvedValueOnce({ status: 'resolved', range: collapsed });
    const engine = createNativeSelectionEngine(capabilityFrom(resolveCaret, resolveRange));

    await seedSelection(engine);
    const drag = requireDrag(engine.beginHandleDrag('end'));
    drag.update(point(1));
    await flushMicrotasks();
    expect(engine.getSnapshot()?.range).toBe(baseline);
    drag.finish(point(1));
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.getSnapshot()).toBeNull();
  });
});

async function seedSelection(
  engine: ReturnType<typeof createNativeSelectionEngine>,
): Promise<void> {
  engine.handlePointerDown(point(1));
  await flushMicrotasks();
  engine.handlePointerUp(point(8));
  await flushMicrotasks();
  expect(engine.getState()).toBe('selected');
}

function requireDrag(drag: NativeSelectionHandleDrag | null): NativeSelectionHandleDrag {
  expect(drag).not.toBeNull();
  if (!drag) throw new Error('expected native selection handle drag');
  return drag;
}
