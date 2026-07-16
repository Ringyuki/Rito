import { describe, expect, it, vi } from 'vitest';
import { createLayoutConfig } from '@ritojs/core';
import type {
  ReaderTextRange,
  ReaderTextCaret,
  ReaderTextSelectionInteractions,
  TextMeasurer,
} from '@ritojs/core';
import { createSelectionEngine } from '../src/interaction';
import type { Spread } from '../src/interaction';
import type { NativeSelectionProjection } from '../src/interaction/selection/engine';
import { caret, deferred, flushMicrotasks } from './helpers/native-selection';

const config = createLayoutConfig({
  width: 620,
  height: 400,
  margin: 0,
  spread: 'double',
  spreadGap: 20,
});
const spread: Spread = {
  index: 0,
  left: { index: 0, bounds: rect(0, 0), content: [] },
  right: { index: 1, bounds: rect(0, 0), content: [] },
};
const measurer: TextMeasurer = {
  measureText: (text) => ({ width: text.length * 10, height: 20 }),
};
const projection: NativeSelectionProjection = {
  spreadContentToPage(x, y) {
    if (x >= 320 && x <= 620) return { pageIndex: 1, x: x - 320, y };
    if (x >= 0 && x <= 300) return { pageIndex: 0, x, y };
    return null;
  },
  pageContentToSpread(pageIndex, value) {
    if (pageIndex !== 0 && pageIndex !== 1) throw new RangeError('not visible');
    return { ...value, x: value.x + (pageIndex === 1 ? 320 : 0) };
  },
};

