import { describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderLocator } from '@ritojs/core';
import { buildPositionActions } from '../src/controller/facade/position-actions';
import type { Internals } from '../src/controller/core/internals';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';
import { createPositionTracker } from '../src/interaction/position/tracker';
import type { PositionLayout, ReadingPosition } from '../src/interaction/position/model';
import { createPositionPersistence } from '../src/controller/position-persistence';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import { coordinateOnSpreadRendered } from '../src/controller/wiring/spread';

const locator: ReaderLocator = {
  href: 'chapter.xhtml',
  sourcePoint: { nodePath: [0], textOffset: 4 },
};

describe('position actions ownership', () => {
  it('does not let a slow restore overwrite a newer user position', async () => {
    const loaded = deferred<string | null>();
    const tracker = createPositionTracker(() => layout());
    const jumpToSpread = vi.fn();
    const saved: string[] = [];
    const save = vi.fn((serialized: string) => {
      saved.push(serialized);
      return Promise.resolve();
    });
    const internals = createInternals(tracker, {
      load: vi.fn(() => loaded.promise),
      save,
    });
    const actions = buildPositionActions(internals, positionNav(jumpToSpread));

    const restoring = actions.restorePosition();
    tracker.claimIntent();
    tracker.update(1);
    loaded.resolve(JSON.stringify(legacyPosition(0)));

    await expect(restoring).resolves.toBeUndefined();
    expect(tracker.getCurrent()?.projection.spreadIndex).toBe(1);
    expect(jumpToSpread).not.toHaveBeenCalled();
    expect(internals.restoreCompleted).toBe(true);
    expect(JSON.parse(saved[0] ?? '{}')).toMatchObject({
      projection: { spreadIndex: 1 },
    });
  });

  it('keeps portable layout ownership while restore storage is still loading', async () => {
    const loaded = deferred<string | null>();
    const tracker = createPositionTracker(() => layout());
    const internals = createInternals(tracker, {
      load: vi.fn(() => loaded.promise),
      save: vi.fn(() => Promise.resolve()),
    });
    const actions = buildPositionActions(internals, positionNav());

    const restoring = actions.restorePosition();

    expect(tracker.prepareLayoutCommit(undefined, 0)).toEqual({ kind: 'portable' });
    loaded.resolve(null);
    await expect(restoring).resolves.toBeUndefined();
  });

  it('ignores a late storage failure after restore ownership is superseded', async () => {
    const loaded = deferred<string | null>();
    const tracker = createPositionTracker(() => layout());
    const jumpToSpread = vi.fn();
    const save = vi.fn(() => Promise.resolve());
    const internals = createInternals(tracker, {
      load: vi.fn(() => loaded.promise),
      save,
    });
    const actions = buildPositionActions(internals, positionNav(jumpToSpread));

    const restoring = actions.restorePosition();
    tracker.claimIntent();
    tracker.update(1);
    loaded.reject(new Error('stale storage failure'));

    await expect(restoring).resolves.toBeUndefined();
    expect(tracker.getCurrent()?.projection.spreadIndex).toBe(1);
    expect(jumpToSpread).not.toHaveBeenCalled();
    expect(internals.restoreCompleted).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('cancels a never-settling restore load without blocking a later save', async () => {
    const loaded = deferred<string | null>();
    const tracker = createPositionTracker(() => layout());
    const save = vi.fn(() => Promise.resolve());
    const internals = createInternals(tracker, {
      load: vi.fn(() => loaded.promise),
      save,
    });
    const actions = buildPositionActions(internals, positionNav());

    const restoring = actions.restorePosition();
    tracker.claimIntent();
    tracker.update(1);
    const saving = actions.savePosition();

    await expect(restoring).resolves.toBeUndefined();
    await expect(saving).resolves.toBeUndefined();
    expect(tracker.getCurrent()?.projection.spreadIndex).toBe(1);
    expect(save).toHaveBeenCalledTimes(2);

    loaded.reject(new Error('late ignored-load failure'));
    await Promise.resolve();
  });

  it('cancels a pending restore load when its tracker is disposed', async () => {
    const loaded = deferred<string | null>();
    const tracker = createPositionTracker(() => layout());
    const save = vi.fn(() => Promise.resolve());
    const internals = createInternals(tracker, {
      load: vi.fn(() => loaded.promise),
      save,
    });
    const actions = buildPositionActions(internals, positionNav());

    const restoring = actions.restorePosition();
    tracker.dispose();
    const saving = actions.savePosition();

    await expect(restoring).resolves.toBeUndefined();
    await expect(saving).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();

    loaded.reject(new Error('late disposed-load failure'));
    await Promise.resolve();
  });

  it('keeps autosave gated until the newest concurrent restore finishes', async () => {
    const firstLoad = deferred<string | null>();
    const secondLoad = deferred<string | null>();
    const tracker = createPositionTracker(() => layout());
    const save = vi.fn(() => Promise.resolve());
    const load = vi
      .fn<() => Promise<string | null>>()
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise);
    const internals = createInternals(tracker, { load, save });
    const actions = buildPositionActions(internals, positionNav());

    const firstRestore = actions.restorePosition();
    const secondRestore = actions.restorePosition();
    firstLoad.resolve(null);

    await expect(firstRestore).resolves.toBeUndefined();
    expect(internals.restoreCompleted).toBe(false);
    expect(save).not.toHaveBeenCalled();

    secondLoad.resolve(JSON.stringify(legacyPosition(1)));

    await expect(secondRestore).resolves.toBe(1);
    expect(internals.restoreCompleted).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('waits for the latest valid native capture before saving', async () => {
    const captured = deferred<unknown>();
    const tracker = createPositionTracker(
      () => layout(),
      () =>
        ({
          enabled: true,
          getPageReadingAnchor: vi.fn(() => captured.promise),
          resolveLocator: vi.fn(),
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
    );
    const saved: string[] = [];
    const save = vi.fn((serialized: string) => {
      saved.push(serialized);
      return Promise.resolve();
    });
    const internals = createInternals(tracker, { load: vi.fn(), save });
    const actions = buildPositionActions(internals, positionNav());

    tracker.update(1);
    const saving = actions.savePosition();
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();

    captured.resolve({ status: 'resolved', pageIndex: 1, spreadIndex: 1, locator });
    await saving;
    expect(JSON.parse(saved[0] ?? '{}')).toMatchObject({
      sourceLocator: locator,
      projection: { pageIndex: 1, spreadIndex: 1 },
    });
  });

  it('recovers a serializable current position when storage loading fails', async () => {
    const tracker = createPositionTracker(() => layout());
    const failure = new Error('storage unavailable');
    const save = vi.fn(() => Promise.resolve());
    const internals = createInternals(tracker, {
      load: vi.fn(() => Promise.reject(failure)),
      save,
    });
    const actions = buildPositionActions(internals, positionNav());

    await expect(actions.restorePosition()).rejects.toBe(failure);

    expect(tracker.serialize()).toBeDefined();
    expect(internals.restoreCompleted).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('recovers with an exact capture when native locator resolution rejects', async () => {
    const failure = new Error('worker failed');
    const tracker = createPositionTracker(
      () => layout(),
      () =>
        ({
          enabled: true,
          getPageReadingAnchor: vi.fn(() =>
            Promise.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, locator }),
          ),
          resolveLocator: vi.fn(() => Promise.reject(failure)),
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
    );
    const internals = createInternals(tracker, { load: vi.fn(), save: vi.fn() });
    const actions = buildPositionActions(internals, positionNav());

    await expect(actions.goToPosition(position(locator))).rejects.toBe(failure);
    await tracker.settle();

    expect(tracker.serialize()).toBeDefined();
  });

  it('falls back to a fresh capture when a completed chapter has no page projection', async () => {
    const tracker = createPositionTracker(
      () => layout(),
      () =>
        ({
          enabled: true,
          getPageReadingAnchor: vi.fn(() =>
            Promise.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, locator }),
          ),
          resolveLocator: vi.fn(() =>
            Promise.resolve({
              status: 'pending',
              locator,
              spineIdref: 'chapter',
              reason: 'noPageProjection',
              matchedBy: 'sourcePoint',
            }),
          ),
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
    );
    const internals = createInternals(tracker, { load: vi.fn(), save: vi.fn() });
    const actions = buildPositionActions(internals, positionNav());

    await expect(actions.goToPosition(position(locator))).resolves.toBeUndefined();
    await tracker.settle();

    expect(tracker.serialize()).toBeDefined();
  });

  it('does not jump an old exact target after a position listener starts newer navigation', async () => {
    const tracker = createPositionTracker(
      () => layout(),
      () =>
        ({
          enabled: true,
          getPageReadingAnchor: vi.fn(),
          resolveLocator: vi.fn(() => Promise.resolve(resolvedPosition(1, 1))),
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
    );
    tracker.onPositionChange(() => {
      tracker.claimIntent();
    });
    const jumpToSpread = vi.fn();
    const internals = createInternals(tracker, { load: vi.fn(), save: vi.fn() });
    const actions = buildPositionActions(internals, positionNav(jumpToSpread));

    await expect(actions.goToPosition(position(locator))).resolves.toBeUndefined();
    expect(jumpToSpread).not.toHaveBeenCalled();
  });

  it('does not jump a restored target superseded in a position-listener microtask', async () => {
    const fixture: { internals?: Internals } = {};
    const tracker = createPositionTracker(
      () => layout(),
      () =>
        ({
          enabled: true,
          getPageReadingAnchor: vi.fn(),
          resolveLocator: vi.fn(() => Promise.resolve(resolvedPosition(1, 1))),
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
    );
    tracker.onPositionChange(() => {
      queueMicrotask(() => {
        if (fixture.internals) fixture.internals.currentSpread = 1;
        tracker.claimIntent();
      });
    });
    const jumpToSpread = vi.fn();
    const storage = {
      load: vi.fn(() => Promise.resolve(JSON.stringify(position(locator)))),
      save: vi.fn(() => Promise.resolve()),
    };
    const internals = createInternals(tracker, storage);
    fixture.internals = internals;
    const actions = buildPositionActions(internals, positionNav(jumpToSpread));

    await expect(actions.restorePosition()).resolves.toBeUndefined();
    expect(jumpToSpread).not.toHaveBeenCalled();
  });

  it('keeps an exact native right-page locator through cross-spread notification', async () => {
    const getPageReadingAnchor = vi.fn();
    const tracker = createPositionTracker(
      rightPageLayout,
      () =>
        ({
          enabled: true,
          getPageReadingAnchor,
          resolveLocator: vi.fn(() => Promise.resolve(resolvedPosition(2, 1))),
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
    );
    const internals = createInternals(tracker, { load: vi.fn(), save: vi.fn() });
    const actions = buildPositionActions(internals, positionNav());

    await expect(actions.goToPosition(position(locator))).resolves.toBe(1);
    coordinatePosition(internals, tracker, rightPageLayout(), 1);

    expect(getPageReadingAnchor).not.toHaveBeenCalled();
    expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 2, spreadIndex: 1 });
    expect(tracker.getCurrent()?.sourceLocator).toEqual(locator);
  });

  it.each(['goTo', 'restore'] as const)(
    'keeps a legacy source point after cross-spread %s',
    async (operation) => {
      const tracker = createPositionTracker(layout);
      const target = legacyExactPosition();
      const storage = {
        load: vi.fn(() => Promise.resolve(JSON.stringify(target))),
        save: vi.fn(() => Promise.resolve()),
      };
      const internals = createInternals(tracker, storage);
      const actions = buildPositionActions(internals, positionNav());

      if (operation === 'goTo') await actions.goToPosition(target);
      else await actions.restorePosition();
      coordinatePosition(internals, tracker, layout(), 1);

      expect(tracker.getCurrent()?.locator).toEqual(target.locator);
    },
  );

  it.each(['goTo', 'restore'] as const)(
    'does not jump twice after atomic full commit during %s',
    async (operation) => {
      const fixture: { internals?: Internals } = {};
      const navigateToLocator = vi.fn(() => {
        expect(tracker.prepareLayoutCommit(undefined, 1)).toEqual({ kind: 'portable' });
        if (fixture.internals) fixture.internals.currentSpread = 1;
        return Promise.resolve(resolvedPosition(1, 1));
      });
      const tracker = createPositionTracker(layout, () => undefined, navigateToLocator);
      const target = position(locator);
      const storage = {
        load: vi.fn(() => Promise.resolve(JSON.stringify(target))),
        save: vi.fn(() => Promise.resolve()),
      };
      const internals = createInternals(tracker, storage);
      fixture.internals = internals;
      const jumpToSpread = vi.fn();
      const supersedeForPositionIntent = vi.fn();
      const actions = buildPositionActions(
        internals,
        positionNav(jumpToSpread, supersedeForPositionIntent),
      );

      const result =
        operation === 'goTo' ? await actions.goToPosition(target) : await actions.restorePosition();

      expect(result).toBe(1);
      expect(navigateToLocator).toHaveBeenCalledOnce();
      expect(supersedeForPositionIntent).toHaveBeenCalledOnce();
      expect(jumpToSpread).not.toHaveBeenCalled();
      expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 1, spreadIndex: 1 });
    },
  );

  it('jumps once when atomic resolution uses the existing revision', async () => {
    const navigateToLocator = vi.fn(() => Promise.resolve(resolvedPosition(1, 1)));
    const tracker = createPositionTracker(layout, () => undefined, navigateToLocator);
    const internals = createInternals(tracker, { load: vi.fn(), save: vi.fn() });
    const jumpToSpread = vi.fn();
    const actions = buildPositionActions(internals, positionNav(jumpToSpread));

    await expect(actions.goToPosition(position(locator))).resolves.toBe(1);

    expect(jumpToSpread).toHaveBeenCalledOnce();
    expect(jumpToSpread).toHaveBeenCalledWith(1, true);
    expect(internals.coordState.positionUpdateMode).toMatchObject({
      kind: 'skip',
      spreadIndex: 1,
    });
  });

  it('captures nested navigation and rejects a position jump superseded during force-settle', async () => {
    const positionLayout = threeSpreadLayout();
    const tracker = createPositionTracker(() => positionLayout);
    tracker.update(0);
    const internals = createInternals(tracker, { load: vi.fn(), save: vi.fn() });
    const navigation: { current?: ReturnType<typeof createNavigation> } = {};
    let animating = true;
    const goToTarget = vi.fn();
    const jump = vi.fn();
    const reader = {
      totalSpreads: positionLayout.spreads.length,
      spreads: positionLayout.spreads,
      notifyActiveSpread: vi.fn((spreadIndex: number) => {
        coordinatePosition(internals, tracker, positionLayout, spreadIndex);
      }),
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => internals.currentSpread,
      setCurrentSpread: (spreadIndex: number) => {
        internals.currentSpread = spreadIndex;
      },
      emitter: { emit: vi.fn() },
      td: {
        get isAnimating() {
          return animating;
        },
        forceSettle: vi.fn(() => {
          animating = false;
          navigation.current?.goToSpread(2);
          return 0;
        }),
        goToTarget,
      },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => true),
        jump,
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: () => {
        tracker.claimIntent();
      },
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);
    navigation.current = nav;
    const actions = buildPositionActions(internals, nav);
    const target: ReadingPosition = {
      locator: { spineIdref: 'chapter', chapterProgress: 0.5 },
      projection: { spreadIndex: 1, pageIndex: 1 },
      progress: 0.5,
      timestamp: 1,
    };

    await expect(actions.goToPosition(target)).resolves.toBeUndefined();

    expect(internals.currentSpread).toBe(2);
    expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 2, spreadIndex: 2 });
    expect(internals.coordState.positionUpdateMode).toEqual({ kind: 'capture' });
    expect(jump).not.toHaveBeenCalled();
    expect(goToTarget).toHaveBeenCalledWith('forward', 0, 2, 0);
  });

  it('does not start locator work after navigation supersession loses ownership', async () => {
    const navigateToLocator = vi.fn();
    const tracker = createPositionTracker(layout, () => undefined, navigateToLocator);
    const internals = createInternals(tracker, { load: vi.fn(), save: vi.fn() });
    const supersedeForPositionIntent = vi.fn(() => {
      tracker.claimIntent();
    });
    const actions = buildPositionActions(
      internals,
      positionNav(vi.fn(), supersedeForPositionIntent),
    );

    await expect(actions.goToPosition(position(locator))).resolves.toBeUndefined();

    expect(navigateToLocator).not.toHaveBeenCalled();
  });

  it('lets a synchronous layout commit supersede a legacy projection microtask', async () => {
    let currentLayout = layout();
    const tracker = createPositionTracker(() => currentLayout);
    const jumpToSpread = vi.fn();
    const internals = createInternals(tracker, { load: vi.fn(), save: vi.fn() });
    const actions = buildPositionActions(internals, positionNav(jumpToSpread));

    const going = actions.goToPosition(legacyPosition(1));
    currentLayout = singleSpreadLayout();
    const layoutPlan = tracker.prepareLayoutCommit(undefined, 0);

    expect(layoutPlan.kind).toBe('legacy');
    await expect(going).resolves.toBeUndefined();
    expect(jumpToSpread).not.toHaveBeenCalled();
  });

  it('waits for active atomic navigation before explicitly saving its exact result', async () => {
    const navigation = deferred<ReturnType<typeof resolvedPosition>>();
    const tracker = createPositionTracker(
      layout,
      () => undefined,
      () => navigation.promise,
    );
    tracker.setCurrent(position({ ...locator, progression: 0 }));
    const saved: string[] = [];
    const storage = {
      load: vi.fn(),
      save: vi.fn((serialized: string) => {
        saved.push(serialized);
        return Promise.resolve();
      }),
    };
    const internals = createInternals(tracker, storage);
    const actions = buildPositionActions(internals, positionNav());

    const going = actions.goToPosition(position({ ...locator, progression: 1 }));
    const saving = actions.savePosition();
    await Promise.resolve();
    expect(storage.save).not.toHaveBeenCalled();

    navigation.resolve(resolvedPosition(1, 1));
    await going;
    await saving;

    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0] ?? '{}')).toMatchObject({
      sourceLocator: locator,
      projection: { pageIndex: 1, spreadIndex: 1 },
    });
  });

  it('does not let an abort-ignoring navigator block the old action or a later save', async () => {
    const navigation = deferred<ReturnType<typeof resolvedPosition>>();
    const tracker = createPositionTracker(
      layout,
      () => undefined,
      () => navigation.promise,
    );
    tracker.setCurrent(position({ ...locator, progression: 0 }));
    const save = vi.fn(() => Promise.resolve());
    const internals = createInternals(tracker, { load: vi.fn(), save });
    const actions = buildPositionActions(internals, positionNav());

    const going = actions.goToPosition(position({ ...locator, progression: 1 }));
    tracker.claimIntent();
    tracker.update(0);
    const saving = actions.savePosition();

    await expect(going).resolves.toBeUndefined();
    await expect(saving).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledOnce();

    navigation.reject(new Error('late ignored-abort failure'));
    await Promise.resolve();
  });

  it('keeps the committed spread and recaptures it when final exact resolution rejects', async () => {
    const failure = new Error('final exact resolution failed');
    const getPageReadingAnchor = vi.fn(() =>
      Promise.resolve({ status: 'resolved', pageIndex: 1, spreadIndex: 1, locator }),
    );
    const fixture: { internals?: Internals } = {};
    const tracker = createPositionTracker(
      layout,
      () =>
        ({
          enabled: true,
          getPageReadingAnchor,
          resolveLocator: vi.fn(),
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
      () => {
        expect(tracker.prepareLayoutCommit(undefined, 1)).toEqual({ kind: 'portable' });
        if (fixture.internals) fixture.internals.currentSpread = 1;
        return Promise.reject(failure);
      },
    );
    const internals = createInternals(tracker, { load: vi.fn(), save: vi.fn() });
    fixture.internals = internals;
    const jumpToSpread = vi.fn();
    const actions = buildPositionActions(internals, positionNav(jumpToSpread));

    await expect(actions.goToPosition(position(locator))).rejects.toBe(failure);
    await tracker.settle();

    expect(internals.currentSpread).toBe(1);
    expect(jumpToSpread).not.toHaveBeenCalled();
    expect(getPageReadingAnchor).toHaveBeenCalledWith(1);
    expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 1, spreadIndex: 1 });
  });

  it('serializes position writes so a slow old write cannot finish after a newer one', async () => {
    const first = deferred<undefined>();
    const save = vi
      .fn<(serialized: string) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => Promise.resolve());
    const persistence = createPositionPersistence({ load: vi.fn(), save, clear: vi.fn() });

    const oldWrite = persistence.save('old');
    const newWrite = persistence.save('new');
    await Promise.resolve();
    expect(save.mock.calls.map(([value]) => value)).toEqual(['old']);

    first.resolve(undefined);
    await Promise.all([oldWrite, newWrite]);
    expect(save.mock.calls.map(([value]) => value)).toEqual(['old', 'new']);
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

function positionNav(jumpToSpread = vi.fn(), supersedeForPositionIntent = vi.fn()) {
  return {
    jumpToSpread(index: number, preservePositionIntent?: boolean): boolean {
      jumpToSpread(index, preservePositionIntent);
      return true;
    },
    supersedeForPositionIntent,
  } as never;
}

function position(sourceLocator: ReaderLocator): ReadingPosition {
  return {
    sourceLocator,
    projection: { spreadIndex: 0, pageIndex: 0 },
    progress: 0,
    timestamp: 1,
  };
}

function resolvedPosition(pageIndex: number, spreadIndex: number) {
  return {
    status: 'resolved',
    locator,
    spineIdref: 'chapter',
    pageIndex,
    spreadIndex,
    matchedBy: 'sourcePoint',
  } as const;
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

function rightPageLayout(): PositionLayout {
  const base = layout();
  const extra = { index: 2, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: [] };
  const first = base.pages[0];
  const left = base.pages[1];
  if (!first || !left) throw new Error('right-page test layout is incomplete');
  return {
    ...base,
    pages: [...base.pages, extra],
    spreads: [
      { index: 0, left: first },
      { index: 1, left, right: extra },
    ],
  };
}

function singleSpreadLayout(): PositionLayout {
  const base = layout();
  const left = base.pages[0];
  const right = base.pages[1];
  if (!left || !right) throw new Error('single-spread test layout is incomplete');
  return { ...base, spreads: [{ index: 0, left, right }] };
}

function threeSpreadLayout(): PositionLayout {
  const base = layout();
  const extra = { index: 2, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: [] };
  const first = base.pages[0];
  const second = base.pages[1];
  if (!first || !second) throw new Error('three-spread test layout is incomplete');
  return {
    pages: [...base.pages, extra],
    spreads: [
      { index: 0, left: first },
      { index: 1, left: second },
      { index: 2, left: extra },
    ],
    chapterMap: new Map([['chapter', { startPage: 0, endPage: 2 }]]),
  };
}

function legacyPosition(spreadIndex: number): ReadingPosition {
  return {
    locator: { spineIdref: 'chapter', chapterProgress: spreadIndex },
    projection: { spreadIndex, pageIndex: spreadIndex },
    progress: spreadIndex,
    timestamp: 1,
  };
}

function legacyExactPosition(): ReadingPosition {
  return {
    ...legacyPosition(1),
    locator: {
      spineIdref: 'chapter',
      chapterProgress: 1,
      sourcePoint: { nodePath: [9, 4], textOffset: 17 },
    },
  };
}

function coordinatePosition(
  internals: Internals,
  tracker: ReturnType<typeof createPositionTracker>,
  positionLayout: PositionLayout,
  spreadIndex: number,
): void {
  const spread = positionLayout.spreads[spreadIndex];
  if (!spread) throw new Error('position test spread missing');
  coordinateOnSpreadRendered(
    spreadIndex,
    spread,
    { selection: { setSpread: vi.fn() }, search: {}, position: tracker } as never,
    {
      measurer: {},
      getChapterTextIndices: vi.fn(() => new Map()),
      getLayoutGeometry: vi.fn(() => ({
        viewportWidth: 300,
        viewportHeight: 400,
        marginLeft: 0,
        marginTop: 0,
        spreadGap: 0,
      })),
    } as never,
    internals.coordState,
    1,
  );
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
