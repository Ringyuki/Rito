import { describe, expect, it, vi } from 'vitest';
import { createLayoutConfig } from '@ritojs/core';
import type { Reader, ReaderInteractions, Spread } from '@ritojs/core';
import { createCoordinatorState } from '../src/controller/core';
import type { WiringDeps } from '../src/controller/core';
import type { ReaderControllerEvents } from '../src/controller/types';
import { wireSpreadRendered } from '../src/controller/wiring/spread';
import { createDisposableCollection } from '../src/utils/disposable';
import { createEmitter } from '../src/utils/event-emitter';

describe('spread coordination reentrancy', () => {
  it('does not let selection-change navigation resume the outer spread pass', () => {
    const spreads = [createSpread(0, 0), createSpread(1, 1)];
    const listeners = new Set<(index: number, spread: Spread) => void>();
    let currentSpread = 0;
    const notify = (index: number): void => {
      const spread = spreads[index];
      if (!spread) throw new Error('reentrant spread test target missing');
      for (const listener of listeners) listener(index, spread);
    };
    let redirected = false;
    const setSpread = vi.fn(() => {
      if (redirected) return;
      redirected = true;
      currentSpread = 1;
      notify(1);
    });
    const update = vi.fn();
    const markOverlayDirty = vi.fn();
    const reader = createReader(spreads, listeners);
    const state = createCoordinatorState();
    const disposables = createDisposableCollection();
    wireSpreadRendered(
      createDeps(
        reader,
        state,
        createCanvas(),
        setSpread,
        update,
        markOverlayDirty,
        () => currentSpread,
      ),
      disposables,
    );

    notify(0);

    expect(setSpread).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(1);
    expect(state.hitMaps.has(1)).toBe(true);
    expect(state.hitMaps.has(0)).toBe(false);
    expect(markOverlayDirty).toHaveBeenCalledOnce();
    expect(markOverlayDirty).toHaveBeenCalledWith(1);
    disposables.disposeAll();
  });

  it('uses the latest spread object after same-index selection reentry', async () => {
    const oldSpread = createSpread(0, 0);
    const latestSpread = createSpread(0, 1);
    const spreads = [oldSpread];
    const listeners = new Set<(index: number, spread: Spread) => void>();
    const notify = (): void => {
      const spread = spreads[0];
      if (!spread) throw new Error('same-index spread test target missing');
      for (const listener of listeners) listener(0, spread);
    };
    let redirected = false;
    const setSpread = vi.fn(() => {
      if (redirected) return;
      redirected = true;
      spreads[0] = latestSpread;
      notify();
    });
    const getPageTargets = vi.fn((pageIndex: number) =>
      Promise.resolve({ pageIndex, spreadIndex: 0, targets: [] }),
    );
    const interactions: ReaderInteractions = {
      enabled: true,
      getPageTargets,
      getFootnote: vi.fn(),
      resolveLocator: vi.fn(),
    };
    const reader = createReader(spreads, listeners, interactions);
    const state = createCoordinatorState();
    const update = vi.fn();
    const markOverlayDirty = vi.fn();
    const disposables = createDisposableCollection();
    wireSpreadRendered(
      createDeps(reader, state, createCanvas(), setSpread, update, markOverlayDirty, () => 0),
      disposables,
    );

    for (const listener of listeners) listener(0, oldSpread);

    await vi.waitFor(() => {
      expect(state.nativeTargetsByPage.has(1)).toBe(true);
    });
    expect(setSpread).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledOnce();
    expect(getPageTargets).toHaveBeenCalledOnce();
    expect(getPageTargets).toHaveBeenCalledWith(1);
    expect(state.hitMaps.has(1)).toBe(true);
    expect(state.hitMaps.has(0)).toBe(false);
    expect(markOverlayDirty).toHaveBeenCalledOnce();
    disposables.disposeAll();
  });
});

function createSpread(index: number, pageIndex: number): Spread {
  return {
    index,
    left: {
      index: pageIndex,
      bounds: { x: 0, y: 0, width: 300, height: 400 },
      content: [],
    },
  };
}

function createReader(
  spreads: Spread[],
  listeners: Set<(index: number, spread: Spread) => void>,
  interactions?: ReaderInteractions,
): Reader {
  return {
    spreads,
    ...(interactions ? { interactions } : {}),
    measurer: {},
    getLayoutGeometry: () =>
      createLayoutConfig({ width: 300, height: 400, margin: 20, spread: 'single' }),
    getChapterTextIndices: () => new Map(),
    onSpreadRendered(callback: (index: number, spread: Spread) => void) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  } as unknown as Reader;
}

function createDeps(
  reader: Reader,
  state: ReturnType<typeof createCoordinatorState>,
  canvas: { readonly style: { cursor: string } },
  setSpread: ReturnType<typeof vi.fn>,
  update: ReturnType<typeof vi.fn>,
  markOverlayDirty: ReturnType<typeof vi.fn>,
  getCurrentSpread: () => number,
): WiringDeps {
  return {
    reader,
    coordState: state,
    canvas,
    engines: {
      selection: { setSpread, invalidate: vi.fn() },
      search: {},
      position: { update },
    },
    emitter: createEmitter<ReaderControllerEvents>(),
    frameDriver: { markOverlayDirty },
    getCurrentSpread,
    getRenderScale: () => 1,
  } as unknown as WiringDeps;
}

function createCanvas(): { readonly style: { cursor: string } } {
  return { style: { cursor: '' } };
}
