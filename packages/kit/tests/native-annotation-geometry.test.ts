import { describe, expect, it, vi } from 'vitest';
import type {
  Reader,
  ReaderExactSourceRangeResolution,
  ReaderInteractions,
  Spread,
} from '@ritojs/core';
import {
  invalidateNativeAnnotationGeometry,
  refreshNativeAnnotations,
  scheduleNativeAnnotationsForSpread,
} from '../src/controller/annotation-resolution';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import { createAnnotationStore, type AnnotationTarget } from '../src/interaction';
import { deferred, resolvedRange, settle } from './helpers/native-annotation';

describe('native annotation geometry', () => {
  it('coalesces one exact source request and installs page-content segments atomically', async () => {
    const pending = deferred<ReaderExactSourceRangeResolution | undefined>();
    const fixture = createFixture(vi.fn(() => pending.promise));
    const updated = vi.fn();

    schedule(fixture, updated);
    schedule(fixture, updated);
    await settle();

    expect(fixture.locate).toHaveBeenCalledTimes(1);
    expect(fixture.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.resolve).toHaveBeenCalledWith({
      href: 'chapter.xhtml',
      sourceRange: {
        start: { nodePath: [0], textOffset: 1 },
        end: { nodePath: [0], textOffset: 4 },
      },
    });

    pending.resolve(resolvedRange());
    await settle();

    expect(updated).toHaveBeenCalledTimes(1);
    expect(fixture.state.resolvedAnnotations).toMatchObject([
      {
        id: fixture.recordId,
        status: 'exact',
        segments: [
          {
            pageIndex: 0,
            rects: [{ x: 10, y: 20, width: 30, height: 12 }],
          },
          {
            pageIndex: 1,
            rects: [{ x: 5, y: 8, width: 9, height: 12 }],
          },
        ],
      },
    ]);
  });

  it('does not let an obsolete completion install or delete the replacement task', async () => {
    const first = deferred<ReaderExactSourceRangeResolution | undefined>();
    const second = deferred<ReaderExactSourceRangeResolution | undefined>();
    const fixture = createFixture(
      vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    );
    const updated = vi.fn();

    schedule(fixture, updated);
    await settle();
    invalidateNativeAnnotationGeometry(fixture.state);
    schedule(fixture, updated);
    first.resolve(resolvedRange());
    await settle();

    expect(fixture.state.resolvedAnnotations).toEqual([]);
    expect(fixture.state.nativeAnnotationGeometry.pending.size).toBe(1);

    second.resolve(resolvedRange());
    await settle();
    expect(fixture.state.resolvedAnnotations).toHaveLength(1);
    expect(updated).toHaveBeenCalledTimes(1);
  });

  it('negative-caches pending until revision invalidation allows a resolved retry', async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce({ status: 'pending', reason: 'notPaginated' })
      .mockResolvedValueOnce(resolvedRange());
    const fixture = createFixture(resolve);
    const updated = vi.fn();
    const error = vi.fn();

    scheduleNativeAnnotationsForSpread(
      fixture.spread,
      fixture.reader,
      fixture.state,
      updated,
      error,
    );
    await settle();
    scheduleNativeAnnotationsForSpread(
      fixture.spread,
      fixture.reader,
      fixture.state,
      updated,
      error,
    );
    await settle();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fixture.state.nativeAnnotationGeometry.misses.size).toBe(1);

    invalidateNativeAnnotationGeometry(fixture.state);
    scheduleNativeAnnotationsForSpread(
      fixture.spread,
      fixture.reader,
      fixture.state,
      updated,
      error,
    );
    await settle();

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(fixture.state.resolvedAnnotations).toHaveLength(1);
    expect(fixture.state.nativeAnnotationGeometry.cache.size).toBe(1);
    expect(updated).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('negative-caches unavailable geometry within the current revision', async () => {
    const resolve = vi.fn(() =>
      Promise.resolve({ status: 'unavailable' as const, reason: 'shapeUnavailable' as const }),
    );
    const fixture = createFixture(resolve);

    schedule(fixture, vi.fn());
    await settle();
    schedule(fixture, vi.fn());
    await settle();

    expect(resolve).toHaveBeenCalledOnce();
    expect(fixture.state.nativeAnnotationGeometry.misses.size).toBe(1);
  });

  it('prunes cached, negative, and real pending geometry after its source is removed', async () => {
    const pending = deferred<ReaderExactSourceRangeResolution | undefined>();
    const fixture = createFixture(vi.fn(() => pending.promise));
    const updated = vi.fn();
    schedule(fixture, updated);
    await settle();
    fixture.state.nativeAnnotationGeometry.cache.set('stale-cache', resolvedRange().range);
    fixture.state.nativeAnnotationGeometry.misses.add('stale-miss');

    expect(fixture.state.nativeAnnotationGeometry.pending.size).toBe(1);
    fixture.store.remove(fixture.recordId);
    refreshNativeAnnotations(fixture.reader, fixture.state);

    expect(fixture.state.nativeAnnotationGeometry.cache.size).toBe(0);
    expect(fixture.state.nativeAnnotationGeometry.misses.size).toBe(0);
    expect(fixture.state.nativeAnnotationGeometry.pending.size).toBe(0);
    pending.resolve(resolvedRange());
    await settle();
    expect(fixture.state.resolvedAnnotations).toEqual([]);
    expect(updated).not.toHaveBeenCalled();
  });

  it('reuses geometry for record-only updates without another native read', async () => {
    const fixture = createFixture(vi.fn(() => Promise.resolve(resolvedRange())));
    schedule(fixture, vi.fn());
    await settle();

    fixture.store.update(fixture.recordId, { color: '#123456' });
    refreshNativeAnnotations(fixture.reader, fixture.state);
    schedule(fixture, vi.fn());
    await settle();

    expect(fixture.locate).toHaveBeenCalledTimes(1);
    expect(fixture.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.state.resolvedAnnotations[0]?.record.color).toBe('#123456');
  });

  it('keeps a canonical href distinct from a colliding spine idref', async () => {
    const fixture = createFixture(vi.fn(() => Promise.resolve(resolvedRange())));
    (fixture.reader.chapterMap as Map<string, { startPage: number; endPage: number }>).set(
      'chapter.xhtml',
      { startPage: 2, endPage: 3 },
    );
    (fixture.reader.manifestHrefMap as Map<string, string>).set('chapter.xhtml', 'other.xhtml');

    schedule(fixture, vi.fn());
    await settle();

    expect(fixture.resolve).toHaveBeenCalledOnce();
    expect(fixture.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'chapter.xhtml' }),
    );
  });

  it('fails closed while interactions are disabled after preview invalidation', async () => {
    const fixture = createFixture(vi.fn(() => Promise.resolve(resolvedRange())));
    schedule(fixture, vi.fn());
    await settle();
    expect(fixture.state.resolvedAnnotations).toHaveLength(1);

    Object.defineProperty(fixture.interactions, 'enabled', { configurable: true, value: false });
    invalidateNativeAnnotationGeometry(fixture.state);
    refreshNativeAnnotations(fixture.reader, fixture.state);
    schedule(fixture, vi.fn());
    await settle();

    expect(fixture.state.resolvedAnnotations).toEqual([]);
    expect(fixture.resolve).toHaveBeenCalledOnce();
  });

  it('reports a current native failure without retaining partial geometry', async () => {
    const failure = new Error('native projection failed');
    const fixture = createFixture(vi.fn(() => Promise.reject(failure)));
    const updated = vi.fn();
    const error = vi.fn();

    scheduleNativeAnnotationsForSpread(
      fixture.spread,
      fixture.reader,
      fixture.state,
      updated,
      error,
    );
    await settle();

    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(failure);
    expect(updated).not.toHaveBeenCalled();
    expect(fixture.state.resolvedAnnotations).toEqual([]);
    expect(fixture.state.nativeAnnotationGeometry.cache.size).toBe(0);
  });
});

