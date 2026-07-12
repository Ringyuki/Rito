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
    const deps = {
      reader,
      coordState: state,
      canvas,
      engines: {
        selection: { setSpread: vi.fn(), invalidate: vi.fn() },
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
