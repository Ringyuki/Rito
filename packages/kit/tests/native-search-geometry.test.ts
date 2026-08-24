import { describe, expect, it, vi } from 'vitest';
import type {
  Reader,
  ReaderExactSourceRangeResolution,
  ReaderInteractions,
  Spread,
} from '@ritojs/core';
import { createCoordinatorState, type CoordinatorEngines } from '../src/controller/core';
import type { WiringDeps } from '../src/controller/core/wiring-deps';
import type { CoordinateMapper } from '../src/controller/geometry/coordinate-mapper';
import { buildOverlayData } from '../src/controller/overlay/projection';
import {
  collectNativeSearchGeometry,
  disposeNativeSearchGeometry,
  invalidateNativeSearchLayout,
  replaceNativeSearchResults,
  scheduleNativeSearchGeometryForSpread,
} from '../src/controller/search-resolution';
import { scheduleNativeSearchForSpread } from '../src/controller/wiring/native-search';
import type { SearchResult } from '../src/interaction';

const spread = createSpread(0, 0, 1);

describe('native search geometry', () => {
  it('resolves only visible durable results and dirties overlays after exact rects install', async () => {
    const pending = deferred<ReaderExactSourceRangeResolution | undefined>();
    const visible = nativeResult('visible', 0);
    const unavailable = unavailableResult('unavailable', 1);
    const offscreen = nativeResult('offscreen', 2);
    const fixture = createFixture(
      vi.fn(() => pending.promise),
      [visible, unavailable, offscreen],
    );
    const markAllOverlaysDirty = vi.fn();
    const deps = {
      reader: fixture.reader,
      coordState: fixture.state,
      engines: { search: { getResults: () => fixture.results } },
      frameDriver: { markAllOverlaysDirty },
      emitter: { emit: vi.fn() },
    } as unknown as WiringDeps;

    scheduleNativeSearchForSpread(spread, deps);
    scheduleNativeSearchForSpread(spread, deps);

    expect(fixture.resolve).toHaveBeenCalledOnce();
    expect(fixture.resolve).toHaveBeenCalledWith({
      href: 'visible.xhtml',
      sourceRange: visible.source?.status === 'resolved' ? visible.source.sourceRange : undefined,
    });
    expect(fixture.state.nativeSearchGeometry.misses.has(unavailable)).toBe(true);
    expect(fixture.state.nativeSearchGeometry.misses.has(offscreen)).toBe(false);

    pending.resolve(resolvedGeometry(0, 0, 10));
    await settle();

    const geometry = collectNativeSearchGeometry(spread, fixture.results, 0, fixture.state);
    expect(geometry.matches).toEqual([
      { pageIndex: 0, spreadIndex: 0, x: 10, y: 20, width: 30, height: 12 },
    ]);
    expect(geometry.active).toEqual(geometry.matches);
    expect(markAllOverlaysDirty).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 'pending' as const, reason: 'notPaginated' as const },
    { status: 'unavailable' as const, reason: 'shapeUnavailable' as const },
  ])('negative-caches typed $status without a legacy fallback', async (resolution) => {
    const result = nativeResult('match', 0);
    const fixture = createFixture(
      vi.fn(() => Promise.resolve(resolution)),
      [result],
    );
    const updated = vi.fn();

    schedule(fixture, spread, updated);
    await settle();
    schedule(fixture, spread, updated);

    expect(fixture.resolve).toHaveBeenCalledOnce();
    expect(fixture.state.nativeSearchGeometry.misses.has(result)).toBe(true);
    expect(fixture.state.nativeSearchGeometry.cache.size).toBe(0);
    expect(updated).not.toHaveBeenCalled();
  });

  it('keeps pending geometry across active changes and paints the latest active result', async () => {
    const first = deferred<ReaderExactSourceRangeResolution | undefined>();
    const second = deferred<ReaderExactSourceRangeResolution | undefined>();
    const results = [nativeResult('first', 0), nativeResult('second', 1)];
    const fixture = createFixture(
      vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      results,
    );

    schedule(fixture, spread, vi.fn());
    schedule(fixture, spread, vi.fn());
    expect(fixture.resolve).toHaveBeenCalledTimes(2);

    first.resolve(resolvedGeometry(0, 0, 10));
    second.resolve(resolvedGeometry(1, 0, 50));
    await settle();

    const geometry = collectNativeSearchGeometry(spread, fixture.results, 1, fixture.state);
    expect(geometry.matches.map((rect) => rect.x)).toEqual([10, 50]);
    expect(geometry.active.map((rect) => rect.x)).toEqual([50]);
  });

  it.each(['results', 'spread', 'layout', 'dispose'] as const)(
    'rejects a late exact result after the %s owner changes',
    async (change) => {
      const pending = deferred<ReaderExactSourceRangeResolution | undefined>();
      const result = nativeResult('match', 0);
      const fixture = createFixture(
        vi.fn(() => pending.promise),
        [result],
      );
      const updated = vi.fn();
      schedule(fixture, spread, updated);

      if (change === 'results') {
        replaceNativeSearchResults(fixture.state, [nativeResult('replacement', 0)]);
      } else if (change === 'spread') {
        schedule(fixture, createSpread(1, 2), updated);
      } else if (change === 'layout') {
        invalidateNativeSearchLayout(fixture.state);
      } else {
        disposeNativeSearchGeometry(fixture.state);
      }

      pending.resolve(resolvedGeometry(0, 0, 10));
      await settle();

      expect(fixture.state.nativeSearchGeometry.cache.size).toBe(0);
      expect(updated).not.toHaveBeenCalled();
    },
  );

  it('contains synchronous exact-read and consumer error-reporting failures', async () => {
    const failure = new Error('exact read failed');
    const sync = createFixture(
      vi.fn(() => {
        throw failure;
      }),
      [nativeResult('sync', 0)],
    );
    expect(() => {
      scheduleNativeSearchGeometryForSpread(spread, sync.reader, sync.state, vi.fn(), () => {
        throw new Error('reporting failed');
      });
    }).not.toThrow();

    const async = createFixture(
      vi.fn(() => Promise.reject(failure)),
      [nativeResult('async', 0)],
    );
    scheduleNativeSearchGeometryForSpread(spread, async.reader, async.state, vi.fn(), () => {
      throw new Error('reporting failed');
    });
    await settle();
    expect(async.state.nativeSearchGeometry.cache.size).toBe(0);
  });

  it('never asks the legacy HitMap path for native source-unavailable results', () => {
    const result = unavailableResult('missing', 0);
    const fixture = createFixture(vi.fn(), [result]);
    const getHighlightRects = vi.fn(() => [{ x: 1, y: 2, width: 3, height: 4 }]);
    const engines = {
      selection: { getRects: () => [] },
      search: {
        getResults: () => fixture.results,
        getActiveIndex: () => 0,
        getHighlightRects,
      },
      position: null,
    } as unknown as CoordinatorEngines;
    const mapper = {
      spreadContentRectToViewport: (rect: unknown) => rect,
      pageContentToViewport: (_pageIndex: number, rect: unknown) => rect,
    } as unknown as CoordinateMapper;

    const overlay = buildOverlayData(spread, engines, fixture.reader, fixture.state, mapper);

    expect(getHighlightRects).not.toHaveBeenCalled();
    expect(overlay.searchRects).toEqual([]);
    expect(overlay.activeSearchRects).toEqual([]);
  });
});

