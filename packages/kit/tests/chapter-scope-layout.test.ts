import { describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderLocator } from '@ritojs/core';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import type { Internals } from '../src/controller/core/internals';
import { publishSpreadChange, publishedSpread } from '../src/controller/core/spread-change';
import { commitLayoutChange } from '../src/controller/facade/layout-actions';
import { buildReaderProxies } from '../src/controller/facade/reader-proxies';
import { buildSearchActions } from '../src/controller/facade/search-actions';
import type { Emitter, RuntimeComponents } from '../src/controller/facade/types';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';
import { wirePositionTracker } from '../src/controller/wiring/position';
import { createDisposableCollection } from '../src/utils/disposable';
import {
  createReadingPosition,
  projectReadingPosition,
  type PositionLayout,
  type ReadingPosition,
} from '../src/interaction/position/model';
import { createPositionTracker } from '../src/interaction/position/tracker';
import { createSearchEngine, type SearchResult } from '../src/interaction';

const locator: ReaderLocator = {
  href: 'chapter.xhtml',
  sourcePoint: { nodePath: [0, 1], textOffset: 12 },
};

/** A book of forty pages, and its third chapter laid out alone: pages 20..23 as 0..3. */
function bookLayout(): PositionLayout {
  return {
    scope: 'book',
    pageCount: 40,
    spreads: Array.from({ length: 40 }, (_, index) => ({
      index,
      pageIndexes: [index],
      leftPageIndex: index,
    })),
    chapterMap: new Map([['chapter', { startPage: 20, endPage: 23 }]]),
    manifestHrefMap: new Map([['chapter', 'chapter.xhtml']]),
  };
}

function chapterLayout(): PositionLayout {
  return {
    ...bookLayout(),
    scope: 'chapter',
    pageCount: 4,
    spreads: bookLayout().spreads.slice(0, 4),
    chapterMap: new Map([['chapter', { startPage: 0, endPage: 3 }]]),
  };
}