describe('native SelectionEngine adapter', () => {
  it('maps right-page points and exact rects without exposing a legacy range', async () => {
    const anchor = caret(10);
    const focus = caret(40);
    const range = exactRange(anchor, focus);
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce({ status: 'resolved', pageIndex: 1, spreadIndex: 0, caret: anchor })
      .mockResolvedValueOnce({ status: 'resolved', pageIndex: 1, spreadIndex: 0, caret: focus });
    const capability: ReaderTextSelectionInteractions = {
      resolveCaret,
      resolveTextRange: vi.fn().mockResolvedValue({ status: 'resolved', range }),
    };
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 330, y: 12 });
    engine.handlePointerUp({ x: 360, y: 12 });
    await flushMicrotasks();

    expect(resolveCaret).toHaveBeenNthCalledWith(1, {
      pageIndex: 1,
      x: 10,
      y: 12,
    });
    expect(resolveCaret).toHaveBeenNthCalledWith(2, {
      pageIndex: 1,
      x: 40,
      y: 12,
    });
    expect(engine.getState()).toBe('selected');
    expect(engine.hasSelection()).toBe(true);
    expect(engine.getSelection()).toBeNull();
    expect(engine.getSnapshot()).toBeNull();
    expect(engine.getText()).toBe('exact text');
    expect(engine.getSourceLocator()).toEqual(range.sourceLocator);
    expect(engine.getRects()).toEqual([{ x: 330, y: 2, width: 30, height: 18 }]);
    expect(engine.getFocusRect()).toEqual({ x: 360, y: 0, width: 0, height: 18 });
    expect(engine.getFocusEdge()).toBe('end');
  });

  it('keeps capability presence authoritative when the native revision is unavailable', async () => {
    const resolveTextRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const capability: ReaderTextSelectionInteractions = {
      resolveCaret: vi.fn().mockResolvedValue(undefined),
      resolveTextRange,
    };
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 10, y: 12 });
    engine.handlePointerUp({ x: 50, y: 12 });
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.hasSelection()).toBe(false);
    expect(engine.getText()).toBe('');
    expect(resolveTextRange).not.toHaveBeenCalled();
  });

  it('projects a text-range range across both visible pages', async () => {
    const anchor = caret(1);
    const focus = caret(10);
    const range = {
      ...exactRange(anchor, focus),
      rects: [
        { pageIndex: 0, spreadIndex: 0, x: 1, y: 2, width: 20, height: 18 },
        { pageIndex: 1, spreadIndex: 0, x: 1, y: 2, width: 30, height: 18 },
      ],
    };
    const capability: ReaderTextSelectionInteractions = {
      resolveCaret: vi
        .fn<ReaderTextSelectionInteractions['resolveCaret']>()
        .mockResolvedValueOnce({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: anchor })
        .mockResolvedValueOnce({ status: 'resolved', pageIndex: 1, spreadIndex: 0, caret: focus }),
      resolveTextRange: vi.fn().mockResolvedValue({ status: 'resolved', range }),
    };
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 1, y: 10 });
    engine.handlePointerUp({ x: 330, y: 10 });
    await flushMicrotasks();

    expect(engine.getRects()).toEqual([
      { x: 1, y: 2, width: 20, height: 18 },
      { x: 321, y: 2, width: 30, height: 18 },
    ]);
    expect(engine.getFocusRect()).toEqual({ x: 330, y: 0, width: 0, height: 18 });
  });

  it('invalidates an in-flight caret when the visible spread changes', async () => {
    const pending =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveCaret']>>>();
    const resolveTextRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const capability: ReaderTextSelectionInteractions = {
      resolveCaret: vi.fn().mockReturnValue(pending.promise),
      resolveTextRange,
    };
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);
    engine.handlePointerDown({ x: 10, y: 12 });
    engine.handlePointerUp({ x: 50, y: 12 });

    engine.setSpread(spread, config, measurer, projection);
    pending.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: caret(10) });
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.hasSelection()).toBe(false);
    expect(resolveTextRange).not.toHaveBeenCalled();
  });

  it('dispose cancels work and ignores later pointer input', async () => {
    const pending =
      deferred<Awaited<ReturnType<ReaderTextSelectionInteractions['resolveCaret']>>>();
    const resolveCaret = vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockReturnValue(pending.promise);
    const resolveTextRange = vi.fn<ReaderTextSelectionInteractions['resolveTextRange']>();
    const capability: ReaderTextSelectionInteractions = {
      resolveCaret,
      resolveTextRange,
    };
    const engine = createSelectionEngine(capability);
    engine.setSpread(spread, config, measurer, projection);
    engine.handlePointerDown({ x: 10, y: 12 });

    engine.dispose();
    pending.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: caret(10) });
    await flushMicrotasks();
    engine.handlePointerDown({ x: 20, y: 12 });

    expect(resolveCaret).toHaveBeenCalledOnce();
    expect(resolveTextRange).not.toHaveBeenCalled();
    expect(engine.getState()).toBe('idle');
  });

  it('fails closed when native range geometry references an invisible page', async () => {
    const anchor = caret(1);
    const focus = caret(5);
    const range = {
      ...exactRange(anchor, focus),
      rects: [{ pageIndex: 99, spreadIndex: 49, x: 1, y: 2, width: 3, height: 18 }],
    };
    const capability: ReaderTextSelectionInteractions = {
      resolveCaret: vi
        .fn<ReaderTextSelectionInteractions['resolveCaret']>()
        .mockResolvedValueOnce({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: anchor })
        .mockResolvedValueOnce({ status: 'resolved', pageIndex: 0, spreadIndex: 0, caret: focus }),
      resolveTextRange: vi.fn().mockResolvedValue({ status: 'resolved', range }),
    };
    const engine = createSelectionEngine(capability);
    const onError = vi.fn();
    engine.onError(onError);
    engine.setSpread(spread, config, measurer, projection);

    engine.handlePointerDown({ x: 1, y: 10 });
    engine.handlePointerUp({ x: 5, y: 10 });
    await flushMicrotasks();

    expect(engine.getState()).toBe('idle');
    expect(engine.hasSelection()).toBe(false);
    expect(engine.getRects()).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(RangeError));
  });
});

function exactRange(anchor: ReaderTextCaret, focus: ReaderTextCaret): ReaderTextRange {
  return {
    anchor,
    focus,
    start: anchor,
    end: focus,
    selectedText: 'exact text',
    sourceLocator: {
      href: 'chapter.xhtml',
      sourceRange: {
        start: { nodePath: [0], textOffset: 10 },
        end: { nodePath: [0], textOffset: 40 },
      },
    },
    rects: [{ pageIndex: 1, spreadIndex: 0, x: 10, y: 2, width: 30, height: 18 }],
  };
}

function rect(x: number, y: number) {
  return { x, y, width: 300, height: 400 };
}
