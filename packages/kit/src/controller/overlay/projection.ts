/**
 * Build overlay layers from engine state by projecting page-content
 * and spread-content rects into viewport-logical space via the mapper.
 */
import type { Reader, Spread } from '@ritojs/core';
import type { Rect } from '../../painter/types';
import type { CoordinateMapper } from '../geometry/coordinate-mapper';
import type { CoordinatorEngines, CoordinatorState } from '../core/coordinator-state';
import { collectNativeSearchGeometry } from '../search-resolution';
import { OVERLAY_COLORS } from './merger';

export interface OverlayData {
  readonly selectionRects: readonly Rect[];
  readonly searchRects: readonly Rect[];
  readonly activeSearchRects: readonly Rect[];
  readonly annotationLayers: readonly { id: string; rects: readonly Rect[]; color: string }[];
}

/**
 * Overlay data for one spread. Search and annotation rectangles come from the
 * reader's committed revision and are shared across spreads; the selection is
 * projected only for the current spread (`includeSelection`), since the
 * selection engine's projection belongs to the visible mapper.
 * While a visual preview disables the reader's interactions, no geometry is painted.
 */
export function buildOverlayData(
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  state: CoordinatorState,
  mapper: CoordinateMapper,
  includeSelection = true,
): OverlayData {
  const selectionRects = includeSelection
    ? engines.selection.getRects().map((r) => mapper.spreadContentRectToViewport(r))
    : [];
  if (!reader.interactions?.enabled) {
    return { selectionRects, searchRects: [], activeSearchRects: [], annotationLayers: [] };
  }
  const geometry = collectNativeSearchGeometry(
    spread,
    engines.search.getResults(),
    engines.search.getActiveIndex(),
    state,
  );
  return {
    selectionRects,
    searchRects: geometry.matches.map((rect) => mapper.pageContentToViewport(rect.pageIndex, rect)),
    activeSearchRects: geometry.active.map((rect) =>
      mapper.pageContentToViewport(rect.pageIndex, rect),
    ),
    annotationLayers: collectAnnotationLayers(spread, state, mapper),
  };
}

function collectAnnotationLayers(
  spread: Spread,
  state: CoordinatorState,
  mapper: CoordinateMapper,
): readonly { id: string; rects: readonly Rect[]; color: string }[] {
  const layers: { id: string; rects: readonly Rect[]; color: string }[] = [];
  const pageIndices = new Set(spread.pageIndexes);

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
