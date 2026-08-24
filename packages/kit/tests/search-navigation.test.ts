import { describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderLocator, ReaderLocatorResolution, Spread } from '@ritojs/core';
import type { Internals } from '../src/controller/core/internals';
import type { SearchResult } from '../src/interaction/index';
import { createPositionTracker } from '../src/interaction/position/tracker';
import type { PositionLayout, ReadingPosition } from '../src/interaction/position/model';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import { buildPositionActions } from '../src/controller/facade/position-actions';
import { goToSearchResult, type SearchNavDeps } from '../src/controller/engines/search-navigation';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation/index';

describe('search navigation', () => {
  it('routes a ready far jump through the unified navigation owner', () => {
    const navGoToSpread = vi.fn();
    const jumpToSpreadIfReady = vi.fn(() => 'committed' as const);
    const reader = {
      findSpread: () => 4,
    } as unknown as Reader;
    const deps = {
      reader,
      nav: { goToSpread: navGoToSpread, jumpToSpreadIfReady },
      getCurrentSpread: () => 20,
    } as unknown as SearchNavDeps;

    goToSearchResult(createSearchResult(12), deps);

    expect(navGoToSpread).not.toHaveBeenCalled();
    expect(jumpToSpreadIfReady).toHaveBeenCalledWith(4);
  });

  it('falls back to deferred navigation when far-jump content is not ready', () => {
    const navGoToSpread = vi.fn();
    const jumpToSpreadIfReady = vi.fn(() => 'not-ready' as const);
    const reader = {
      findSpread: () => 4,
    } as unknown as Reader;
    const deps = {
      reader,
      nav: { goToSpread: navGoToSpread, jumpToSpreadIfReady },
      getCurrentSpread: () => 20,
    } as unknown as SearchNavDeps;

    goToSearchResult(createSearchResult(12), deps);

    expect(jumpToSpreadIfReady).toHaveBeenCalledWith(4);
    expect(navGoToSpread).toHaveBeenCalledWith(4);
  });

  it('does not overwrite a navigation that supersedes the ready-jump attempt', () => {
    const navGoToSpread = vi.fn();
    const jumpToSpreadIfReady = vi.fn(() => 'superseded' as const);
    const reader = { findSpread: () => 4 } as unknown as Reader;

    goToSearchResult(createSearchResult(12), {
      reader,
      nav: { goToSpread: navGoToSpread, jumpToSpreadIfReady },
      getCurrentSpread: () => 20,
    } as unknown as SearchNavDeps);

    expect(jumpToSpreadIfReady).toHaveBeenCalledWith(4);
    expect(navGoToSpread).not.toHaveBeenCalled();
  });

  it('does not let a late atomic position intent overwrite a ready far search jump', async () => {
    const atomic = deferred<ReaderLocatorResolution | undefined>();
    let atomicSignal: AbortSignal | undefined;
    const tracker = createPositionTracker(
      positionLayout,
      () => undefined,
      (_locator, signal) => {
        atomicSignal = signal;
        return atomic.promise;
      },
    );
    const notifyActiveSpread = vi.fn();
    const reader = createReader(notifyActiveSpread);
    const internals = {
      reader,
      currentSpread: 0,
      engines: { position: tracker },
      coordState: createCoordinatorState(),
      options: {},
    } as unknown as Internals;
    const pool = {
      jump: vi.fn(),
      ensureContent: vi.fn(() => true),
      getSlotFor: vi.fn(() => null),
      assignSlot: vi.fn(),
      rotateForward: vi.fn(),
      rotateBackward: vi.fn(),
    };
    let animating = false;
    const forceSettle = vi.fn(() => {
      expect(pool.jump).not.toHaveBeenCalled();
      expect(pool.assignSlot).not.toHaveBeenCalled();
      animating = false;
      return 0;
    });
    const nav = createNavigation({
      getReader: () => reader,
      getCurrentSpread: () => internals.currentSpread,
      setCurrentSpread: (index: number) => {
        internals.currentSpread = index;
      },
      emitter: { emit: vi.fn() },
      td: {
        get isAnimating() {
          return animating;
        },
        forceSettle,
      },
      frameDriver: { scheduleComposite: vi.fn() },
      pool,
      contentRenderer: vi.fn(),
      onNavigationIntent: () => {
        tracker.claimIntent();
      },
    } as unknown as NavigationDeps);
    const positionActions = buildPositionActions(internals, nav);
    const pendingPosition = positionActions.goToPosition(readingPosition());
    animating = true;

    goToSearchResult(createSearchResult(12), {
      reader,
      nav,
      getCurrentSpread: () => internals.currentSpread,
    } as unknown as SearchNavDeps);

    expect(internals.currentSpread).toBe(4);
    expect(atomicSignal?.aborted).toBe(true);
    expect(forceSettle).toHaveBeenCalledOnce();
    expect(pool.jump).not.toHaveBeenCalled();
    expect(pool.assignSlot).toHaveBeenCalledWith('next', 4);
    expect(pool.ensureContent).toHaveBeenCalledOnce();
    expect(pool.rotateForward).toHaveBeenCalledOnce();

    atomic.resolve(resolvedPosition());
    await expect(pendingPosition).resolves.toBeUndefined();
    expect(internals.currentSpread).toBe(4);
    expect(notifyActiveSpread).toHaveBeenCalledTimes(1);
    expect(notifyActiveSpread).toHaveBeenCalledWith(4);
  });

  it.each(['search', 'ordinary navigation'] as const)(
    'does not let a late atomic position intent overwrite same-current %s',
    async (operation) => {
      const atomic = deferred<ReaderLocatorResolution | undefined>();
      let atomicSignal: AbortSignal | undefined;
      const tracker = createPositionTracker(
        positionLayout,
        () => undefined,
        (_locator, signal) => {
          atomicSignal = signal;
          return atomic.promise;
        },
      );
      const notifyActiveSpread = vi.fn();
      const reader = createReader(notifyActiveSpread, 0);
      const internals = {
        reader,
        currentSpread: 0,
        engines: { position: tracker },
        coordState: createCoordinatorState(),
        options: {},
      } as unknown as Internals;
      const pool = {
        jump: vi.fn(),
        ensureContent: vi.fn(() => true),
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
      };
      const onNavigationCancelled = vi.fn(() => {
        tracker.update(internals.currentSpread);
      });
      const nav = createNavigation({
        getReader: () => reader,
        getCurrentSpread: () => internals.currentSpread,
        setCurrentSpread: (index: number) => {
          internals.currentSpread = index;
        },
        emitter: { emit: vi.fn() },
        td: { isAnimating: false },
        frameDriver: { scheduleComposite: vi.fn() },
        pool,
        contentRenderer: vi.fn(),
        onNavigationIntent: () => {
          tracker.claimIntent();
        },
        onNavigationCancelled,
      } as unknown as NavigationDeps);
      const pendingPosition = buildPositionActions(internals, nav).goToPosition(readingPosition());

      if (operation === 'search') {
        goToSearchResult(createSearchResult(0), {
          reader,
          nav,
          getCurrentSpread: () => internals.currentSpread,
        } as unknown as SearchNavDeps);
      } else {
        nav.goToSpread(0);
      }

      expect(atomicSignal?.aborted).toBe(true);
      expect(onNavigationCancelled).toHaveBeenCalledOnce();
      atomic.resolve(resolvedPosition());
      await expect(pendingPosition).resolves.toBeUndefined();
      expect(internals.currentSpread).toBe(0);
      expect(tracker.getCurrent()?.projection.spreadIndex).toBe(0);
      expect(pool.jump).not.toHaveBeenCalled();
      expect(pool.assignSlot).not.toHaveBeenCalled();
      expect(notifyActiveSpread).not.toHaveBeenCalled();
    },
  );
});

