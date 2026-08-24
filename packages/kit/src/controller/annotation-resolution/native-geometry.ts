import type {
  Reader,
  ReaderExactSourceRange,
  ReaderExactSourceRangeRequest,
  ReaderExactSourceRangeResolution,
  ReaderInteractions,
  Spread,
} from '@ritojs/core';
import type { AnnotationRecord, ResolvedAnnotation } from '../../interaction/index';
import type { CoordinatorState } from '../core/coordinator-state';
import { buildChapterPageRanges } from './chapter-identity';
import { resolveAnnotationSource } from './source-selector';

export interface NativeAnnotationGeometryState {
  generation: number;
  readonly cache: Map<string, ReaderExactSourceRange>;
  /** Pending/unavailable projections that must not be retried within this revision. */
  readonly misses: Set<string>;
  readonly pending: Map<string, Promise<ReaderExactSourceRangeResolution | undefined>>;
}

export function createNativeAnnotationGeometryState(): NativeAnnotationGeometryState {
  return { generation: 0, cache: new Map(), misses: new Set(), pending: new Map() };
}

export function usesNativeAnnotationGeometry(reader: Reader): boolean {
  return reader.interactions?.resolveExactSourceRange !== undefined;
}

export function invalidateNativeAnnotationGeometry(state: CoordinatorState): void {
  const native = state.nativeAnnotationGeometry;
  native.generation += 1;
  native.cache.clear();
  native.misses.clear();
  native.pending.clear();
  state.resolvedAnnotations = [];
}

export function refreshNativeAnnotations(reader: Reader, state: CoordinatorState): void {
  if (!reader.interactions?.enabled) {
    state.resolvedAnnotations = [];
    return;
  }
  const records = state.annotationStore?.getAll() ?? [];
  pruneNativeAnnotationGeometry(reader, state);
  state.resolvedAnnotations = records.flatMap((record) => resolvedFromCache(record, reader, state));
}

export function scheduleNativeAnnotationsForSpread(
  spread: Spread,
  reader: Reader,
  state: CoordinatorState,
  onUpdated: () => void,
  onError: (error: unknown) => void,
): void {
  const interactions = reader.interactions;
  if (
    !state.nativeInteractionsAlive ||
    !interactions?.enabled ||
    !interactions.resolveExactSourceRange
  ) {
    return;
  }
  const records = recordsForSpread(spread, reader, state);
  for (const record of records) {
    const source = resolveAnnotationSource(record, state, reader);
    if (!source) continue;
    if (
      state.nativeAnnotationGeometry.cache.has(source.key) ||
      state.nativeAnnotationGeometry.misses.has(source.key) ||
      state.nativeAnnotationGeometry.pending.has(source.key)
    ) {
      continue;
    }
    scheduleOne(source.key, source.request, interactions, reader, state, onUpdated, onError);
  }
}

function scheduleOne(
  key: string,
  request: ReaderExactSourceRangeRequest,
  interactions: ReaderInteractions,
  reader: Reader,
  state: CoordinatorState,
  onUpdated: () => void,
  onError: (error: unknown) => void,
): void {
  const generation = state.nativeAnnotationGeometry.generation;
  const task = interactions.resolveExactSourceRange?.(copyRequest(request));
  if (!task) return;
  state.nativeAnnotationGeometry.pending.set(key, task);
  void task
    .then((resolution) => {
      if (!canInstall(key, task, generation, interactions, reader, state)) return;
      if (!resolution) return;
      if (resolution.status !== 'resolved') {
        state.nativeAnnotationGeometry.misses.add(key);
        return;
      }
      state.nativeAnnotationGeometry.cache.set(key, copyRange(resolution.range));
      refreshNativeAnnotations(reader, state);
      onUpdated();
    })
    .catch((error: unknown) => {
      if (canInstall(key, task, generation, interactions, reader, state)) onError(error);
    })
    .finally(() => {
      if (state.nativeAnnotationGeometry.pending.get(key) === task) {
        state.nativeAnnotationGeometry.pending.delete(key);
      }
    });
}

