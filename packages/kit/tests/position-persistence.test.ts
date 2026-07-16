import { describe, expect, it, vi } from 'vitest';
import type { ReaderControllerEvents } from '../src/controller/types';
import { wirePositionTracker } from '../src/controller/wiring/position';
import { createPositionTracker } from '../src/interaction/position/tracker';
import { createDisposableCollection } from '../src/utils/disposable';
import { createEmitter } from '../src/utils/event-emitter';

describe('position persistence wiring', () => {
  it('reports automatic save failures instead of leaking an unhandled rejection', async () => {
    const failure = new Error('quota exceeded');
    const emit = vi.fn();
    const tracker = createPositionTracker(() => ({
      spreads: [{ index: 0 }],
      pages: [],
      chapterMap: new Map(),
    }));
    const deps = {
      engines: { position: tracker },
      emitter: { emit },
      hasRestored: () => true,
      positionPersistence: { save: vi.fn(() => Promise.reject(failure)) },
    };
    const disposables = createDisposableCollection();
    wirePositionTracker(deps as never, disposables);

    tracker.update(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(emit).toHaveBeenCalledWith('error', {
      message: 'quota exceeded',
      source: 'position-storage',
    });
    disposables.disposeAll();
  });

  it('does not emit when a pending save rejects after disposal', async () => {
    const pendingSave = deferred<undefined>();
    const tracker = createPositionTracker(() => ({
      spreads: [{ index: 0 }],
      pages: [],
      chapterMap: new Map(),
    }));
    const emitter = createEmitter<ReaderControllerEvents>();
    const errorListener = vi.fn();
    emitter.on('error', errorListener);
    const deps = {
      engines: { position: tracker },
      emitter,
      hasRestored: () => true,
      positionPersistence: { save: vi.fn(() => pendingSave.promise) },
    };
    const disposables = createDisposableCollection();
    disposables.add(() => {
      emitter.dispose();
    });
    wirePositionTracker(deps as never, disposables);

    tracker.update(0);
    expect(deps.positionPersistence.save).toHaveBeenCalledOnce();
    disposables.disposeAll();
    pendingSave.reject(new Error('late quota failure'));
    await Promise.resolve();
    await Promise.resolve();

    expect(errorListener).not.toHaveBeenCalled();
  });

  it('contains an error listener failure while reporting a rejected save', async () => {
    const tracker = createPositionTracker(() => ({
      spreads: [{ index: 0 }],
      pages: [],
      chapterMap: new Map(),
    }));
    const emitter = createEmitter<ReaderControllerEvents>();
    const listener = vi.fn(() => {
      throw new Error('consumer failed');
    });
    emitter.on('error', listener);
    const deps = {
      engines: { position: tracker },
      emitter,
      hasRestored: () => true,
      positionPersistence: { save: vi.fn(() => Promise.reject(new Error('quota exceeded'))) },
    };
    const disposables = createDisposableCollection();
    wirePositionTracker(deps as never, disposables);

    tracker.update(0);
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledOnce();
    });
    disposables.disposeAll();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  reject: (error: unknown) => void;
} {
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}
