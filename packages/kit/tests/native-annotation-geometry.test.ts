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
            range: null,
            rects: [{ x: 10, y: 20, width: 30, height: 12 }],
          },
          {
            pageIndex: 1,
            range: null,
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

    expect(resolve).toHaveBeenCalledOnce();
    expect(fixture.state.nativeAnnotationGeometry.misses.size).toBe(1);
  });

  it('prunes cached, negative, and real pending geometry after its source is removed', async () => {
    const pending = deferred<ReaderExactSourceRangeResolution | undefined>();
    const fixture = createFixture(vi.fn(() => pending.promise));
    const updated = vi.fn();
    schedule(fixture, updated);
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

    expect(fixture.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.state.resolvedAnnotations[0]?.record.color).toBe('#123456');
  });

  it('keeps a canonical href distinct from a colliding spine idref', () => {
    const fixture = createFixture(vi.fn(() => Promise.resolve(resolvedRange())));
    (fixture.reader.chapterMap as Map<string, { startPage: number; endPage: number }>).set(
      'chapter.xhtml',
      { startPage: 2, endPage: 3 },
    );
    (fixture.reader.manifestHrefMap as Map<string, string>).set('chapter.xhtml', 'other.xhtml');

    schedule(fixture, vi.fn());

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

function createFixture(resolve: ReturnType<typeof vi.fn>) {
  const state = createCoordinatorState();
  const store = createAnnotationStore();
  state.annotationStore = store;
  state.chapterIndices.set('chapter.xhtml', {
    href: 'chapter.xhtml',
    normalizedText: 'abcdef',
    spans: [
      {
        nodePath: [0],
        sourceStart: 0,
        sourceEnd: 6,
        normalizedStart: 0,
        normalizedEnd: 6,
      },
    ],
  });
  const target: AnnotationTarget = {
    href: 'chapter.xhtml',
    selectors: {
      sourceRange: {
        type: 'SourceRangeSelector',
        start: { nodePath: [0], textOffset: 1 },
        end: { nodePath: [0], textOffset: 4 },
      },
      textQuote: { type: 'TextQuoteSelector', exact: 'bcd' },
      textPosition: { type: 'TextPositionSelector', start: 1, end: 4 },
      progression: { type: 'ProgressionSelector', chapter: 0, chapterProgress: 1 / 6 },
    },
    text: { highlight: 'bcd' },
  };
  const recordId = store.add({ kind: 'highlight', target }).id;
  const interactions: ReaderInteractions = {
    enabled: true,
    resolveExactSourceRange: resolve as NonNullable<ReaderInteractions['resolveExactSourceRange']>,
    getPageTargets: () => Promise.resolve(undefined),
    getFootnote: () => Promise.resolve(undefined),
    resolveLocator: () => Promise.resolve(undefined),
  };
  const spread = {
    index: 0,
    left: { index: 0 },
    right: { index: 1 },
  } as unknown as Spread;
  const reader = {
    interactions,
    chapterMap: new Map([['chapter-item', { startPage: 0, endPage: 1 }]]),
    manifestHrefMap: new Map([['chapter-item', 'chapter.xhtml']]),
  } as unknown as Reader;
  return { interactions, reader, recordId, resolve, spread, state, store };
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
