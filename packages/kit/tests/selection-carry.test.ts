import { describe, expect, it, vi } from 'vitest';
import type { ReaderTextRange, ReaderTextRangeResolution } from '@ritojs/core';
import { carrySelection, restoreSelection } from '../src/controller/facade/selection-carry';
import type { Emitter, Internals } from '../src/controller/facade/types';
import { caret, exactRange, flushMicrotasks } from './helpers/native-selection';

const SOURCE = {
  href: 'Text/chapter.xhtml',
  sourceRange: {
    start: { nodePath: [0, 1], textOffset: 2 },
    end: { nodePath: [0, 1], textOffset: 9 },
  },
};

interface Harness {
  readonly internals: Internals;
  readonly emitter: Emitter;
  readonly restore: ReturnType<typeof vi.fn>;
  readonly resolve: ReturnType<typeof vi.fn>;
  answer(resolution: ReaderTextRangeResolution | undefined): Promise<void>;
}

/** A controller showing spread 1 (pages 2 and 3) with a selection in `state`. */
function harness(state: 'selected' | 'selecting', focusEdge: 'start' | 'end' = 'end'): Harness {
  let settle: (value: ReaderTextRangeResolution | undefined) => void = () => undefined;
  const resolve = vi.fn(
    () =>
      new Promise<ReaderTextRangeResolution | undefined>((done) => {
        settle = done;
      }),
  );
  const restore = vi.fn();
  const internals = {
    currentSpread: 1,
    coordState: { contentInteractionGeneration: 4 },
    engines: {
      selection: {
        getState: () => state,
        getSourceLocator: () => SOURCE,
        getFocusEdge: () => focusEdge,
        restore,
      },
    },
    reader: {
      spreads: [{ pageIndexes: [0, 1] }, { pageIndexes: [2, 3] }],
      interactions: { enabled: true, textSelection: { resolveTextRangeFromSource: resolve } },
    },
  } as unknown as Internals;
  const emitter = { emit: vi.fn() } as unknown as Emitter;
  return {
    internals,
    emitter,
    restore,
    resolve,
    async answer(resolution) {
      settle(resolution);
      await flushMicrotasks();
    },
  };
}

function rangeOnPage(pageIndex: number): ReaderTextRange {
  const range = exactRange(caret(2), caret(9), 'forward', 'carried');
  return { ...range, rects: range.rects.map((rect) => ({ ...rect, pageIndex })) };
}

describe('a selection carried through a relayout', () => {
  it('is found again by its source range and shown on the spread on screen', async () => {
    const h = harness('selected');
    restoreSelection(h.internals, h.emitter, carrySelection(h.internals));
    expect(h.resolve).toHaveBeenCalledWith(SOURCE);
    const range = rangeOnPage(3);
    await h.answer({ status: 'resolved', range });
    expect(h.restore).toHaveBeenCalledWith(range);
  });

  it('keeps the edge that followed the pointer', async () => {
    const h = harness('selected', 'start');
    restoreSelection(h.internals, h.emitter, carrySelection(h.internals));
    const range = rangeOnPage(2);
    await h.answer({ status: 'resolved', range });
    expect(h.restore).toHaveBeenCalledWith({ ...range, anchor: range.end, focus: range.start });
  });

  it('is dropped once another layout or a turn replaced the one it was resolved in', async () => {
    const relaid = harness('selected');
    restoreSelection(relaid.internals, relaid.emitter, carrySelection(relaid.internals));
    relaid.internals.coordState.contentInteractionGeneration += 1;
    await relaid.answer({ status: 'resolved', range: rangeOnPage(2) });
    expect(relaid.restore).not.toHaveBeenCalled();

    const turned = harness('selected');
    restoreSelection(turned.internals, turned.emitter, carrySelection(turned.internals));
    turned.internals.currentSpread = 0;
    await turned.answer({ status: 'resolved', range: rangeOnPage(2) });
    expect(turned.restore).not.toHaveBeenCalled();
  });

  it('is dropped when it lands off the spread on screen or is not found', async () => {
    const elsewhere = harness('selected');
    restoreSelection(elsewhere.internals, elsewhere.emitter, carrySelection(elsewhere.internals));
    await elsewhere.answer({ status: 'resolved', range: rangeOnPage(5) });
    expect(elsewhere.restore).not.toHaveBeenCalled();

    const gone = harness('selected');
    restoreSelection(gone.internals, gone.emitter, carrySelection(gone.internals));
    await gone.answer({ status: 'unavailable', reason: 'sourceUnavailable' });
    expect(gone.restore).not.toHaveBeenCalled();
  });

  it('carries only a selection that was made, not one being made', () => {
    const h = harness('selecting');
    expect(carrySelection(h.internals)).toBeNull();
    restoreSelection(h.internals, h.emitter, null);
    expect(h.resolve).not.toHaveBeenCalled();
  });
});
