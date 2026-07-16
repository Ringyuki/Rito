import { describe, expect, it, vi } from 'vitest';
import { createLayoutConfig } from '@ritojs/core';
import type { Reader, ReaderInteractions, Spread } from '@ritojs/core';
import { createCoordinatorState } from '../src/controller/core';
import type { WiringDeps } from '../src/controller/core';
import type { ReaderControllerEvents } from '../src/controller/types';
import { wireSpreadRendered } from '../src/controller/wiring/spread';
import { createDisposableCollection } from '../src/utils/disposable';
import { createEmitter } from '../src/utils/event-emitter';

const spread: Spread = {
  index: 0,
  left: { index: 0, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: [] },
};

describe('native target spread lifecycle', () => {
  it('ignores a stale outer render after an earlier listener redirects recursively', () => {
    const pageOne = {
      index: 1,
      bounds: { x: 0, y: 0, width: 300, height: 400 },
      content: [],
    };
    const spreadOne = { index: 1, left: pageOne } as unknown as Spread;
    const listeners = new Set<(index: number, value: Spread) => void>();
    let currentSpread = 0;
    const notify = (index: number): void => {
      const value = index === 0 ? spread : spreadOne;
      for (const listener of listeners) listener(index, value);
    };
    listeners.add((index) => {
      if (index !== 0) return;
      currentSpread = 1;
      notify(1);
    });
    const reader = {
      spreads: [spread, spreadOne],
      measurer: {},
      getLayoutGeometry: () =>
        createLayoutConfig({ width: 300, height: 400, margin: 20, spread: 'single' }),
      getChapterTextIndices: () => new Map(),
      onSpreadRendered(callback: (index: number, value: Spread) => void) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    } as unknown as Reader;
    const state = createCoordinatorState();
    state.positionUpdateMode = { kind: 'skip', spreadIndex: 0 };
    const update = vi.fn();
    const setSpread = vi.fn();
    const deps = {
      reader,
      coordState: state,
      canvas: { style: { cursor: '' } },
      engines: {
        selection: { setSpread, invalidate: vi.fn() },
        search: {},
        position: { update },
      },
      emitter: createEmitter<ReaderControllerEvents>(),
      frameDriver: { markOverlayDirty: vi.fn() },
      getCurrentSpread: () => currentSpread,
      getRenderScale: () => 1,
    } as unknown as WiringDeps;
    const disposables = createDisposableCollection();
    wireSpreadRendered(deps, disposables);

    notify(0);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(1);
    expect(setSpread).toHaveBeenCalledOnce();
    expect(state.hitMaps.has(1)).toBe(true);
    expect(state.hitMaps.has(0)).toBe(false);
    expect(state.positionUpdateMode).toEqual({ kind: 'capture' });
    disposables.disposeAll();
  });

  it('does not schedule stale native work after position capture redirects recursively', async () => {
    const pageOne = {
      index: 1,
      bounds: { x: 0, y: 0, width: 300, height: 400 },
      content: [],
    };
    const spreadOne = { index: 1, left: pageOne } as unknown as Spread;
    const listeners = new Set<(index: number, value: Spread) => void>();
    let currentSpread = 0;
    const notify = (index: number): void => {
      const value = index === 0 ? spread : spreadOne;
      for (const listener of listeners) listener(index, value);
    };
    const getPageTargets = vi.fn((pageIndex: number) =>
      Promise.resolve({ pageIndex, spreadIndex: pageIndex, targets: [] }),
    );
    const interactions: ReaderInteractions = {
      enabled: true,
      getPageTargets,
      getFootnote: vi.fn(),
      resolveLocator: vi.fn(),
    };
    const reader = {
      interactions,
      spreads: [spread, spreadOne],
      measurer: {},
      getLayoutGeometry: () =>
        createLayoutConfig({ width: 300, height: 400, margin: 20, spread: 'single' }),
      getChapterTextIndices: () => new Map(),
      onSpreadRendered(callback: (index: number, value: Spread) => void) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    } as unknown as Reader;
    const state = createCoordinatorState();
    const update = vi.fn((spreadIndex: number) => {
      if (spreadIndex !== 0) return;
      currentSpread = 1;
      notify(1);
    });
    const markOverlayDirty = vi.fn();
    const deps = {
      reader,
      coordState: state,
      canvas: { style: { cursor: '' } },
      engines: {
        selection: { setSpread: vi.fn(), invalidate: vi.fn() },
        search: {},
        position: { update },
      },
      emitter: createEmitter<ReaderControllerEvents>(),
      frameDriver: { markOverlayDirty },
      getCurrentSpread: () => currentSpread,
      getRenderScale: () => 1,
    } as unknown as WiringDeps;
    const disposables = createDisposableCollection();
    wireSpreadRendered(deps, disposables);

    notify(0);

    await vi.waitFor(() => {
      expect(state.nativeTargetsByPage.has(1)).toBe(true);
    });
    expect(getPageTargets).toHaveBeenCalledOnce();
    expect(getPageTargets).toHaveBeenCalledWith(1);
    expect(state.nativeTargetsByPage.has(0)).toBe(false);
    expect(state.hitMaps.has(1)).toBe(true);
    expect(state.hitMaps.has(0)).toBe(false);
    expect(markOverlayDirty).toHaveBeenCalledOnce();
    expect(markOverlayDirty).toHaveBeenCalledWith(1);
    disposables.disposeAll();
  });

  it('reloads after canonical resource invalidation but stays empty for previews', async () => {
    let enabled = true;
    let rendered: ((index: number, value: Spread) => void) | undefined;
    let invalidated: ((index: number) => void) | undefined;
    const getPageTargets = vi.fn(() =>
      Promise.resolve({
        pageIndex: 0,
        spreadIndex: 0,
        targets: [
          {
            kind: 'link' as const,
            bounds: { x: 1, y: 1, width: 10, height: 10 },
            label: 'link',
            href: '#target',
            targetLocator: { href: 'chapter.xhtml', anchorId: 'target' },
          },
        ],
      }),
    );
    const interactions: ReaderInteractions = {
      get enabled() {
        return enabled;
      },
      getPageTargets,
      getFootnote: vi.fn(),
      resolveLocator: vi.fn(),
    };
    const reader = {
      interactions,
      spreads: [spread],
      measurer: {},
      getLayoutGeometry: () =>
        createLayoutConfig({ width: 300, height: 400, margin: 20, spread: 'single' }),
      getChapterTextIndices: () => new Map(),
      onSpreadRendered(callback: typeof rendered) {
        rendered = callback;
        return () => {
          rendered = undefined;
        };
      },
      onSpreadContentInvalidated(callback: typeof invalidated) {
        invalidated = callback;
        return () => {
          invalidated = undefined;
        };
      },
    } as unknown as Reader;
    const state = createCoordinatorState();
    const canvas = { style: { cursor: 'pointer' } };
    const invalidateSelection = vi.fn();
    const deps = {
      reader,
      coordState: state,
      canvas,
      engines: {
        selection: { setSpread: vi.fn(), invalidate: invalidateSelection },
        search: {},
        position: null,
      },
      emitter: createEmitter<ReaderControllerEvents>(),
      frameDriver: { markOverlayDirty: vi.fn(), markContentDirty: vi.fn() },
      getCurrentSpread: () => 0,
      getRenderScale: () => 1,
      notifyNavigationContentReady: vi.fn(),
      syncViewport: vi.fn(),
    } as unknown as WiringDeps;
    const disposables = createDisposableCollection();
    wireSpreadRendered(deps, disposables);

    rendered?.(0, spread);
    await vi.waitFor(() => {
      expect(state.nativeTargetsByPage.has(0)).toBe(true);
    });
    invalidated?.(0);
    expect(invalidateSelection).not.toHaveBeenCalled();
    expect(state.nativeTargetsByPage.size).toBe(0);
    await vi.waitFor(() => {
      expect(state.nativeTargetsByPage.has(0)).toBe(true);
    });
    expect(getPageTargets).toHaveBeenCalledTimes(2);

    enabled = false;
    invalidated?.(0);
    await Promise.resolve();
    expect(state.nativeTargetsByPage.size).toBe(0);
    expect(getPageTargets).toHaveBeenCalledTimes(2);
    expect(canvas.style.cursor).toBe('');

    disposables.disposeAll();
    expect(state.nativeInteractionsAlive).toBe(false);
  });
});
