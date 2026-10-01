import type {
  Reader,
  ReaderAnnotationTargetResolution,
  ReaderExactSourceRange,
  ReaderExactSourceRangeRequest,
  ReaderExactSourceRangeResolution,
  ReaderInteractions,
  Spread,
} from '@ritojs/core';
import type {
  AnnotationRecord,
  AnnotationTarget,
  ResolutionStatus,
  ResolvedAnnotation,
} from '../../interaction/index';
import type { CoordinatorState } from '../core/coordinator-state';
import { buildChapterPageRanges } from './chapter-identity';

/** Where the engine found a stored target, and the projection request for it. */
type TargetLocation =
  | {
      readonly status: Exclude<ResolutionStatus, 'orphaned'>;
      readonly request: ReaderExactSourceRangeRequest;
      readonly key: string;
    }
  | { readonly status: 'orphaned' };

export interface NativeAnnotationGeometryState {
  generation: number;
  /** Engine resolutions of stored targets. They depend only on the source, so relayouts keep them. */
  readonly locations: Map<string, TargetLocation>;
  readonly locating: Map<string, Promise<ReaderAnnotationTargetResolution | undefined>>;
  /** Revision-owned projections of located targets, keyed by their source range. */
  readonly cache: Map<string, ReaderExactSourceRange>;
  /** Pending/unavailable projections that must not be retried within this revision. */
  readonly misses: Set<string>;
  readonly pending: Map<string, Promise<ReaderExactSourceRangeResolution | undefined>>;
}

type Callbacks = { readonly onUpdated: () => void; readonly onError: (error: unknown) => void };

export function createNativeAnnotationGeometryState(): NativeAnnotationGeometryState {
  return {
    generation: 0,
    locations: new Map(),
    locating: new Map(),
    cache: new Map(),
    misses: new Set(),
    pending: new Map(),
  };
}

/** A relayout drops projections; target locations survive it. */
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
  pruneNativeAnnotationGeometry(records, state);
  state.resolvedAnnotations = records.flatMap((record) => resolvedFromCache(record, state));
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
    !interactions.resolveAnnotationTarget ||
    !interactions.resolveExactSourceRange
  ) {
    return;
  }
  const callbacks = { onUpdated, onError };
  for (const record of recordsForSpread(spread, reader, state)) {
    const location = state.nativeAnnotationGeometry.locations.get(targetKey(record.target));
    if (!location) {
      locate(record.target, interactions, reader, state, callbacks);
    } else if (location.status !== 'orphaned') {
      project(location, interactions, reader, state, callbacks);
    }
  }
}

function locate(
  target: AnnotationTarget,
  interactions: ReaderInteractions,
  reader: Reader,
  state: CoordinatorState,
  callbacks: Callbacks,
): void {
  const native = state.nativeAnnotationGeometry;
  const key = targetKey(target);
  if (native.locating.has(key)) return;
  const task = interactions.resolveAnnotationTarget?.(target);
  if (!task) return;
  native.locating.set(key, task);
  void task
    .then((resolution) => {
      if (native.locating.get(key) !== task || !canInstall(interactions, reader, state)) return;
      if (!resolution) return;
      const location = toLocation(resolution);
      native.locations.set(key, location);
      if (location.status !== 'orphaned') {
        project(location, interactions, reader, state, callbacks);
        return;
      }
      refreshNativeAnnotations(reader, state);
      callbacks.onUpdated();
    })
    .catch((error: unknown) => {
      if (native.locating.get(key) === task && canInstall(interactions, reader, state)) {
        callbacks.onError(error);
      }
    })
    .finally(() => {
      if (native.locating.get(key) === task) native.locating.delete(key);
    });
}

