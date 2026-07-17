import type {
  ReaderInteractions,
  ReaderLocator,
  ReaderLocatorResolution,
  ReaderPageReadingAnchor,
} from '@ritojs/core';
import { describe, expect, it, vi } from 'vitest';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import type { Internals } from '../src/controller/core/internals';
import { buildPositionActions } from '../src/controller/facade/position-actions';
import { createPrimarySelectionDragNavigation } from '../src/controller/facade/selection-primary-drag';
import { claimSelectionInputIntent } from '../src/controller/facade/selection-spread-transfer';
import type { Nav } from '../src/controller/facade/types';
import { createPositionPersistence } from '../src/controller/position-persistence';
import type { PositionLocatorNavigator } from '../src/interaction/position/native';
import { createPositionTracker } from '../src/interaction/position/tracker';
import type { PositionLayout, ReadingPosition } from '../src/interaction/position/model';

const locator: ReaderLocator = {
  href: 'target.xhtml',
  sourcePoint: { nodePath: [0], textOffset: 4 },
};

describe('selection input versus portable position ownership', () => {
  it('cancels a pending goToPosition resolver and recaptures the current position', async () => {
    const resolution = deferred<ReaderLocatorResolution | undefined>();
    const navigateToLocator = vi.fn<PositionLocatorNavigator>(() => resolution.promise);
    const tracker = createPositionTracker(layout, () => undefined, navigateToLocator);
    const storage = positionStorage();
    const internals = createInternals(tracker, storage);
    const { nav, jumpToSpread } = createNav(internals);
    const actions = buildPositionActions(internals, nav);
    tracker.update(internals.currentSpread);

    const going = actions.goToPosition(targetPosition());
    expect(navigateToLocator).toHaveBeenCalledOnce();
    expect(tracker.serialize()).toBeUndefined();

    const input = claimSelectionInputIntent(internals, nav);

    expect(input?.owns()).toBe(true);
    expect(navigateToLocator.mock.calls[0]?.[1].aborted).toBe(true);
    expectSerializableCurrentPosition(tracker);
    await expect(going).resolves.toBeUndefined();

    resolution.resolve(resolvedTarget());
    await settleTasks();

    expect(jumpToSpread).not.toHaveBeenCalled();
    expect(input?.owns()).toBe(true);
    expectSerializableCurrentPosition(tracker);
  });

  it('cancels a pending restore load through primary drag claim and preserves current position', async () => {
    const loaded = deferred<string | null>();
    const storage = positionStorage(loaded.promise);
    const tracker = createPositionTracker(layout);
    const internals = createInternals(tracker, storage);
    const { nav, jumpToSpread } = createNav(internals);
    const actions = buildPositionActions(internals, nav);
    const primarySelection = createPrimarySelectionDragNavigation(
      internals,
      {} as HTMLCanvasElement,
      nav,
    );
    tracker.update(internals.currentSpread);

    const restoring = actions.restorePosition();
    expect(storage.load).toHaveBeenCalledOnce();
    expect(tracker.serialize()).toBeUndefined();

    const input = primarySelection.claim();

    expect(input?.owns()).toBe(true);
    expectSerializableCurrentPosition(tracker);
    await expect(restoring).resolves.toBeUndefined();

    loaded.resolve(JSON.stringify(targetPosition()));
    await settleTasks();

    expect(jumpToSpread).not.toHaveBeenCalled();
    expect(input?.owns()).toBe(true);
    expectSerializableCurrentPosition(tracker);
    expect(storage.save).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.save.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      projection: { pageIndex: 1, spreadIndex: 1 },
    });
  });

  it('preserves a stable native position without requiring a fresh anchor capture', async () => {
    const getPageReadingAnchor = vi.fn<
      (pageIndex: number) => Promise<ReaderPageReadingAnchor | undefined>
    >(() =>
      Promise.resolve({
        status: 'resolved',
        pageIndex: 1,
        spreadIndex: 1,
        locator,
      }),
    );
    const interactions = {
      enabled: true,
      getPageReadingAnchor,
      resolveLocator: vi.fn(),
    } as unknown as ReaderInteractions;
    const tracker = createPositionTracker(layout, () => interactions);
    const internals = createInternals(tracker, positionStorage());
    const { nav } = createNav(internals);
    tracker.update(internals.currentSpread);
    await tracker.settle();
    const before = tracker.serialize();
    const changed = vi.fn();
    tracker.onPositionChange(changed);
    getPageReadingAnchor.mockResolvedValue(undefined);

    const input = claimSelectionInputIntent(internals, nav);

    expect(input?.owns()).toBe(true);
    expect(getPageReadingAnchor).toHaveBeenCalledOnce();
    expect(tracker.serialize()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
  });

  it('lets position work started synchronously by abort supersede the selection claim', async () => {
    const first = deferred<ReaderLocatorResolution | undefined>();
    const second = deferred<ReaderLocatorResolution | undefined>();
    const signals: AbortSignal[] = [];
    let replacement: Promise<number | undefined> | undefined;
    const navigateToLocator = vi.fn<PositionLocatorNavigator>((_locator, signal) => {
      signals.push(signal);
      if (signals.length === 1) {
        signal.addEventListener(
          'abort',
          () => {
            replacement = actions.goToPosition(targetPosition());
          },
          { once: true },
        );
        return first.promise;
      }
      return second.promise;
    });
    const tracker = createPositionTracker(layout, () => undefined, navigateToLocator);
    const internals = createInternals(tracker, positionStorage());
    const { nav, jumpToSpread } = createNav(internals);
    const actions = buildPositionActions(internals, nav);
    tracker.update(internals.currentSpread);
    const original = actions.goToPosition(targetPosition());

    const input = claimSelectionInputIntent(internals, nav);

    expect(input).toBeNull();
    expect(replacement).toBeDefined();
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);
    second.resolve(resolvedTarget());
    await expect(replacement).resolves.toBe(0);
    expect(jumpToSpread).toHaveBeenCalledWith(0, true);
    expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 0, spreadIndex: 0 });

    first.resolve(resolvedTarget());
    await expect(original).resolves.toBeUndefined();
    expect(signals[1]?.aborted).toBe(false);
  });

  it('does not let a stale outer position action overwrite reentrant newer work', async () => {
    const first = deferred<ReaderLocatorResolution | undefined>();
    const second = deferred<ReaderLocatorResolution | undefined>();
    const signals: AbortSignal[] = [];
    let replacement: Promise<number | undefined> | undefined;
    const navigateToLocator = vi.fn<PositionLocatorNavigator>((_locator, signal) => {
      signals.push(signal);
      if (signals.length === 1) {
        signal.addEventListener(
          'abort',
          () => {
            replacement = actions.goToPosition(targetPosition());
          },
          { once: true },
        );
        return first.promise;
      }
      return second.promise;
    });
    const tracker = createPositionTracker(layout, () => undefined, navigateToLocator);
    const internals = createInternals(tracker, positionStorage());
    const { nav, jumpToSpread, supersedeForPositionIntent } = createNav(internals);
    const actions = buildPositionActions(internals, nav);
    tracker.update(internals.currentSpread);
    const original = actions.goToPosition(targetPosition());

    const staleOuter = actions.goToPosition(targetPosition());

    expect(replacement).toBeDefined();
    expect(internals.pendingPositionAction).toBe(replacement);
    expect(supersedeForPositionIntent).toHaveBeenCalledTimes(2);
    await expect(staleOuter).resolves.toBeUndefined();
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);

    second.resolve(resolvedTarget());
    await expect(replacement).resolves.toBe(0);
    expect(jumpToSpread).toHaveBeenCalledWith(0, true);
    first.resolve(resolvedTarget());
    await expect(original).resolves.toBeUndefined();
  });

  it('rejects a synchronous reentrant save without deadlocking restore construction', async () => {
    const storage = positionStorage();
    let reentrantFailure: unknown;
    storage.load.mockImplementation(async () => {
      try {
        await actions.savePosition();
      } catch (error) {
        reentrantFailure = error;
      }
      return null;
    });
    const tracker = createPositionTracker(layout);
    const internals = createInternals(tracker, storage);
    const { nav } = createNav(internals);
    const actions = buildPositionActions(internals, nav);
    tracker.update(internals.currentSpread);

    await expect(actions.restorePosition()).resolves.toBeUndefined();
    expect(reentrantFailure).toEqual(
      new Error('ReaderController.savePosition() cannot reenter active position work'),
    );
  });

  it('rejects an awaited reentrant save after asynchronous storage work', async () => {
    const storage = positionStorage();
    let reentrantFailure: unknown;
    storage.load.mockImplementation(async () => {
      await Promise.resolve();
      try {
        await actions.savePosition();
      } catch (error) {
        reentrantFailure = error;
      }
      return null;
    });
    const tracker = createPositionTracker(layout);
    const internals = createInternals(tracker, storage);
    const { nav } = createNav(internals);
    const actions = buildPositionActions(internals, nav);
    tracker.update(internals.currentSpread);

    await expect(actions.restorePosition()).resolves.toBeUndefined();
    expect(reentrantFailure).toEqual(
      new Error('ReaderController.savePosition() cannot reenter active position work'),
    );
  });

  it('rejects save adapter self-reentry without deadlocking persistence', async () => {
    const storage = positionStorage();
    let reentrantFailure: unknown;
    storage.save.mockImplementation(async () => {
      await Promise.resolve();
      try {
        await actions.savePosition();
      } catch (error) {
        reentrantFailure = error;
      }
    });
    const tracker = createPositionTracker(layout);
    const internals = createInternals(tracker, storage);
    const { nav } = createNav(internals);
    const actions = buildPositionActions(internals, nav);
    tracker.update(internals.currentSpread);

    await expect(actions.savePosition()).resolves.toBeUndefined();
    expect(storage.save).toHaveBeenCalledOnce();
    expect(reentrantFailure).toEqual(
      new Error('ReaderController.savePosition() cannot reenter active position work'),
    );
  });
});

