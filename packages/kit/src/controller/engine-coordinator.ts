import type { Reader, Spread, Page } from 'rito';
import { createLayoutConfig } from 'rito';
import type { SelectionEngine } from 'rito/selection';
import type { SearchEngine } from 'rito/search';
import type { AnnotationEngine } from 'rito/annotations';
import type { PositionTracker } from 'rito/position';
import {
  buildHitMap,
  buildLinkMap,
  resolveAnnotationRects,
  getSelectionRects,
} from 'rito/advanced';
import type { HitMap, LinkRegion } from 'rito/advanced';
import type { OverlayRenderer } from '../overlay/types';
import { mergeOverlayLayers, OVERLAY_COLORS } from './overlay-merger';
import type { Rect } from '../overlay/types';
import { READER_DEFAULTS, type ControllerOptions } from './types';

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

export function coordinateOnSpreadRendered(
  spreadIndex: number,
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  overlay: OverlayRenderer,
  state: CoordinatorState,
  renderScale: number,
  options: ControllerOptions,
): void {
  const config = deriveConfig(reader, spread, options);
  syncSelectionEngine(spread, engines.selection, reader, config);
  rebuildHitMaps(spread, state);
  rebuildLinkRegions(spread, state);
  engines.position?.update(spreadIndex);
  refreshOverlayInternal(spread, engines, reader, overlay, state, renderScale, config);
}

export function refreshOverlay(
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  overlay: OverlayRenderer,
  state: CoordinatorState,
  renderScale: number,
  options: ControllerOptions,
): void {
  const config = deriveConfig(reader, spread, options);
  refreshOverlayInternal(spread, engines, reader, overlay, state, renderScale, config);
}

type LayoutConfig = ReturnType<typeof createLayoutConfig>;

function refreshOverlayInternal(
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  overlay: OverlayRenderer,
  state: CoordinatorState,
  renderScale: number,
  config: LayoutConfig,
): void {
  // Selection rects are in content-area space (no margins) — offset them
  const rawSelectionRects = engines.selection.getRects();
  const selectionRects = rawSelectionRects.map((r) =>
    offsetRect(r, config.marginLeft, config.marginTop),
  );
  const searchRects = collectRects(spread, config, state, (page, hitMap) =>
    engines.search.getHighlightRects(page.index, hitMap, reader.measurer),
  );
  const activeSearchRects = collectActiveSearchRects(spread, config, engines, state, reader);
  const annotationLayers = collectAnnotationLayers(spread, config, engines, state, reader);
  const layers = mergeOverlayLayers(
    selectionRects,
    searchRects,
    activeSearchRects,
    annotationLayers,
  );
  overlay.render(layers, renderScale);
}

function collectActiveSearchRects(
  spread: Spread,
  config: LayoutConfig,
  engines: CoordinatorEngines,
  state: CoordinatorState,
  reader: Reader,
): readonly Rect[] {
  const idx = engines.search.getActiveIndex();
  const results = engines.search.getResults();
  if (idx < 0 || idx >= results.length) return [];
  const active = results[idx];
  if (!active) return [];
  // Only highlight if the active result is on a page in this spread
  const hitMap = state.hitMaps.get(active.pageIndex);
  if (!hitMap) return [];
  const page =
    spread.left?.index === active.pageIndex
      ? spread.left
      : spread.right?.index === active.pageIndex
        ? spread.right
        : undefined;
  if (!page) return [];
  const { dx, dy } = getPageOffset(page, spread, config);
  const rects = getSelectionRects(hitMap, active.range, reader.measurer);
  return rects.map((r) => offsetRect(r, dx, dy));
}

function syncSelectionEngine(
  spread: Spread,
  selection: SelectionEngine,
  reader: Reader,
  config: LayoutConfig,
): void {
  // Workaround: resolvePageHit passes raw x/y to hitTest, but hitMap entries are
  // in content-area coords (no margins). We create a config in "content-viewport"
  // space where pageWidth = contentWidth. Pointer coords are also transformed to
  // this space: x = cssX/renderScale - marginLeft.
  //
  // For double mode, the "gap" between content areas in this space is:
  //   real marginRight + real spreadGap + real marginLeft = 2*margin + gap
  const contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
  const contentHeight = config.pageHeight - config.marginTop - config.marginBottom;

  if (config.spreadMode === 'double') {
    const contentGap = config.marginLeft + config.spreadGap + config.marginRight;
    const contentConfig = createLayoutConfig({
      width: 2 * contentWidth + contentGap,
      height: contentHeight,
      spread: 'double',
      spreadGap: contentGap,
    });
    selection.setSpread(spread, contentConfig, reader.measurer);
  } else {
    const contentConfig = createLayoutConfig({
      width: contentWidth,
      height: contentHeight,
      spread: 'single',
    });
    selection.setSpread(spread, contentConfig, reader.measurer);
  }
}

function deriveConfig(reader: Reader, spread: Spread, options: ControllerOptions): LayoutConfig {
  const size = reader.getCanvasSize();
  return createLayoutConfig({
    width: size.width,
    height: size.height,
    spread: spread.right !== undefined ? 'double' : 'single',
    margin: options.margin ?? READER_DEFAULTS.margin,
    spreadGap: options.spreadGap ?? READER_DEFAULTS.spreadGap,
  });
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

function offsetRect(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

function getPageOffset(
  page: Page,
  spread: Spread,
  config: LayoutConfig,
): { dx: number; dy: number } {
  const dx =
    page === spread.right
      ? config.pageWidth + config.spreadGap + config.marginLeft
      : config.marginLeft;
  const dy = config.marginTop;
  return { dx, dy };
}

function collectRects(
  spread: Spread,
  config: LayoutConfig,
  state: CoordinatorState,
  getRects: (page: Page, hitMap: HitMap) => readonly Rect[],
): readonly Rect[] {
  const result: Rect[] = [];
  for (const page of pagesOf(spread)) {
    const hitMap = state.hitMaps.get(page.index);
    if (!hitMap) continue;
    const { dx, dy } = getPageOffset(page, spread, config);
    for (const rect of getRects(page, hitMap)) {
      result.push(offsetRect(rect, dx, dy));
    }
  }
  return result;
}

function collectAnnotationLayers(
  spread: Spread,
  config: LayoutConfig,
  engines: CoordinatorEngines,
  state: CoordinatorState,
  reader: Reader,
): readonly { id: string; rects: readonly Rect[]; color: string }[] {
  const layers: { id: string; rects: readonly Rect[]; color: string }[] = [];
  for (const page of pagesOf(spread)) {
    const hitMap = state.hitMaps.get(page.index);
    if (!hitMap) continue;
    const { dx, dy } = getPageOffset(page, spread, config);
    for (const ann of engines.annotation.getForPage(page.index)) {
      const data = resolveAnnotationRects(ann, hitMap, reader.measurer);
      if (data.rects.length > 0) {
        layers.push({
          id: ann.id,
          rects: data.rects.map((r) => offsetRect(r, dx, dy)),
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
