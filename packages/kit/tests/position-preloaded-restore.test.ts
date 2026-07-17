import { describe, expect, it, vi } from 'vitest';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import type { Internals } from '../src/controller/core/internals';
import { buildPositionActions } from '../src/controller/facade/position-actions';
import { createPositionPersistence } from '../src/controller/position-persistence';
import type { PositionLayout, ReadingPosition } from '../src/interaction/position/model';
import { createPositionTracker } from '../src/interaction/position/tracker';

describe('preloaded position restore', () => {
  it('restores a serialized position without loading storage', async () => {
    const tracker = createPositionTracker(createLayout);
    const load = vi.fn(() => Promise.resolve(null));
    const save = vi.fn(() => Promise.resolve());
    const jumpToSpread = vi.fn();
    const internals = createInternals(tracker, { load, save });
    const actions = buildPositionActions(internals, createPositionNav(jumpToSpread));

    await expect(actions.restorePosition(JSON.stringify(position(1)))).resolves.toBe(1);

    expect(load).not.toHaveBeenCalled();
    expect(jumpToSpread).toHaveBeenCalledWith(1, true);
    expect(internals.restoreCompleted).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('treats explicit null as preloaded empty state', async () => {
    const tracker = createPositionTracker(createLayout);
    const load = vi.fn(() => Promise.resolve(JSON.stringify(position(1))));
    const internals = createInternals(tracker, { load, save: vi.fn(() => Promise.resolve()) });
    const actions = buildPositionActions(internals, createPositionNav());

    await expect(actions.restorePosition(null)).resolves.toBeUndefined();

    expect(load).not.toHaveBeenCalled();
    expect(internals.restoreCompleted).toBe(true);
  });
});

function createInternals(
  tracker: ReturnType<typeof createPositionTracker>,
  positionStorage: {
    readonly load: ReturnType<typeof vi.fn>;
    readonly save: ReturnType<typeof vi.fn>;
  },
): Internals {
  return {
    currentSpread: 0,
    options: { positionStorage },
    engines: { position: tracker },
    coordState: createCoordinatorState(),
    positionPersistence: createPositionPersistence(positionStorage as never),
    restoreCompleted: false,
  } as unknown as Internals;
}

function createPositionNav(jumpToSpread = vi.fn()) {
  return {
    jumpToSpread(index: number, preservePositionIntent?: boolean): boolean {
      jumpToSpread(index, preservePositionIntent);
      return true;
    },
    supersedeForPositionIntent: vi.fn(),
  } as never;
}

function createLayout(): PositionLayout {
  const pages = [0, 1].map((index) => ({
    index,
    bounds: { x: 0, y: 0, width: 300, height: 400 },
    content: [],
  }));
  const first = pages[0];
  const second = pages[1];
  if (!first || !second) throw new Error('position fixture pages are missing');
  return {
    pages,
    spreads: [
      { index: 0, left: first },
      { index: 1, left: second },
    ],
    chapterMap: new Map([['chapter', { startPage: 0, endPage: 1 }]]),
  };
}

function position(spreadIndex: number): ReadingPosition {
  return {
    locator: { spineIdref: 'chapter', chapterProgress: spreadIndex },
    projection: { spreadIndex, pageIndex: spreadIndex },
    progress: spreadIndex,
    timestamp: 1,
  };
}