function createInternals(
  tracker: ReturnType<typeof createPositionTracker>,
  storage: ReturnType<typeof positionStorage>,
): Internals {
  return {
    currentSpread: 1,
    options: { positionStorage: storage },
    engines: { position: tracker },
    coordState: createCoordinatorState(),
    positionPersistence: createPositionPersistence(storage),
    restoreCompleted: false,
  } as unknown as Internals;
}

function createNav(internals: Internals): {
  readonly nav: Nav;
  readonly jumpToSpread: ReturnType<typeof vi.fn>;
  readonly supersedeForPositionIntent: ReturnType<typeof vi.fn>;
} {
  const jumpToSpread = vi.fn(() => true);
  const supersedeForPositionIntent = vi.fn(() => {
    internals.coordState.contentInteractionGeneration += 1;
  });
  const nav = {
    jumpToSpread,
    supersedeForPositionIntent,
    supersedeForSelectionIntent: vi.fn(() => {
      const generation = ++internals.coordState.contentInteractionGeneration;
      return {
        owns: () => internals.coordState.contentInteractionGeneration === generation,
      };
    }),
  } as unknown as Nav;
  return { nav, jumpToSpread, supersedeForPositionIntent };
}

function positionStorage(load: Promise<string | null> = Promise.resolve(null)) {
  return {
    load: vi.fn(() => load),
    save: vi.fn((_serialized: string) => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
  };
}

function targetPosition(): ReadingPosition {
  return {
    sourceLocator: locator,
    projection: { spreadIndex: 0, pageIndex: 0 },
    progress: 0,
    timestamp: 1,
  };
}

function resolvedTarget(): ReaderLocatorResolution {
  return {
    status: 'resolved',
    locator,
    spineIdref: 'chapter',
    pageIndex: 0,
    spreadIndex: 0,
    matchedBy: 'sourcePoint',
  };
}

function expectSerializableCurrentPosition(
  tracker: ReturnType<typeof createPositionTracker>,
): void {
  const serialized = tracker.serialize();
  expect(serialized).toBeDefined();
  expect(JSON.parse(serialized ?? '{}')).toMatchObject({
    locator: { spineIdref: 'chapter' },
    projection: { pageIndex: 1, spreadIndex: 1 },
  });
}

function layout(): PositionLayout {
  const pages = [
    { index: 0, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: [] },
    { index: 1, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: [] },
  ] as const;
  return {
    pages,
    spreads: [
      { index: 0, left: pages[0] },
      { index: 1, left: pages[1] },
    ],
    chapterMap: new Map([['chapter', { startPage: 0, endPage: 1 }]]),
  };
}

async function settleTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
