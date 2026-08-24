// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { buildLifecycle, syncCanvasSize } from '../src/controller/facade/lifecycle';
import type { Internals } from '../src/controller/core/internals';
import type { WiringDeps } from '../src/controller/core/wiring-deps';
import type { RuntimeComponents } from '../src/controller/facade/types';
import { createDisposableCollection } from '../src/utils/disposable';

describe('syncCanvasSize', () => {
  it('resizes a fresh buffer pool even when the reused surface already has the right size', () => {
    const setSize = vi.fn();
    const resize = vi.fn();
    const internals = {
      renderScale: 1,
      reader: {
        dpr: 2,
        getCanvasSize: vi.fn(() => ({ width: 800, height: 600 })),
      },
    } as unknown as Internals;
    const runtime = {
      surface: {
        width: 1600,
        height: 1200,
        setSize,
      },
      pool: {
        resize,
      },
      td: {
        viewportWidth: 0,
      },
    } as unknown as RuntimeComponents;

    syncCanvasSize(internals, runtime);

    expect(setSize).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith(800, 600, 2);
    expect(runtime.td.viewportWidth).toBe(800);
  });
});

describe('controller lifecycle', () => {
  it('keeps repeated mounts idempotent and replaces mount-scoped accessibility wiring', () => {
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    document.body.append(firstContainer, secondContainer);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-rito-reader-surface', 'host-owned');
    const unsubscribeSpread = vi.fn();
    const unsubscribeLayout = vi.fn();
    const onSpreadRendered = vi.fn(() => unsubscribeSpread);
    const onLayoutCommitted = vi.fn(() => unsubscribeLayout);
    const runtime = {
      surface: { canvas },
      frameDriver: { dispose: vi.fn() },
      pool: { dispose: vi.fn() },
      prerenderScheduler: { dispose: vi.fn() },
      disposeSettledEvents: vi.fn(),
    } as unknown as RuntimeComponents;
    const deps = {
      canvas,
      options: { a11y: { enabled: true, container: document.body } },
      reader: { spreads: [], onSpreadRendered, onLayoutCommitted },
      getCurrentSpread: () => 0,
      coordState: { activeImageBlobUrl: null, contentInteractionGeneration: 0 },
    } as unknown as WiringDeps;
    const lifecycle = buildLifecycle(createDisposableCollection(), runtime, deps);

    lifecycle.mount(firstContainer);
    lifecycle.mount(firstContainer);

    expect(canvas.getAttribute('data-rito-reader-surface')).toBe('true');
    expect(onSpreadRendered).toHaveBeenCalledOnce();
    expect(onLayoutCommitted).toHaveBeenCalledOnce();
    expect(document.body.querySelectorAll('[role="document"]')).toHaveLength(1);

    lifecycle.mount(secondContainer);

    expect(canvas.parentElement).toBe(secondContainer);
    expect(unsubscribeSpread).toHaveBeenCalledOnce();
    expect(unsubscribeLayout).toHaveBeenCalledOnce();
    expect(onSpreadRendered).toHaveBeenCalledTimes(2);
    expect(onLayoutCommitted).toHaveBeenCalledTimes(2);
    expect(document.body.querySelectorAll('[role="document"]')).toHaveLength(1);

    lifecycle.dispose();
    expect(canvas.getAttribute('data-rito-reader-surface')).toBe('host-owned');
    expect(unsubscribeSpread).toHaveBeenCalledTimes(2);
    expect(unsubscribeLayout).toHaveBeenCalledTimes(2);
    expect(document.body.querySelectorAll('[role="document"]')).toHaveLength(0);
  });

  it('restores the previous mount when replacement accessibility wiring fails', () => {
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    document.body.append(firstContainer, secondContainer);
    const canvas = document.createElement('canvas');
    const unsubscribeSpread = vi.fn();
    const failure = new Error('replacement accessibility wiring failed');
    const onSpreadRendered = vi
      .fn<() => () => void>()
      .mockReturnValueOnce(unsubscribeSpread)
      .mockImplementationOnce(() => {
        throw failure;
      });
    const runtime = {
      surface: { canvas },
      frameDriver: { dispose: vi.fn() },
      pool: { dispose: vi.fn() },
      prerenderScheduler: { dispose: vi.fn() },
      disposeSettledEvents: vi.fn(),
    } as unknown as RuntimeComponents;
    const deps = {
      canvas,
      options: { a11y: { enabled: true, container: document.body } },
      reader: {
        spreads: [],
        onSpreadRendered,
        onLayoutCommitted: vi.fn(() => vi.fn()),
      },
      getCurrentSpread: () => 0,
      coordState: { activeImageBlobUrl: null, contentInteractionGeneration: 0 },
    } as unknown as WiringDeps;
    const lifecycle = buildLifecycle(createDisposableCollection(), runtime, deps);
    lifecycle.mount(firstContainer);
    expect(canvas.getAttribute('data-rito-reader-surface')).toBe('true');

    expect(() => {
      lifecycle.mount(secondContainer);
    }).toThrow(failure);

    expect(canvas.parentElement).toBe(firstContainer);
    expect(canvas.getAttribute('data-rito-reader-surface')).toBe('true');
    expect(unsubscribeSpread).not.toHaveBeenCalled();
    expect(document.body.querySelectorAll('[role="document"]')).toHaveLength(1);
    lifecycle.dispose();
    expect(canvas.hasAttribute('data-rito-reader-surface')).toBe(false);
    expect(unsubscribeSpread).toHaveBeenCalledOnce();
  });

  it('keeps a committed replacement mount when old accessibility cleanup fails', () => {
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    document.body.append(firstContainer, secondContainer);
    const canvas = document.createElement('canvas');
    const failedOldCleanup = vi.fn(() => {
      throw new Error('old accessibility cleanup failed');
    });
    const activeCleanup = vi.fn();
    const onSpreadRendered = vi
      .fn<() => () => void>()
      .mockReturnValueOnce(failedOldCleanup)
      .mockReturnValueOnce(activeCleanup);
    const runtime = {
      surface: { canvas },
      frameDriver: { dispose: vi.fn() },
      pool: { dispose: vi.fn() },
      prerenderScheduler: { dispose: vi.fn() },
      disposeSettledEvents: vi.fn(),
    } as unknown as RuntimeComponents;
    const deps = {
      canvas,
      options: { a11y: { enabled: true, container: document.body } },
      reader: {
        spreads: [],
        onSpreadRendered,
        onLayoutCommitted: vi.fn(() => vi.fn()),
      },
      getCurrentSpread: () => 0,
      coordState: { activeImageBlobUrl: null, contentInteractionGeneration: 0 },
    } as unknown as WiringDeps;
    const lifecycle = buildLifecycle(createDisposableCollection(), runtime, deps);
    lifecycle.mount(firstContainer);

    expect(() => {
      lifecycle.mount(secondContainer);
    }).not.toThrow();

    expect(failedOldCleanup).toHaveBeenCalledOnce();
    expect(canvas.parentElement).toBe(secondContainer);
    expect(document.body.querySelectorAll('[role="document"]')).toHaveLength(1);
    expect(() => {
      lifecycle.mount(secondContainer);
    }).not.toThrow();

    lifecycle.dispose();
    expect(activeCleanup).toHaveBeenCalledOnce();
    expect(document.body.querySelectorAll('[role="document"]')).toHaveLength(0);
  });

  it('releases runtime resources when an earlier cleanup fails', () => {
    const failure = new Error('listener cleanup failed');
    const disposables = createDisposableCollection();
    disposables.add(() => {
      throw failure;
    });
    const frameDispose = vi.fn();
    const poolDispose = vi.fn();
    const prerenderDispose = vi.fn();
    const settledEventsDispose = vi.fn();
    const runtime = {
      frameDriver: { dispose: frameDispose },
      pool: { dispose: poolDispose },
      prerenderScheduler: { dispose: prerenderDispose },
      disposeSettledEvents: settledEventsDispose,
    } as unknown as RuntimeComponents;
    const deps = {
      coordState: {
        activeImageBlobUrl: null,
        contentInteractionGeneration: 0,
      },
    } as unknown as WiringDeps;
    const lifecycle = buildLifecycle(disposables, runtime, deps);

    expect(() => {
      lifecycle.dispose();
    }).toThrow(failure);
    expect(settledEventsDispose).toHaveBeenCalledOnce();
    expect(prerenderDispose).toHaveBeenCalledOnce();
    expect(frameDispose).toHaveBeenCalledOnce();
    expect(poolDispose).toHaveBeenCalledOnce();
    expect(() => {
      lifecycle.mount({} as HTMLElement);
    }).toThrow('Cannot mount a disposed reader controller');
    expect(() => {
      lifecycle.dispose();
    }).not.toThrow();
  });
});
