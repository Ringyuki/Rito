/**
 * Spread-level coordination: rebuilds interaction state and marks overlay dirty
 * whenever a spread is rendered or needs a visual refresh.
 */
import type { Reader, Spread } from '@rito/core';
import { buildHitMap, buildLinkMap } from '@rito/core/advanced';
import type { DisposableCollection } from '../../utils/disposable';
import { createCoordinateMapper } from '../geometry/coordinate-mapper';
import type { CoordinatorEngines, CoordinatorState } from '../core/coordinator-state';
import type { WiringDeps } from '../core/wiring-deps';
import { syncChapterIndices, resolveVisibleAnnotations } from '../annotation-resolution';

export function coordinateOnSpreadRendered(
  spreadIndex: number,
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  state: CoordinatorState,
  renderScale: number,
): void {
  const mapper = createCoordinateMapper(reader.getLayoutGeometry(), spread, renderScale);
  state.mapper = mapper;

  engines.selection.setSpread(spread, mapper.selectionConfig, reader.measurer);
  rebuildHitMaps(spread, state);
  rebuildLinksByPage(spread, state);

  syncChapterIndices(state, reader);
  if (state.annotationStore) {
    state.resolvedAnnotations = resolveVisibleAnnotations(state.annotationStore, state, reader);
  }

  engines.position?.update(spreadIndex);
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
        deps.coordState,
        deps.getRenderScale(),
      );
      deps.frameDriver.markOverlayDirty(deps.getCurrentSpread());
    }),
  );
}

export function refreshCurrentOverlay(deps: WiringDeps): void {
  const spread = deps.reader.spreads[deps.getCurrentSpread()];
  if (!spread) return;
  const mapper = createCoordinateMapper(
    deps.reader.getLayoutGeometry(),
    spread,
    deps.getRenderScale(),
  );
  deps.coordState.mapper = mapper;
  deps.frameDriver.markOverlayDirty(deps.getCurrentSpread());
}
