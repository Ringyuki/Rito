/**
 * Build overlay layers from engine state by projecting page-content
 * and spread-content rects into viewport-logical space via the mapper.
 */
import type { Reader, Spread, Page } from 'rito';
import { resolveAnnotationRects, getSelectionRects } from 'rito/advanced';
import type { HitMap } from 'rito/advanced';
import type { Rect } from '../../overlay/types';
import type { CoordinateMapper } from '../geometry/coordinate-mapper';
import type { CoordinatorEngines, CoordinatorState } from '../core/coordinator-state';
import { OVERLAY_COLORS } from './merger';

export function buildOverlayData(
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
  const selectionRects = engines.selection
    .getRects()
    .map((r) => mapper.spreadContentRectToViewport(r));

  const searchRects = collectRects(spread, state, mapper, (page, hitMap) =>
    engines.search.getHighlightRects(page.index, hitMap, reader.measurer),
  );

  const activeSearchRects = collectActiveSearchRects(spread, engines, state, reader, mapper);
  const annotationLayers = collectAnnotationLayers(spread, engines, state, reader, mapper);

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
  state: CoordinatorState,
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
  engines: CoordinatorEngines,
  state: CoordinatorState,
  reader: Reader,
  mapper: CoordinateMapper,
): readonly { id: string; rects: readonly Rect[]; color: string }[] {
  const layers: { id: string; rects: readonly Rect[]; color: string }[] = [];
  for (const page of pagesOf(spread)) {
    const hitMap = state.hitMaps.get(page.index);
    if (!hitMap) continue;
    for (const ann of engines.annotation.getForPage(page.index)) {
      const data = resolveAnnotationRects(ann, hitMap, reader.measurer);
      if (data.rects.length > 0) {
        layers.push({
          id: ann.id,
          rects: data.rects.map((r) => mapper.pageContentToViewport(page.index, r)),
          color: ann.color ?? OVERLAY_COLORS.annotationDefault,
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