function createSearchResult(pageIndex: number): SearchResult {
  return {
    pageIndex,
    range: {} as SearchResult['range'],
    context: 'match',
  };
}

const sourceLocator: ReaderLocator = {
  href: 'chapter.xhtml',
  sourcePoint: { nodePath: [0], textOffset: 1 },
};

function readingPosition(): ReadingPosition {
  return {
    sourceLocator,
    projection: { spreadIndex: 0, pageIndex: 0 },
    progress: 0,
    timestamp: 1,
  };
}

function resolvedPosition(): ReaderLocatorResolution {
  return {
    status: 'resolved',
    locator: sourceLocator,
    spineIdref: 'chapter',
    pageIndex: 1,
    spreadIndex: 1,
    matchedBy: 'sourcePoint',
  };
}

function positionLayout(): PositionLayout {
  const pages = Array.from({ length: 5 }, (_, index) => ({
    index,
    bounds: { x: 0, y: 0, width: 300, height: 400 },
    content: [],
  }));
  return {
    pages,
    spreads: pages.map((page, index) => ({ index, left: page })),
    chapterMap: new Map([['chapter', { startPage: 0, endPage: 4 }]]),
  } as PositionLayout;
}

function createReader(notifyActiveSpread: (spreadIndex: number) => void, searchSpread = 4): Reader {
  const spreads = Array.from({ length: 5 }, (_, index) => ({ index })) as Spread[];
  return {
    totalSpreads: spreads.length,
    spreads,
    findSpread: vi.fn(() => searchSpread),
    notifyActiveSpread,
  } as unknown as Reader;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
