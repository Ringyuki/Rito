import { describe, expect, it, vi } from 'vitest';
import type { ReaderTextSelectionInteractions } from '@ritojs/core';
import { bindPointerEvents } from '../src/controller/wiring/pointer';
import { createSelectionEngine } from '../src/interaction';
import { createDomTarget, mouseDown, pointer, pointerPosition } from './helpers/dom-input';
import {
  caret,
  deferred,
  exactRange,
  flushMicrotasks,
  resolvedCaret,
} from './helpers/native-selection';

describe('native pointer granularity wiring', () => {
  it('prevents the replaced character epoch from flashing back over a word seed', async () => {
    const oldCaretRead =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveCaret']>>>();
    const wordRange = exactRange(caret(1), caret(5), 'forward', 'word seed');
    const resolveTextRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const resolveTextRangeFromPoints = vi
      .fn<ReaderTextSelectionInteractions['resolveTextRangeFromPoints']>()
      .mockResolvedValue({ status: 'resolved', range: wordRange });
    const capability: ReaderTextSelectionInteractions = {
      resolveCaret: vi.fn().mockReturnValue(oldCaretRead.promise),
      resolveTextRange,
      resolveTextRangeFromPoints,
    };
    const engine = createSelectionEngine(capability);
    engine.setSpread({} as never, {} as never, {} as never, {
      spreadContentToPage: (x, y) => ({ pageIndex: 0, x, y }),
      isPageVisible: (pageIndex) => pageIndex === 0,
      pageContentToSpread: (_pageIndex, rect) => rect,
    });
    const dom = createDomTarget();
    const click = vi.fn();
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      engine,
      pointerPosition,
      click,
    );

    dom.emit('pointerdown', pointer(1, 1, 10));
    dom.emit('mousedown', mouseDown(2));
    await flushMicrotasks();
    expect(engine.getText()).toBe('word seed');

    oldCaretRead.resolve(resolvedCaret(caret(1)));
    await flushMicrotasks();
    expect(engine.getText()).toBe('word seed');
    expect(resolveTextRange).not.toHaveBeenCalled();

    dom.emit('pointerup', pointer(1, 1, 10));
    await flushMicrotasks();
    expect(engine.getState()).toBe('selected');
    expect(engine.getText()).toBe('word seed');
    expect(click).not.toHaveBeenCalled();
    dispose();
  });
});
