/**
 * Spread-level coordination: rebuilds interaction state and overlay
 * whenever a spread is rendered or needs a visual refresh.
 */
import type { Reader, Spread } from 'rito';
import { buildHitMap, buildLinkMap } from 'rito/advanced';
import type { OverlayRenderer } from '../../overlay/types';
import type { DisposableCollection } from '../../utils/disposable';
import { mergeOverlayLayers } from '../overlay/merger';
import { createCoordinateMapper } from '../geometry/coordinate-mapper';
import { buildOverlayData } from '../overlay/projection';
import type { CoordinatorEngines, CoordinatorState } from '../core/coordinator-state';
import type { WiringDeps } from '../core/wiring-deps';
import { syncChapterIndices, resolveVisibleAnnotations } from '../annotation-resolution';

export function coordinateOnSpreadRendered(
  spreadIndex: number,
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  overlay: OverlayRenderer,
  state: CoordinatorState,
  renderScale: number,
): void {
  const mapper = createCoordinateMapper(reader.getLayoutGeometry(), spread, renderScale);
  state.mapper = mapper;

  engines.selection.setSpread(spread, mapper.selectionConfig, reader.measurer);
  rebuildHitMaps(spread, state);
  rebuildLinksByPage(spread, state);

  // Sync chapter text indices and re-resolve annotations from the store
  syncChapterIndices(state, reader);
  if (state.annotationStore) {
    state.resolvedAnnotations = resolveVisibleAnnotations(state.annotationStore, state, reader);
  }

  engines.position?.update(spreadIndex);

  renderOverlay(spread, engines, reader, overlay, state, renderScale);
}

export function refreshOverlay(
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  overlay: OverlayRenderer,
  state: CoordinatorState,
  renderScale: number,
): void {
  const mapper = createCoordinateMapper(reader.getLayoutGeometry(), spread, renderScale);
  state.mapper = mapper;
  renderOverlay(spread, engines, reader, overlay, state, renderScale);
}

function renderOverlay(
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  overlay: OverlayRenderer,
  state: CoordinatorState,
  renderScale: number,
): void {
  if (!state.mapper) return;
  const data = buildOverlayData(spread, engines, reader, state, state.mapper);
  const layers = mergeOverlayLayers(
    data.selectionRects,
    data.searchRects,
    data.activeSearchRects,
    data.annotationLayers,
  );
  overlay.render(layers, renderScale);
}

function rebuildHitMaps(spread: Spread, state: CoordinatorState): void {
  state.hitMaps.clear();
  for (const page of [spread.left, spread.right]) {
    if (page) state.hitMaps.set(page.index, buildHitMap(page));
  }
}

function rebuildLinksByPage(spread: Spread, state: CoordinatorState): void {
  state.linksByPage.clear();
  for (const page of [spread.left, spread.right]) {
    if (page) state.linksByPage.set(page.index, buildLinkMap(page));
  }
}

export function wireSpreadRendered(deps: WiringDeps, disposables: DisposableCollection): void {
  disposables.add(
    deps.reader.onSpreadRendered((idx, spread) => {
      coordinateOnSpreadRendered(
        idx,
        spread,
        deps.engines,
        deps.reader,
        deps.overlay,
        deps.coordState,
        deps.getRenderScale(),
      );
    }),
  );
}

export function refreshCurrentOverlay(deps: WiringDeps): void {
  const spread = deps.reader.spreads[deps.getCurrentSpread()];
  if (!spread) return;
  refreshOverlay(
    spread,
    deps.engines,
    deps.reader,
    deps.overlay,
    deps.coordState,
    deps.getRenderScale(),
  );
}
