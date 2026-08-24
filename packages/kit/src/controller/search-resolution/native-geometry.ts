import type {
  Reader,
  ReaderExactSourceRangeRequest,
  ReaderExactSourceRangeResolution,
  ReaderExactTextRangeRect,
  ReaderInteractions,
  Spread,
} from '@ritojs/core';
import type { SearchResult } from '../../interaction/index';
import type { CoordinatorState } from '../core/coordinator-state';

interface VisibleSearchSpread {
  readonly index: number;
  readonly pageIndices: readonly number[];
}

export interface NativeSearchGeometryState {
  alive: boolean;
  generation: number;
  results: readonly SearchResult[];
  visible: VisibleSearchSpread | null;
  readonly cache: Map<SearchResult, readonly ReaderExactTextRangeRect[]>;
  /** Source-unavailable and typed exact-resolution misses for this generation. */
  readonly misses: Set<SearchResult>;
  readonly pending: Map<SearchResult, Promise<ReaderExactSourceRangeResolution | undefined>>;
}

export interface NativeSearchGeometry {
  readonly matches: readonly ReaderExactTextRangeRect[];
  readonly active: readonly ReaderExactTextRangeRect[];
}

export function createNativeSearchGeometryState(): NativeSearchGeometryState {
  return {
    alive: true,
    generation: 0,
    results: [],
    visible: null,
    cache: new Map(),
    misses: new Set(),
    pending: new Map(),
  };
}

export function usesNativeSearchGeometry(reader: Reader): boolean {
  return reader.interactions?.resolveExactSourceRange !== undefined;
}

export function replaceNativeSearchResults(
  state: CoordinatorState,
  results: readonly SearchResult[],
): void {
  invalidateOwnedGeometry(state.nativeSearchGeometry);
  state.nativeSearchGeometry.results = results;
}

export function invalidateNativeSearchLayout(state: CoordinatorState): void {
  invalidateOwnedGeometry(state.nativeSearchGeometry);
}

export function disposeNativeSearchGeometry(state: CoordinatorState): void {
  const native = state.nativeSearchGeometry;
  native.alive = false;
  invalidateOwnedGeometry(native);
  native.results = [];
  native.visible = null;
}

export function scheduleNativeSearchGeometryForSpread(
  spread: Spread,
  reader: Reader,
  state: CoordinatorState,
  onUpdated: () => void,
  onError: (error: unknown) => void,
): void {
  const interactions = reader.interactions;
  if (
    !state.nativeSearchGeometry.alive ||
    !interactions?.enabled ||
    !interactions.resolveExactSourceRange
  ) {
    return;
  }

  const visible = installVisibleSpread(spread, state.nativeSearchGeometry);
  const results = state.nativeSearchGeometry.results;
  for (const result of results) {
    if (!visible.pageIndices.includes(result.pageIndex)) continue;
    if (hasOwnedOutcome(result, state.nativeSearchGeometry)) continue;
    const request = requestForResult(result);
    if (!request) {
      state.nativeSearchGeometry.misses.add(result);
      continue;
    }
    scheduleOne(result, request, results, visible, interactions, reader, state, onUpdated, onError);
  }
}

export function collectNativeSearchGeometry(
  spread: Spread,
  results: readonly SearchResult[],
  activeIndex: number,
  state: CoordinatorState,
): NativeSearchGeometry {
  const native = state.nativeSearchGeometry;
  if (!native.alive || native.results !== results) return { matches: [], active: [] };
  const visiblePages = new Set(pageIndices(spread));
  const matches: ReaderExactTextRangeRect[] = [];
  const active: ReaderExactTextRangeRect[] = [];
  for (const [index, result] of results.entries()) {
    const rects = native.cache.get(result);
    if (!rects) continue;
    for (const rect of rects) {
      if (!visiblePages.has(rect.pageIndex)) continue;
      matches.push(rect);
      if (index === activeIndex) active.push(rect);
    }
  }
  return { matches, active };
}

