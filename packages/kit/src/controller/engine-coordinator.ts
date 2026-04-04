import type { Reader, Spread, Page } from 'rito';
import { createLayoutConfig } from 'rito';
import type { SelectionEngine } from 'rito/selection';
import type { SearchEngine } from 'rito/search';
import type { AnnotationEngine } from 'rito/annotations';
import type { PositionTracker } from 'rito/position';
import { buildHitMap, buildLinkMap, resolveAnnotationRects } from 'rito/advanced';
import type { HitMap, LinkRegion } from 'rito/advanced';
import type { OverlayRenderer } from '../overlay/types';
import { mergeOverlayLayers, OVERLAY_COLORS } from './overlay-merger';
import type { Rect } from '../overlay/types';
import type { ReaderControllerOptions } from './types';

export interface CoordinatorEngines {
  readonly selection: SelectionEngine;
  readonly search: SearchEngine;
  readonly annotation: AnnotationEngine;
  readonly position: PositionTracker | null;
}

export interface CoordinatorState {
  hitMaps: Map<number, HitMap>;
  linkRegions: readonly LinkRegion[];
}

export function createCoordinatorState(): CoordinatorState {
  return { hitMaps: new Map(), linkRegions: [] };
}

/** Sync all engines after a spread is rendered. */
export function coordinateOnSpreadRendered(
  spreadIndex: number,
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  overlay: OverlayRenderer,
  state: CoordinatorState,
  options: ReaderControllerOptions,
): void {
  syncSelectionEngine(spread, engines.selection, reader, options);
  rebuildHitMaps(spread, state);
  rebuildLinkRegions(spread, state);
  engines.position?.update(spreadIndex);
  renderOverlay(spread, engines, reader, overlay, state);
}

function syncSelectionEngine(
  spread: Spread,
  selection: SelectionEngine,
  reader: Reader,
  options: ReaderControllerOptions,
): void {
  const input: Parameters<typeof createLayoutConfig>[0] = {
    width: options.width,
    height: options.height,
    ...(options.margin !== undefined ? { margin: options.margin } : {}),
    ...(options.spread !== undefined ? { spread: options.spread } : {}),
    ...(options.spreadGap !== undefined ? { spreadGap: options.spreadGap } : {}),
  };
  const config = createLayoutConfig(input);
  selection.setSpread(spread, config, reader.measurer);
}

function rebuildHitMaps(spread: Spread, state: CoordinatorState): void {
  state.hitMaps.clear();
  for (const page of pagesOf(spread)) {
    state.hitMaps.set(page.index, buildHitMap(page));
  }
}

function rebuildLinkRegions(spread: Spread, state: CoordinatorState): void {
  const regions: LinkRegion[] = [];
  for (const page of pagesOf(spread)) {
    regions.push(...buildLinkMap(page));
  }
  state.linkRegions = regions;
}

function renderOverlay(
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  overlay: OverlayRenderer,
  state: CoordinatorState,
): void {
  const selectionRects = engines.selection.getRects();
  const searchRects = collectSearchRects(spread, engines.search, state, reader);
  const annotationLayers = collectAnnotationLayers(spread, engines, state, reader);
  const layers = mergeOverlayLayers(selectionRects, searchRects, [], annotationLayers);
  overlay.render(layers);
}

function collectSearchRects(
  spread: Spread,
  search: SearchEngine,
  state: CoordinatorState,
  reader: Reader,
): readonly Rect[] {
  const rects: Rect[] = [];
  for (const page of pagesOf(spread)) {
    const hitMap = state.hitMaps.get(page.index);
    if (hitMap) rects.push(...search.getHighlightRects(page.index, hitMap, reader.measurer));
  }
  return rects;
}

function collectAnnotationLayers(
  spread: Spread,
  engines: CoordinatorEngines,
  state: CoordinatorState,
  reader: Reader,
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
          rects: data.rects,
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
