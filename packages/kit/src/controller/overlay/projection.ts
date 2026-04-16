/**
 * Build overlay layers from engine state by projecting page-content
 * and spread-content rects into viewport-logical space via the mapper.
 */
import type { Reader, Spread, Page } from '@ritojs/core';
import { buildHitMap, getSelectionRects } from '@ritojs/core/advanced';
import type { HitMap } from '@ritojs/core/advanced';
import type { ResolvedAnnotation } from '@ritojs/core/annotations';
import { resolveAnnotations } from '@ritojs/core/annotations';
import type { Rect } from '../../painter/types';
import type { CoordinateMapper } from '../geometry/coordinate-mapper';
import type { CoordinatorEngines, CoordinatorState } from '../core/coordinator-state';
import { OVERLAY_COLORS } from './merger';

export function buildOverlayData(
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  state: CoordinatorState,
  mapper: CoordinateMapper,
  includeSelection = true,
): {
  selectionRects: readonly Rect[];
  searchRects: readonly Rect[];
  activeSearchRects: readonly Rect[];
  annotationLayers: readonly { id: string; rects: readonly Rect[]; color: string }[];
} {
  const selectionRects = includeSelection
    ? engines.selection.getRects().map((r) => mapper.spreadContentRectToViewport(r))
    : [];

  const searchRects = collectRects(spread, state, mapper, (page, hitMap) =>
    engines.search.getHighlightRects(page.index, hitMap, reader.measurer),
  );

  const activeSearchRects = collectActiveSearchRects(spread, engines, state, reader, mapper);
  const annotationLayers = collectAnnotationLayers(spread, state, mapper);

  return { selectionRects, searchRects, activeSearchRects, annotationLayers };
}

function collectActiveSearchRects(
  spread: Spread,
  engines: CoordinatorEngines,
  state: CoordinatorState,
  reader: Reader,
  mapper: CoordinateMapper,
): readonly Rect[] {
  const idx = engines.search.getActiveIndex();
  const results = engines.search.getResults();
  if (idx < 0 || idx >= results.length) return [];
  const active = results[idx];
  if (!active) return [];
  const hitMap = state.hitMaps.get(active.pageIndex);
  if (!hitMap) return [];
  const page =
    spread.left?.index === active.pageIndex
      ? spread.left
      : spread.right?.index === active.pageIndex
        ? spread.right
        : undefined;
  if (!page) return [];
  const rects = getSelectionRects(hitMap, active.range, reader.measurer);
  return rects.map((r) => mapper.pageContentToViewport(page.index, r));
}

function collectRects(
  spread: Spread,
  state: Pick<CoordinatorState, 'hitMaps'>,
  mapper: CoordinateMapper,
  getRects: (page: Page, hitMap: HitMap) => readonly Rect[],
): readonly Rect[] {
  const result: Rect[] = [];
  for (const page of pagesOf(spread)) {
    const hitMap = state.hitMaps.get(page.index);
    if (!hitMap) continue;
    for (const rect of getRects(page, hitMap)) {
      result.push(mapper.pageContentToViewport(page.index, rect));
    }
  }
  return result;
}

function collectAnnotationLayers(
  spread: Spread,
  state: CoordinatorState,
  mapper: CoordinateMapper,
): readonly { id: string; rects: readonly Rect[]; color: string }[] {
  const layers: { id: string; rects: readonly Rect[]; color: string }[] = [];
  const pageIndices = new Set(pagesOf(spread).map((p) => p.index));

  for (const resolved of state.resolvedAnnotations) {
    if (resolved.status === 'orphaned') continue;
    for (const seg of resolved.segments) {
      if (!pageIndices.has(seg.pageIndex)) continue;
      if (seg.rects.length > 0) {
        layers.push({
          id: resolved.id,
          rects: seg.rects.map((r) => mapper.pageContentToViewport(seg.pageIndex, r)),
          color: resolved.record.color ?? OVERLAY_COLORS.annotationDefault,
        });
      }
    }
  }
  return layers;
}