describe('engine target resolution', () => {
  it('projects the re-anchored range and reports the level that found it', async () => {
    const resolve = vi.fn(() => Promise.resolve(resolvedRange()));
    const locate = vi.fn((target: AnnotationTarget) =>
      Promise.resolve({
        level: 'quote' as const,
        target: {
          ...target,
          sourceRange: {
            start: { nodePath: [2], textOffset: 0 },
            end: { nodePath: [2], textOffset: 3 },
          },
        },
      }),
    );
    const fixture = createFixture(resolve, locate);

    schedule(fixture, vi.fn());
    await settle();

    expect(resolve).toHaveBeenCalledWith({
      href: 'chapter.xhtml',
      sourceRange: {
        start: { nodePath: [2], textOffset: 0 },
        end: { nodePath: [2], textOffset: 3 },
      },
    });
    expect(fixture.state.resolvedAnnotations).toMatchObject([{ status: 'quote' }]);
  });

  it('shows an orphaned target without asking for geometry', async () => {
    const resolve = vi.fn();
    const locate = vi.fn(() =>
      Promise.resolve({ level: 'orphaned' as const, reason: 'hrefNotFound' as const }),
    );
    const fixture = createFixture(resolve, locate);
    const updated = vi.fn();

    schedule(fixture, updated);
    await settle();

    expect(resolve).not.toHaveBeenCalled();
    expect(updated).toHaveBeenCalledOnce();
    expect(fixture.state.resolvedAnnotations).toMatchObject([
      { id: fixture.recordId, status: 'orphaned', segments: [] },
    ]);
  });

  it('keeps a target location across a relayout and only re-projects it', async () => {
    const fixture = createFixture(vi.fn(() => Promise.resolve(resolvedRange())));
    schedule(fixture, vi.fn());
    await settle();

    invalidateNativeAnnotationGeometry(fixture.state);
    schedule(fixture, vi.fn());
    await settle();

    expect(fixture.locate).toHaveBeenCalledOnce();
    expect(fixture.resolve).toHaveBeenCalledTimes(2);
  });
});