function scheduleOne(
  result: SearchResult,
  request: ReaderExactSourceRangeRequest,
  results: readonly SearchResult[],
  visible: VisibleSearchSpread,
  interactions: ReaderInteractions,
  reader: Reader,
  state: CoordinatorState,
  onUpdated: () => void,
  onError: (error: unknown) => void,
): void {
  const generation = state.nativeSearchGeometry.generation;
  let task: Promise<ReaderExactSourceRangeResolution | undefined> | undefined;
  try {
    task = interactions.resolveExactSourceRange?.(copyRequest(request));
  } catch (error: unknown) {
    state.nativeSearchGeometry.misses.add(result);
    reportError(onError, error);
    return;
  }
  if (!task) return;
  state.nativeSearchGeometry.pending.set(result, task);
  void task
    .then((resolution) => {
      if (!canInstall(result, task, generation, results, visible, interactions, reader, state))
        return;
      if (!resolution) return;
      if (resolution.status !== 'resolved') {
        state.nativeSearchGeometry.misses.add(result);
        return;
      }
      state.nativeSearchGeometry.cache.set(
        result,
        resolution.range.rects.map((rect) => ({ ...rect })),
      );
      onUpdated();
    })
    .catch((error: unknown) => {
      if (canInstall(result, task, generation, results, visible, interactions, reader, state)) {
        reportError(onError, error);
      }
    })
    .finally(() => {
      if (state.nativeSearchGeometry.pending.get(result) === task) {
        state.nativeSearchGeometry.pending.delete(result);
      }
    });
}

function canInstall(
  result: SearchResult,
  task: Promise<ReaderExactSourceRangeResolution | undefined>,
  generation: number,
  results: readonly SearchResult[],
  visible: VisibleSearchSpread,
  interactions: ReaderInteractions,
  reader: Reader,
  state: CoordinatorState,
): boolean {
  const native = state.nativeSearchGeometry;
  return (
    native.alive &&
    native.generation === generation &&
    native.results === results &&
    native.results.includes(result) &&
    native.visible === visible &&
    visible.pageIndices.includes(result.pageIndex) &&
    native.pending.get(result) === task &&
    reader.interactions === interactions &&
    interactions.enabled
  );
}

function installVisibleSpread(
  spread: Spread,
  state: NativeSearchGeometryState,
): VisibleSearchSpread {
  const nextPages = pageIndices(spread);
  const current = state.visible;
  if (
    current?.index === spread.index &&
    current.pageIndices.length === nextPages.length &&
    current.pageIndices.every((page, index) => page === nextPages[index])
  ) {
    return current;
  }
  state.pending.clear();
  const next = { index: spread.index, pageIndices: nextPages };
  state.visible = next;
  return next;
}

function pageIndices(spread: Spread): readonly number[] {
  return [spread.left?.index, spread.right?.index].filter(
    (pageIndex): pageIndex is number => pageIndex !== undefined,
  );
}

function hasOwnedOutcome(result: SearchResult, state: NativeSearchGeometryState): boolean {
  return state.cache.has(result) || state.misses.has(result) || state.pending.has(result);
}

function requestForResult(result: SearchResult): ReaderExactSourceRangeRequest | undefined {
  if (result.source?.status !== 'resolved') return undefined;
  return { href: result.source.href, sourceRange: result.source.sourceRange };
}

function invalidateOwnedGeometry(state: NativeSearchGeometryState): void {
  state.generation += 1;
  state.cache.clear();
  state.misses.clear();
  state.pending.clear();
}

function copyRequest(request: ReaderExactSourceRangeRequest): ReaderExactSourceRangeRequest {
  return {
    href: request.href,
    sourceRange: {
      start: { ...request.sourceRange.start, nodePath: [...request.sourceRange.start.nodePath] },
      end: { ...request.sourceRange.end, nodePath: [...request.sourceRange.end.nodePath] },
    },
  };
}

function reportError(onError: (error: unknown) => void, error: unknown): void {
  try {
    onError(error);
  } catch {
    // Consumer error reporting must not escape an asynchronous interaction read.
  }
}