function project(
  location: Extract<TargetLocation, { readonly request: unknown }>,
  interactions: ReaderInteractions,
  reader: Reader,
  state: CoordinatorState,
  callbacks: Callbacks,
): void {
  const native = state.nativeAnnotationGeometry;
  const { key } = location;
  if (native.cache.has(key) || native.misses.has(key) || native.pending.has(key)) return;
  const generation = native.generation;
  const task = interactions.resolveExactSourceRange?.(copyRequest(location.request));
  if (!task) return;
  native.pending.set(key, task);
  const current = () =>
    native.pending.get(key) === task &&
    native.generation === generation &&
    canInstall(interactions, reader, state);
  void task
    .then((resolution) => {
      if (!current() || !resolution) return;
      if (resolution.status !== 'resolved') {
        native.misses.add(key);
        return;
      }
      native.cache.set(key, copyRange(resolution.range));
      refreshNativeAnnotations(reader, state);
      callbacks.onUpdated();
    })
    .catch((error: unknown) => {
      if (current()) callbacks.onError(error);
    })
    .finally(() => {
      if (native.pending.get(key) === task) native.pending.delete(key);
    });
}

function canInstall(
  interactions: ReaderInteractions,
  reader: Reader,
  state: CoordinatorState,
): boolean {
  return (
    state.nativeInteractionsAlive && reader.interactions === interactions && interactions.enabled
  );
}

function toLocation(resolution: ReaderAnnotationTargetResolution): TargetLocation {
  if (resolution.level === 'orphaned') return { status: 'orphaned' };
  const request = { href: resolution.target.href, sourceRange: resolution.target.sourceRange };
  return { status: resolution.level, request, key: sourceRangeKey(request) };
}

/** Drops locations and projections no stored record refers to any more. */
function pruneNativeAnnotationGeometry(
  records: readonly AnnotationRecord[],
  state: CoordinatorState,
): void {
  const native = state.nativeAnnotationGeometry;
  const targets = new Set(records.map((record) => targetKey(record.target)));
  for (const key of native.locations.keys()) {
    if (!targets.has(key)) native.locations.delete(key);
  }
  const ranges = new Set<string>();
  for (const location of native.locations.values()) {
    if (location.status !== 'orphaned') ranges.add(location.key);
  }
  for (const key of native.cache.keys()) if (!ranges.has(key)) native.cache.delete(key);
  for (const key of native.misses) if (!ranges.has(key)) native.misses.delete(key);
  for (const key of native.pending.keys()) if (!ranges.has(key)) native.pending.delete(key);
}

function resolvedFromCache(
  record: AnnotationRecord,
  state: CoordinatorState,
): readonly ResolvedAnnotation[] {
  const location = state.nativeAnnotationGeometry.locations.get(targetKey(record.target));
  if (!location) return [];
  if (location.status === 'orphaned') {
    return [{ id: record.id, record, status: 'orphaned', segments: [] }];
  }
  const range = state.nativeAnnotationGeometry.cache.get(location.key);
  if (!range) return [];
  const rectsByPage = new Map<number, ReaderExactSourceRange['rects'][number][]>();
  for (const rect of range.rects) {
    const pageRects = rectsByPage.get(rect.pageIndex) ?? [];
    pageRects.push(rect);
    rectsByPage.set(rect.pageIndex, pageRects);
  }
  const segments = [...rectsByPage].map(([pageIndex, rects]) => ({
    pageIndex,
    rects: rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
  }));
  return [{ id: record.id, record, status: location.status, segments }];
}

function recordsForSpread(
  spread: Spread,
  reader: Reader,
  state: CoordinatorState,
): readonly AnnotationRecord[] {
  const pages = spread.pageIndexes;
  const ranges = buildChapterPageRanges(reader);
  return (state.annotationStore?.getAll() ?? []).filter((record) => {
    const range = ranges.get(record.target.href);
    return (
      range !== undefined && pages.some((page) => page >= range.startPage && page <= range.endPage)
    );
  });
}

function targetKey(target: AnnotationTarget): string {
  return JSON.stringify(target);
}

export function sourceRangeKey(request: ReaderExactSourceRangeRequest): string {
  return JSON.stringify([
    request.href,
    request.sourceRange.start.nodePath,
    request.sourceRange.start.textOffset,
    request.sourceRange.end.nodePath,
    request.sourceRange.end.textOffset,
  ]);
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
      ...(sourceRange ? { sourceRange: copyRequest({ href: '', sourceRange }).sourceRange } : {}),
    },
    rects: range.rects.map((rect) => ({ ...rect })),
  };
}