function createFixture(
  resolve: ReturnType<typeof vi.fn>,
  locate: NonNullable<ReaderInteractions['resolveAnnotationTarget']> = vi.fn(
    (target: AnnotationTarget) => Promise.resolve({ level: 'exact' as const, target }),
  ),
) {
  const state = createCoordinatorState();
  const store = createAnnotationStore();
  state.annotationStore = store;
  const target: AnnotationTarget = {
    version: 1,
    href: 'chapter.xhtml',
    sourceRange: {
      start: { nodePath: [0], textOffset: 1 },
      end: { nodePath: [0], textOffset: 4 },
    },
    quote: { exact: 'bcd', prefix: 'a', suffix: 'ef' },
    position: { start: 1, end: 4, chapterLength: 6 },
  };
  const recordId = store.add({ kind: 'highlight', target }).id;
  const interactions: ReaderInteractions = {
    enabled: true,
    resolveExactSourceRange: resolve as NonNullable<ReaderInteractions['resolveExactSourceRange']>,
    resolveAnnotationTarget: locate,
    getPageTargets: () => Promise.resolve(undefined),
    getFootnote: () => Promise.resolve(undefined),
    resolveLocator: () => Promise.resolve(undefined),
  };
  const spread: Spread = { index: 0, pageIndexes: [0, 1], leftPageIndex: 0, rightPageIndex: 1 };
  const reader = {
    interactions,
    chapterMap: new Map([['chapter-item', { startPage: 0, endPage: 1 }]]),
    manifestHrefMap: new Map([['chapter-item', 'chapter.xhtml']]),
  } as unknown as Reader;
  return { interactions, locate, reader, recordId, resolve, spread, state, store };
}

function schedule(fixture: ReturnType<typeof createFixture>, updated: () => void): void {
  scheduleNativeAnnotationsForSpread(
    fixture.spread,
    fixture.reader,
    fixture.state,
    updated,
    (error) => {
      throw error;
    },
  );
}
