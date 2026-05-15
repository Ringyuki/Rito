/**
 * Spread-level coordination: rebuilds interaction state and marks overlay dirty
 * whenever a spread is rendered or needs a visual refresh.
 */
import type { Spread } from '@ritojs/core';
import type { Reader } from '@ritojs/core/web';
import { buildHitMap, buildLinkMap } from '@ritojs/core/advanced';
import type { PositionTracker } from '@ritojs/core/position';
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

  updatePosition(spreadIndex, engines.position, state);
}

function updatePosition(
  spreadIndex: number,
  tracker: PositionTracker | null,
  state: CoordinatorState,
): void {
  const mode = state.positionUpdateMode;
  state.positionUpdateMode = { kind: 'capture' };
  if (!tracker || mode.kind === 'skip') return;
  if (mode.kind === 'preserve') {
    tracker.setCurrent(tracker.project(mode.position));
    return;
  }
  tracker.update(spreadIndex);
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