function canInstall(
  key: string,
  task: Promise<ReaderExactSourceRangeResolution | undefined>,
  generation: number,
  interactions: ReaderInteractions,
  reader: Reader,
  state: CoordinatorState,
): boolean {
  return (
    state.nativeAnnotationGeometry.pending.get(key) === task &&
    state.nativeAnnotationGeometry.generation === generation &&
    state.nativeInteractionsAlive &&
    reader.interactions === interactions &&
    interactions.enabled &&
    currentSourceKeys(reader, state).has(key)
  );
}

function currentSourceKeys(reader: Reader, state: CoordinatorState): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const record of state.annotationStore?.getAll() ?? []) {
    const source = resolveAnnotationSource(record, state, reader);
    if (source) keys.add(source.key);
  }
  return keys;
}

function pruneNativeAnnotationGeometry(reader: Reader, state: CoordinatorState): void {
  const current = currentSourceKeys(reader, state);
  for (const key of state.nativeAnnotationGeometry.cache.keys()) {
    if (!current.has(key)) state.nativeAnnotationGeometry.cache.delete(key);
  }
  for (const key of state.nativeAnnotationGeometry.misses) {
    if (!current.has(key)) state.nativeAnnotationGeometry.misses.delete(key);
  }
  for (const key of state.nativeAnnotationGeometry.pending.keys()) {
    if (!current.has(key)) state.nativeAnnotationGeometry.pending.delete(key);
  }
}

function resolvedFromCache(
  record: AnnotationRecord,
  reader: Reader,
  state: CoordinatorState,
): readonly ResolvedAnnotation[] {
  const source = resolveAnnotationSource(record, state, reader);
  if (!source) return [{ id: record.id, record, status: 'orphaned', segments: [] }];
  const range = state.nativeAnnotationGeometry.cache.get(source.key);
  if (!range) return [];
  const rectsByPage = new Map<number, ReaderExactSourceRange['rects'][number][]>();
  for (const rect of range.rects) {
    const pageRects = rectsByPage.get(rect.pageIndex) ?? [];
    pageRects.push(rect);
    rectsByPage.set(rect.pageIndex, pageRects);
  }
  return [
    {
      id: record.id,
      record,
      status: source.status,
      segments: [...rectsByPage].map(([pageIndex, rects]) => ({
        pageIndex,
        range: null,
        rects: rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
      })),
    },
  ];
}

function recordsForSpread(
  spread: Spread,
  reader: Reader,
  state: CoordinatorState,
): readonly AnnotationRecord[] {
  const pages = new Set(
    [spread.left?.index, spread.right?.index].filter((page): page is number => page !== undefined),
  );
  const ranges = buildChapterPageRanges(reader);
  return (state.annotationStore?.getAll() ?? []).filter((record) => {
    const source = resolveAnnotationSource(record, state, reader);
    const range = source ? ranges.get(source.request.href) : undefined;
    if (!range) return false;
    for (const page of pages) {
      if (page >= range.startPage && page <= range.endPage) return true;
    }
    return false;
  });
}

function copyRequest(request: ReaderExactSourceRangeRequest): ReaderExactSourceRangeRequest {
  return {
    href: request.href,
    sourceRange: {
      start: {
        nodePath: [...request.sourceRange.start.nodePath],
        textOffset: request.sourceRange.start.textOffset,
      },
      end: {
        nodePath: [...request.sourceRange.end.nodePath],
        textOffset: request.sourceRange.end.textOffset,
      },
    },
  };
}

function copyRange(range: ReaderExactSourceRange): ReaderExactSourceRange {
  const sourceRange = range.sourceLocator.sourceRange;
  return {
    selectedText: range.selectedText,
    sourceLocator: {
      href: range.sourceLocator.href,
      ...(sourceRange
        ? {
            sourceRange: {
              start: {
                nodePath: [...sourceRange.start.nodePath],
                textOffset: sourceRange.start.textOffset,
              },
              end: {
                nodePath: [...sourceRange.end.nodePath],
                textOffset: sourceRange.end.textOffset,
              },
            },
          }
        : {}),
    },
    rects: range.rects.map((rect) => ({ ...rect })),
  };
}