function createFixture(resolve: ReturnType<typeof vi.fn>, results: readonly SearchResult[]) {
  const state = createCoordinatorState();
  replaceNativeSearchResults(state, results);
  const interactions: ReaderInteractions = {
    enabled: true,
    resolveExactSourceRange: resolve as NonNullable<ReaderInteractions['resolveExactSourceRange']>,
    getPageTargets: vi.fn(),
    getFootnote: vi.fn(),
    resolveLocator: vi.fn(),
  };
  const reader = { interactions, measurer: {} } as unknown as Reader;
  return { interactions, reader, resolve, results, state };
}

function schedule(
  fixture: ReturnType<typeof createFixture>,
  targetSpread: Spread,
  updated: () => void,
): void {
  scheduleNativeSearchGeometryForSpread(
    targetSpread,
    fixture.reader,
    fixture.state,
    updated,
    (error) => {
      throw error;
    },
  );
}

function nativeResult(id: string, pageIndex: number): SearchResult {
  return {
    pageIndex,
    range: legacyRange(),
    context: id,
    source: {
      status: 'resolved',
      href: `${id}.xhtml`,
      sourceRange: {
        start: { nodePath: [0], textOffset: 1 },
        end: { nodePath: [0], textOffset: 4 },
      },
    },
  };
}

function unavailableResult(id: string, pageIndex: number): SearchResult {
  return {
    pageIndex,
    range: legacyRange(),
    context: id,
    source: { status: 'unavailable', reason: 'sourceUnavailable' },
  };
}

function legacyRange(): SearchResult['range'] {
  const position = { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 };
  return { start: position, end: { ...position, charIndex: 1 } };
}

function resolvedGeometry(
  pageIndex: number,
  spreadIndex: number,
  x: number,
): ReaderExactSourceRangeResolution {
  return {
    status: 'resolved',
    range: {
      selectedText: 'match',
      sourceLocator: { href: 'match.xhtml' },
      rects: [{ pageIndex, spreadIndex, x, y: 20, width: 30, height: 12 }],
    },
  };
}

function createSpread(index: number, left: number, right?: number): Spread {
  const bounds = { x: 0, y: 0, width: 300, height: 400 };
  return {
    index,
    left: { index: left, bounds, content: [] },
    ...(right === undefined ? {} : { right: { index: right, bounds, content: [] } }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