describe('reading position while a chapter is laid out alone', () => {
  it('keeps the progress the whole book last gave, never the page within the chapter', async () => {
    let current = bookLayout();
    const getPageReadingAnchor = vi.fn((pageIndex: number) =>
      Promise.resolve({ status: 'resolved', pageIndex, spreadIndex: pageIndex, locator }),
    );
    const tracker = createPositionTracker(
      () => current,
      () =>
        ({
          enabled: true,
          getPageReadingAnchor,
          resolveLocator: vi.fn(),
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
    );
    const published: ReadingPosition[] = [];
    tracker.onPositionChange((position) => published.push(position));

    tracker.update(22);
    await tracker.settle();
    expect(tracker.getCurrent()?.progress).toBe(22 / 40);

    // A new layout commits the chapter first: the same page is its page 2.
    current = chapterLayout();
    tracker.update(2);
    await tracker.settle();
    tracker.update(3);
    await tracker.settle();
    expect(published.slice(1).map((position) => position.progress)).toEqual([22 / 40, 22 / 40]);
    expect(tracker.getCurrent()?.projection).toEqual({ spreadIndex: 3, pageIndex: 3 });
    expect(tracker.getCurrent()?.sourceLocator).toEqual(locator);

    // The whole book follows and says where that page is.
    current = bookLayout();
    tracker.update(23);
    await tracker.settle();
    expect(tracker.getCurrent()?.progress).toBe(23 / 40);
  });

  it('carries progress through a projection and starts from zero when none is known', () => {
    const known: ReadingPosition = {
      projection: { spreadIndex: 22, pageIndex: 22 },
      progress: 0.55,
      timestamp: 1,
    };
    expect(projectReadingPosition(known, chapterLayout()).progress).toBe(0.55);
    expect(createReadingPosition(chapterLayout(), 2).progress).toBe(0);
    expect(createReadingPosition(chapterLayout(), 2, 0.55).progress).toBe(0.55);
    expect(createReadingPosition(bookLayout(), 20, 0.99).progress).toBe(0.5);
  });
});

interface Harness {
  readonly nav: ReturnType<typeof createNavigation>;
  readonly reader: { layoutScope: 'chapter' | 'book'; totalSpreads: number; spreads: object[] };
  readonly goToTarget: ReturnType<typeof vi.fn>;
  readonly onNavigationCancelled: ReturnType<typeof vi.fn>;
  readonly current: () => number;
  /** The whole book is committed: the chapter's spreads sit `offset` further on. */
  readonly commitBook: (offset: number, totalSpreads: number) => void;
}

function harness(currentSpread: number): Harness {
  let current = currentSpread;
  const goToTarget = vi.fn();
  const onNavigationCancelled = vi.fn();
  const reader = {
    layoutScope: 'chapter' as 'chapter' | 'book',
    totalSpreads: 4,
    spreads: [{}, {}, {}, {}] as object[],
    notifyActiveSpread: vi.fn(),
  };
  const deps = {
    getReader: () => reader as unknown as Reader,
    getCurrentSpread: () => current,
    setCurrentSpread: (index: number) => {
      current = index;
    },
    emitter: { emit: vi.fn() },
    td: { isAnimating: false, turning: false, handOver: vi.fn(), goToTarget },
    frameDriver: { scheduleComposite: vi.fn() },
    pool: {
      getSlotFor: vi.fn(() => null),
      assignSlot: vi.fn(),
      ensureContent: vi.fn(() => true),
      jump: vi.fn(),
    },
    contentRenderer: vi.fn(),
    onNavigationIntent: vi.fn(),
    onNavigationCancelled,
  } as unknown as NavigationDeps;
  const nav = createNavigation(deps);
  return {
    nav,
    reader,
    goToTarget,
    onNavigationCancelled,
    current: () => current,
    commitBook: (offset, totalSpreads) => {
      reader.layoutScope = 'book';
      reader.totalSpreads = totalSpreads;
      reader.spreads = Array.from({ length: totalSpreads }, () => ({}));
      current += offset;
      nav.notifyLayoutCommitted();
    },
  };
}

describe('a turn past the chapter laid out alone', () => {
  it('waits for the whole book and then turns from where the reader is', () => {
    const { nav, goToTarget, current, commitBook, onNavigationCancelled } = harness(3);

    nav.nextSpread('keyboard');
    // Not the end of the book: nothing moves, and nothing reports a dead end.
    expect(goToTarget).not.toHaveBeenCalled();
    expect(onNavigationCancelled).not.toHaveBeenCalled();
    expect(current()).toBe(3);

    commitBook(20, 40);
    expect(goToTarget).toHaveBeenCalledOnce();
    expect(goToTarget).toHaveBeenCalledWith('forward', 23, 24);
    expect(current()).toBe(24);
  });

  it('adds up the turns made while waiting, in either direction', () => {
    const forward = harness(3);
    forward.nav.nextSpread();
    forward.nav.nextSpread();
    forward.commitBook(20, 40);
    expect(forward.current()).toBe(25);

    const backward = harness(0);
    backward.nav.prevSpread();
    backward.commitBook(20, 40);
    expect(backward.goToTarget).toHaveBeenCalledWith('backward', 20, 19);
  });

  it('is undone by a turn back, and replaced by a turn to a spread named outright', () => {
    const undone = harness(3);
    undone.nav.nextSpread();
    undone.nav.prevSpread();
    // Forward one and back one is where the reader already is.
    expect(undone.current()).toBe(3);
    undone.commitBook(20, 40);
    expect(undone.goToTarget).not.toHaveBeenCalled();
    expect(undone.current()).toBe(23);

    const replaced = harness(3);
    replaced.nav.nextSpread();
    replaced.nav.goToSpread(1);
    expect(replaced.current()).toBe(1);
    replaced.goToTarget.mockClear();
    replaced.commitBook(20, 40);
    expect(replaced.goToTarget).not.toHaveBeenCalled();
    expect(replaced.current()).toBe(21);
  });

  it('stays waiting through a commit that is still one chapter', () => {
    const { nav, goToTarget, commitBook } = harness(3);

    nav.nextSpread();
    nav.notifyLayoutCommitted();
    expect(goToTarget).not.toHaveBeenCalled();
    commitBook(20, 40);
    expect(goToTarget).toHaveBeenCalledOnce();
  });

  it('tells a drag there is nothing to pull into view yet', () => {
    const { nav, goToTarget, commitBook } = harness(3);
    const onUnavailable = vi.fn();

    nav.startGestureNavigation(4, vi.fn(), onUnavailable);
    expect(onUnavailable).toHaveBeenCalledOnce();
    commitBook(20, 40);
    expect(goToTarget).not.toHaveBeenCalled();
  });

  it('is the end of the book once the whole book is laid out', () => {
    const { nav, goToTarget, reader, onNavigationCancelled } = harness(3);
    reader.layoutScope = 'book';

    nav.nextSpread();
    expect(onNavigationCancelled).toHaveBeenCalledOnce();
    nav.notifyLayoutCommitted();
    expect(goToTarget).not.toHaveBeenCalled();
  });
});

describe('what a host is told while a chapter is laid out alone', () => {
  it('holds spread, layout and position events until the whole book is committed', () => {
    const { internals, runtime, emitter, events, reader } = controllerHarness();

    // The book, the reader on spread 22.
    internals.currentSpread = 22;
    commitLayoutChange(internals, emitter, runtime, undefined, 22);
    expect(events.map((event) => event.name)).toEqual(['layoutChange']);
    publishSpreadChange(emitter, reader as never, 22);
    events.length = 0;

    // A new layout commits the chapter first: the same page is its spread 2.
    Object.assign(reader, chapterReader());
    commitLayoutChange(internals, emitter, runtime, undefined, 2);
    expect(publishSpreadChange(emitter, reader as never, 3)).toBe(false);
    expect(events).toEqual([]);
    expect(publishedSpread(emitter)).toBe(22);

    // The whole book follows, the reader one page on: hosts hear both at once.
    Object.assign(reader, bookReader());
    commitLayoutChange(internals, emitter, runtime, undefined, 23);
    expect(events).toEqual([
      { name: 'layoutChange', data: { spreads: reader.spreads, totalSpreads: 40 } },
      { name: 'spreadChange', data: { spreadIndex: 23, spread: reader.spreads[23] } },
    ]);
  });

  it('searches again once the whole book replaces the layout the results were found in', async () => {
    const { internals, runtime, emitter, reader } = controllerHarness();
    const found = (pageIndex: number): SearchResult => ({
      pageIndex,
      range: {
        start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
        end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 4 },
      },
      context: 'snow',
    });
    let page = 30;
    const search = vi.fn(() => Promise.resolve([found(page)]));
    Object.assign(reader, { search });
    Object.assign(internals.engines, { search: createSearchEngine() });
    const actions = buildSearchActions(internals, emitter, {} as never, runtime);
    const settle = async (): Promise<void> => {
      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
    };

    actions.search('snow');
    await settle();
    expect(actions.searchResults).toEqual([found(30)]);
    expect(internals.coordState.searchResults.stale).toBe(false);

    // A larger font: the chapter commits first, and the old pages are stale.
    page = 37;
    Object.assign(reader, chapterReader());
    commitLayoutChange(internals, emitter, runtime, undefined, 2);
    await settle();
    expect(search).toHaveBeenCalledOnce();
    expect(internals.coordState.searchResults.stale).toBe(true);

    Object.assign(reader, bookReader());
    commitLayoutChange(internals, emitter, runtime, undefined, 22);
    await settle();
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith('snow', undefined);
    expect(actions.searchResults).toEqual([found(37)]);
    expect(internals.coordState.searchResults.stale).toBe(false);

    // A cleared search has nothing to run again.
    actions.clearSearch();
    commitLayoutChange(internals, emitter, runtime, undefined, 22);
    await settle();
    expect(search).toHaveBeenCalledTimes(2);
    expect(internals.coordState.searchResults.stale).toBe(false);
  });

  it('says nothing new when the book commits the spread hosts already know', () => {
    const { internals, runtime, emitter, events, reader } = controllerHarness();
    internals.currentSpread = 22;
    publishSpreadChange(emitter, reader as never, 22);
    Object.assign(reader, chapterReader());
    commitLayoutChange(internals, emitter, runtime, undefined, 2);
    events.length = 0;

    Object.assign(reader, bookReader());
    commitLayoutChange(internals, emitter, runtime, undefined, 22);
    expect(events.map((event) => event.name)).toEqual(['layoutChange']);
  });

  it('reads back book-wide numbers only', () => {
    const { internals, runtime, emitter, reader } = controllerHarness();
    const proxies = buildReaderProxies(internals, emitter);
    Object.assign(reader, chapterReader());
    internals.currentSpread = 2;

    // Before any book layout there is nothing to say.
    expect([proxies.currentSpread, proxies.totalSpreads, proxies.spreads]).toEqual([0, 0, []]);

    Object.assign(reader, bookReader());
    internals.currentSpread = 22;
    commitLayoutChange(internals, emitter, runtime, undefined, 22);
    publishSpreadChange(emitter, reader as never, 22);
    expect([proxies.currentSpread, proxies.totalSpreads]).toEqual([22, 40]);

    Object.assign(reader, chapterReader());
    commitLayoutChange(internals, emitter, runtime, undefined, 3);
    expect(internals.currentSpread).toBe(3);
    expect([proxies.currentSpread, proxies.totalSpreads]).toEqual([22, 40]);
    expect(proxies.spreads).toHaveLength(40);
  });

  it('publishes a position only against the whole book', () => {
    const listeners: ((position: ReadingPosition) => void)[] = [];
    const { emitter, events, reader, internals } = controllerHarness();
    const save = vi.fn(() => Promise.resolve());
    wirePositionTracker(
      {
        reader,
        coordState: internals.coordState,
        emitter,
        engines: {
          position: {
            onPositionChange: (listener: (position: ReadingPosition) => void) => {
              listeners.push(listener);
              return () => undefined;
            },
            serialize: () => 'serialized',
          },
        },
        hasRestored: () => true,
        positionPersistence: { save },
      } as never,
      createDisposableCollection(),
    );
    const position = (pageIndex: number): ReadingPosition => ({
      projection: { spreadIndex: pageIndex, pageIndex },
      progress: 0.55,
      timestamp: 1,
    });

    Object.assign(reader, chapterReader());
    listeners[0]?.(position(2));
    expect(events).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(internals.coordState.publishedPosition).toBeNull();

    Object.assign(reader, bookReader());
    listeners[0]?.(position(22));
    expect(events).toEqual([{ name: 'positionChange', data: { position: position(22) } }]);
    expect(save).toHaveBeenCalledOnce();
    expect(internals.coordState.publishedPosition).toEqual(position(22));
  });
});

describe('a spread a host names by its book-wide index', () => {
  it('is reached at once when the whole book is laid out', () => {
    const { nav, reader, goToTarget, current } = harness(3);
    reader.layoutScope = 'book';

    nav.goToBookSpread(1, 'turn');
    expect(goToTarget).toHaveBeenCalledWith('backward', 3, 1);
    expect(current()).toBe(1);
  });

  it('waits for the whole book, where the index means what the host meant', () => {
    const turned = harness(3);
    turned.nav.goToBookSpread(30, 'turn');
    expect(turned.goToTarget).not.toHaveBeenCalled();
    expect(turned.current()).toBe(3);
    turned.commitBook(20, 40);
    expect(turned.goToTarget).toHaveBeenCalledWith('forward', 23, 30);

    // The last spread is read when the book is there to count.
    const last = harness(3);
    last.nav.goToBookSpread(() => last.reader.totalSpreads - 1, 'turn', 'keyboard');
    last.commitBook(20, 40);
    expect(last.current()).toBe(39);

    const jumped = harness(3);
    jumped.nav.goToBookSpread(12, 'jump');
    jumped.commitBook(20, 40);
    expect(jumped.current()).toBe(12);
    expect(jumped.goToTarget).not.toHaveBeenCalled();
  });

  it('gives way to whatever the reader does next', () => {
    const { nav, goToTarget, current, commitBook } = harness(3);

    nav.goToBookSpread(30, 'turn');
    nav.prevSpread();
    expect(current()).toBe(2);
    goToTarget.mockClear();
    commitBook(20, 40);
    expect(goToTarget).not.toHaveBeenCalled();
  });
});

function bookReader() {
  const spreads = Array.from({ length: 40 }, (_, index) => ({ index }));
  return { layoutScope: 'book', totalSpreads: 40, spreads };
}

function chapterReader() {
  const spreads = Array.from({ length: 4 }, (_, index) => ({ index }));
  return { layoutScope: 'chapter', totalSpreads: 4, spreads };
}

function controllerHarness() {
  const events: { name: string; data: unknown }[] = [];
  // Every layout commit also clears the annotation hover; that is not what
  // these tests watch.
  const emitter = {
    emit: (name: string, data: unknown) => {
      if (name !== 'annotationHover') events.push({ name, data });
    },
  } as unknown as Emitter;
  const reader = {
    ...bookReader(),
    chapterMap: new Map(),
    manifestHrefMap: new Map(),
    dpr: 2,
    getCanvasSize: () => ({ width: 800, height: 600 }),
    getLayoutGeometry: () => ({ spreadMode: 'single' }),
    notifyActiveSpread: vi.fn(),
  };
  const internals = {
    reader,
    currentSpread: 0,
    renderScale: 1,
    options: {},
    engines: {
      selection: { invalidate: vi.fn(), getState: () => 'idle' },
      search: {},
      position: {
        prepareLayoutCommit: () => ({ kind: 'portable' }),
        getPreservableCurrent: () => null,
      },
    },
    coordState: createCoordinatorState(),
  } as unknown as Internals;
  const runtime = {
    surface: { setSize: vi.fn() },
    pool: { resize: vi.fn(), invalidateAllContent: vi.fn(), assignSlot: vi.fn() },
    td: { reset: vi.fn(), viewportWidth: 0, isAnimating: false },
    frameDriver: { scheduleComposite: vi.fn(), compositeNow: vi.fn() },
  } as unknown as RuntimeComponents;
  return { internals, runtime, emitter, events, reader };
}
