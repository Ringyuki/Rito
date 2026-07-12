import { describe, expect, it, vi } from 'vitest';
import { wirePositionTracker } from '../src/controller/wiring/position';
import { createPositionTracker } from '../src/interaction/position/tracker';
import { createDisposableCollection } from '../src/utils/disposable';

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
});
