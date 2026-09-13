/**
 * Spread-level coordination: rebuilds interaction state and marks overlay dirty
 * whenever a spread is rendered or needs a visual refresh.
 */
import type { Spread } from '@ritojs/core';
import type { Reader } from '@ritojs/core';
import type { PositionTracker } from '../../interaction/index';
import type { DisposableCollection } from '../../utils/disposable';
import { createCoordinateMapper } from '../geometry/coordinate-mapper';
import type { CoordinatorEngines, CoordinatorState } from '../core/coordinator-state';
import type { WiringDeps } from '../core/wiring-deps';
import {
  invalidateNativeAnnotationGeometry,
  refreshNativeAnnotations,
  scheduleNativeAnnotationsForSpread,
  syncChapterIndices,
} from '../annotation-resolution';
import { invalidateNativeTargets, loadNativeTargetsForSpread } from './native-targets';
import { scheduleNativeSearchForSpread } from './native-search';
import { withSelectionGestureProjection } from '../../interaction/selection/selection-interaction-owner';

export function coordinateOnSpreadRendered(
  spreadIndex: number,
  spread: Spread,
  engines: CoordinatorEngines,
  reader: Reader,
  state: CoordinatorState,
  renderScale: number,
): boolean {
  const generation = ++state.spreadCoordinationGeneration;
  const mapper = createCoordinateMapper(reader.getLayoutGeometry(), spread, renderScale);
  state.mapper = mapper;
  const transfer = state.selectionProjectionTransfer;
  if (transfer?.targetSpreadIndex === spreadIndex) {
    withSelectionGestureProjection(engines.selection, transfer.gesture, () => {
      engines.selection.setSpread(mapper);
    });
  } else {
    engines.selection.setSpread(mapper);
  }
  if (generation !== state.spreadCoordinationGeneration) return false;

  syncChapterIndices(state, reader);
  if (state.annotationStore) refreshNativeAnnotations(reader, state);

  updatePosition(spreadIndex, engines.position, state);
  return generation === state.spreadCoordinationGeneration;
}

function updatePosition(
  spreadIndex: number,
  tracker: PositionTracker | null,
  state: CoordinatorState,
): void {
  const mode = state.positionUpdateMode;
  state.positionUpdateMode = { kind: 'capture' };
  if (!tracker) return;
  if (mode.kind === 'skip') {
    if (
      mode.spreadIndex === spreadIndex &&
      (mode.intent === undefined || tracker.owns(mode.intent))
    ) {
      return;
    }
    tracker.update(spreadIndex);
    return;
  }
  if (mode.kind === 'preserve') {
    const projected = tracker.project(mode.position);
    if (mode.intent) tracker.commit(mode.intent, projected);
    else tracker.setCurrent(projected);
    return;
  }
  tracker.update(spreadIndex);
}

export function wireSpreadRendered(deps: WiringDeps, disposables: DisposableCollection): void {
  disposables.add(
    deps.reader.onSpreadRendered((idx, spread) => {
      if (idx !== deps.getCurrentSpread()) return;
      const coordinated = coordinateOnSpreadRendered(
        idx,
        spread,
        deps.engines,
        deps.reader,
        deps.coordState,
        deps.getRenderScale(),
      );
      if (!coordinated || idx !== deps.getCurrentSpread()) return;
      const currentSpread = deps.reader.spreads[idx];
      if (!currentSpread) return;
      scheduleNativeTargetLoad(currentSpread, deps);
      scheduleNativeAnnotationLoad(currentSpread, deps);
      scheduleNativeSearchForSpread(currentSpread, deps);
      deps.frameDriver.markOverlayDirty(idx);
    }),
  );
  if (typeof deps.reader.onSpreadContentInvalidated === 'function') {
    disposables.add(
      deps.reader.onSpreadContentInvalidated((idx) => {
        if (deps.presentChapterLocalInvalidation(idx)) return;
        if (idx === deps.getCurrentSpread()) {
          invalidateNativeTargets(deps.coordState);
          if (!deps.reader.interactions?.enabled) {
            invalidateNativeAnnotationGeometry(deps.coordState);
            deps.emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
          }
          deps.canvas.style.cursor = '';
          const spread = deps.reader.spreads[idx];
          if (deps.reader.interactions?.enabled && spread) scheduleNativeTargetLoad(spread, deps);
          deps.syncViewport?.();
        }
        deps.frameDriver.markContentDirty(idx);
        deps.notifyNavigationContentReady(idx);
      }),
    );
  }
  disposables.add(() => {
    deps.coordState.nativeInteractionsAlive = false;
    invalidateNativeTargets(deps.coordState);
    invalidateNativeAnnotationGeometry(deps.coordState);
    deps.canvas.style.cursor = '';
  });
}

function scheduleNativeAnnotationLoad(spread: Spread, deps: WiringDeps): void {
  scheduleNativeAnnotationsForSpread(
    spread,
    deps.reader,
    deps.coordState,
    () => {
      deps.frameDriver.markAllOverlaysDirty();
    },
    (error) => {
      deps.emitter.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        source: 'native-annotation-geometry',
      });
    },
  );
}

function scheduleNativeTargetLoad(spread: Spread, deps: WiringDeps): void {
  void loadNativeTargetsForSpread(spread, deps.reader, deps.coordState).catch((error: unknown) => {
    deps.emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source: 'native-interaction-targets',
    });
  });
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
