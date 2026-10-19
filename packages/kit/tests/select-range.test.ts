import { describe, expect, it, vi } from 'vitest';
import type { ReaderTextRange, ReaderTextRangeResolution } from '@ritojs/core';
import { buildRangeSelection } from '../src/controller/facade/select-range';
import type { Internals } from '../src/controller/facade/types';
import type { ReaderControllerEvents } from '../src/controller/types';
import type { SelectionState } from '../src/interaction/selection/engine';
import { createEmitter } from '../src/utils/event-emitter';

const range = {
  href: 'ch1.xhtml',
  sourceRange: {
    start: { nodePath: [0, 1], textOffset: 2 },
    end: { nodePath: [0, 1], textOffset: 9 },
  },
};

describe('selectRange', () => {
  it('replaces the selection with the range when it lands on the spread shown', async () => {
    const fixture = createFixture(() => Promise.resolve(resolved(4)), 'selected');

    expect(await fixture.actions.selectRange(range)).toBe(true);
    expect(fixture.calls).toEqual(['clear', 'restore']);
    expect(fixture.restored).toEqual([textRange(4)]);
  });

  it('leaves the selection alone when the range is on another spread', async () => {
    const fixture = createFixture(() => Promise.resolve(resolved(9)));
    expect(await fixture.actions.selectRange(range)).toBe(false);
    expect(fixture.calls).toEqual([]);
  });

  it('gives way to a selection the reader made while the range was read', async () => {
    const fixture = createFixture(() => {
      fixture.changeSelection();
      return Promise.resolve(resolved(4));
    });
    expect(await fixture.actions.selectRange(range)).toBe(false);
    expect(fixture.calls).toEqual([]);
  });

  it('gives way to a turn while the range was read', async () => {
    const fixture = createFixture(() => {
      fixture.internals.currentSpread = 3;
      return Promise.resolve(resolved(4));
    });
    expect(await fixture.actions.selectRange(range)).toBe(false);
  });

  it('shows only the latest of two ranges asked for', async () => {
    const reads: ((value: ReaderTextRangeResolution) => void)[] = [];
    const fixture = createFixture(
      () =>
        new Promise((resolve) => {
          reads.push(resolve);
        }),
    );
    const first = fixture.actions.selectRange(range);
    const second = fixture.actions.selectRange(range);
    reads[1]?.(resolved(5));
    reads[0]?.(resolved(4));

    expect(await second).toBe(true);
    expect(await first).toBe(false);
    expect(fixture.restored).toEqual([textRange(5)]);
  });

  it('does not take the selection from a drag in progress', async () => {
    const fixture = createFixture(() => Promise.resolve(resolved(4)), 'selecting');
    expect(await fixture.actions.selectRange(range)).toBe(false);
    expect(fixture.calls).toEqual([]);
  });

  it('reports a failed read and resolves false', async () => {
    const fixture = createFixture(() => Promise.reject(new Error('read failed')));
    expect(await fixture.actions.selectRange(range)).toBe(false);
    expect(fixture.errors).toEqual([{ message: 'read failed', source: 'select-range' }]);
  });
});

function createFixture(
  read: () => Promise<ReaderTextRangeResolution | undefined>,
  initial: SelectionState = 'idle',
) {
  let state = initial;
  const calls: string[] = [];
  const restored: ReaderTextRange[] = [];
  const listeners = new Set<() => void>();
  const changeSelection = (): void => {
    for (const listener of listeners) listener();
  };
  const selection = {
    getState: () => state,
    clear: () => {
      calls.push('clear');
      state = 'idle';
      changeSelection();
    },
    restore: (value: ReaderTextRange) => {
      calls.push('restore');
      restored.push(value);
      state = 'selected';
      changeSelection();
    },
    onSelectionChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const internals = {
    reader: {
      interactions: { enabled: true, textSelection: { resolveTextRangeFromSource: vi.fn(read) } },
      spreads: [{ index: 0, pageIndexes: [4, 5] }],
    },
    currentSpread: 0,
    engines: { selection },
    coordState: { contentInteractionGeneration: 0, nativeInteractionsAlive: true },
  } as unknown as Internals;
  const emitter = createEmitter<ReaderControllerEvents>();
  const errors: ReaderControllerEvents['error'][] = [];
  emitter.on('error', (event) => {
    errors.push(event);
  });
  const actions = buildRangeSelection(internals, emitter);
  return { actions, calls, changeSelection, errors, internals, restored };
}

function textRange(pageIndex: number): ReaderTextRange {
  return {
    selectedText: 'text',
    rects: [{ pageIndex, spreadIndex: 0, x: 0, y: 0, width: 10, height: 10 }],
  } as unknown as ReaderTextRange;
}

function resolved(pageIndex: number): ReaderTextRangeResolution {
  return { status: 'resolved', range: textRange(pageIndex) } as ReaderTextRangeResolution;
}