/**
 * Build overlay data for a non-current spread using ephemeral hitMaps.
 * Used during page-turn animation so incoming pages show search/annotation highlights.
 */
export function buildAdjacentOverlayData(
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  state: CoordinatorState,
  mapper: CoordinateMapper,
): {
  selectionRects: readonly Rect[];
  searchRects: readonly Rect[];
  activeSearchRects: readonly Rect[];
  annotationLayers: readonly { id: string; rects: readonly Rect[]; color: string }[];
} {
  // Build ephemeral hitMaps for this spread's pages
  const hitMaps = new Map<number, HitMap>();
  for (const page of pagesOf(spread)) {
    hitMaps.set(page.index, buildHitMap(page));
  }

  // Resolve annotations against the ephemeral hitMaps
  const store = state.annotationStore;
  let resolvedAnnotations: readonly ResolvedAnnotation[] = [];
  if (store && store.getAll().length > 0) {
    resolvedAnnotations = resolveAnnotations(store.getAll(), {
      chapterIndices: state.chapterIndices,
      hitMaps,
      chapterPageRanges: reader.chapterMap,
      measurer: reader.measurer,
    });
  }

  // Build ephemeral state for projection
  const ephemeralState: Pick<CoordinatorState, 'hitMaps' | 'resolvedAnnotations'> = {
    hitMaps,
    resolvedAnnotations,
  };

  const searchRects = collectRects(spread, ephemeralState, mapper, (page, hitMap) =>
    engines.search.getHighlightRects(page.index, hitMap, reader.measurer),
  );
  const activeSearchRects = collectActiveSearchRectsFromHitMaps(
    spread,
    engines,
    hitMaps,
    reader,
    mapper,
  );
  const annotationLayers = collectAnnotationLayersFromResolved(spread, resolvedAnnotations, mapper);

  return { selectionRects: [], searchRects, activeSearchRects, annotationLayers };
}

function collectActiveSearchRectsFromHitMaps(
  spread: Spread,
  engines: CoordinatorEngines,
  hitMaps: ReadonlyMap<number, HitMap>,
  reader: Reader,
  mapper: CoordinateMapper,
): readonly Rect[] {
  const idx = engines.search.getActiveIndex();
  const results = engines.search.getResults();
  if (idx < 0 || idx >= results.length) return [];
  const active = results[idx];
  if (!active) return [];
  const hitMap = hitMaps.get(active.pageIndex);
  if (!hitMap) return [];
  const page =
    spread.left?.index === active.pageIndex
      ? spread.left
      : spread.right?.index === active.pageIndex
        ? spread.right
        : undefined;
  if (!page) return [];
  const rects = getSelectionRects(hitMap, active.range, reader.measurer);
  return rects.map((r) => mapper.pageContentToViewport(page.index, r));
}

function collectAnnotationLayersFromResolved(
  spread: Spread,
  resolvedAnnotations: readonly ResolvedAnnotation[],
  mapper: CoordinateMapper,
): readonly { id: string; rects: readonly Rect[]; color: string }[] {
  const layers: { id: string; rects: readonly Rect[]; color: string }[] = [];
  const pageIndices = new Set(pagesOf(spread).map((p) => p.index));

  for (const resolved of resolvedAnnotations) {
    if (resolved.status === 'orphaned') continue;
    for (const seg of resolved.segments) {
      if (!pageIndices.has(seg.pageIndex)) continue;
      if (seg.rects.length > 0) {
        layers.push({
          id: resolved.id,
          rects: seg.rects.map((r) => mapper.pageContentToViewport(seg.pageIndex, r)),
          color: resolved.record.color ?? OVERLAY_COLORS.annotationDefault,
        });
      }
    }
  }
  return layers;
}

function pagesOf(spread: Spread): readonly Page[] {
  const pages: Page[] = [];
  if (spread.left) pages.push(spread.left);
  if (spread.right) pages.push(spread.right);
  return pages;
}
