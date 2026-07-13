import type { Reader } from '@ritojs/core';
import type { FrameDriver } from '../../driver/frame-driver';
import type { ReadingPosition } from '../../interaction/index';
import { asLegacyPages } from '../compat/legacy-page';
import { syncCanvasSize } from './lifecycle';
import type { Emitter, Internals, LayoutActionsSlice, RuntimeComponents } from './types';
import {
  invalidateNativeAnnotationGeometry,
  refreshNativeAnnotations,
  resolveVisibleAnnotations,
  syncChapterIndices,
  usesNativeAnnotationGeometry,
} from '../annotation-resolution';

type ReaderThemeOptions = Parameters<Reader['setTheme']>[0];

export function buildLayoutActions(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
): LayoutActionsSlice {
  return {
    resize(width, height, margin): void {
      const anchor = currentPosition(internals);
      const changed = internals.reader.updateLayout(width, height, undefined, margin);
      refreshLayoutWhenChanged(changed, internals, emitter, runtime, anchor);
    },
    setSpreadMode(mode): void {
      const anchor = currentPosition(internals);
      const result = internals.reader.setSpreadMode(mode);
      refreshLayoutWhenChanged(didCommitSynchronously(result), internals, emitter, runtime, anchor);
    },
    setLineBreaking(lineBreaking): boolean {
      const anchor = currentPosition(internals);
      const changed = internals.reader.setLineBreaking(lineBreaking);
      return refreshLayoutWhenChanged(changed, internals, emitter, runtime, anchor);
    },
    setTheme(options: ReaderThemeOptions): void {
      internals.reader.setTheme(options);
      runtime.pool.invalidateAllContent();
      runtime.frameDriver.scheduleComposite();
    },
    setTypography(options): boolean {
      const anchor = currentPosition(internals);
      const changed = internals.reader.setTypography(options);
      return refreshLayoutWhenChanged(changed, internals, emitter, runtime, anchor);
    },
    setRenderScale(scale): void {
      applyRenderScale(scale, internals, runtime);
    },
    get renderScale() {
      return internals.renderScale;
    },
  };
}

function applyRenderScale(scale: number, internals: Internals, runtime: RuntimeComponents): void {
  requireRenderScale(scale);
  if (scale === internals.renderScale) return;
  internals.engines.selection.invalidate();
  internals.renderScale = scale;
  syncCanvasSize(internals, runtime);
  runtime.pool.invalidateAllContent();
  runtime.pool.assignSlot('curr', internals.currentSpread);
  runtime.frameDriver.scheduleComposite();
  internals.coordState.positionUpdateMode = {
    kind: 'skip',
    spreadIndex: internals.currentSpread,
  };
  internals.reader.notifyActiveSpread(internals.currentSpread);
}

function refreshLayoutWhenChanged(
  changed: boolean,
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
  anchor: ReadingPosition | null,
): boolean {
  if (!changed) return false;
  commitLayoutChange(internals, emitter, runtime, anchor);
  return true;
}

function didCommitSynchronously(result: unknown): boolean {
  return result !== false;
}

/** Commit either a synchronous layout update or an async Rust revision callback. */
export function commitLayoutChange(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
  anchor?: ReadingPosition | null,
  committedSpreadIndex?: number,
): void {
  const tracker = internals.engines.position;
  const positionPlan = tracker?.prepareLayoutCommit(
    anchor,
    committedSpreadIndex ?? internals.currentSpread,
  );
  const preserved = positionPlan?.kind === 'legacy' ? positionPlan.position : null;
  const clearedNativeAnnotationHover = usesNativeAnnotationGeometry(internals.reader);
  if (clearedNativeAnnotationHover) invalidateNativeAnnotationGeometry(internals.coordState);
  const previousSpread = internals.currentSpread;
  internals.currentSpread =
    committedSpreadIndex === undefined
      ? resolveCommittedSpread(internals, preserved)
      : clampSpreadIndex(internals, committedSpreadIndex);
  syncCanvasSize(internals, runtime);
  runtime.pool.invalidateAllContent();
  runtime.pool.assignSlot('curr', internals.currentSpread);
  runtime.td.reset();
  const committedSpread = internals.currentSpread;
  if (positionPlan?.kind === 'portable') {
    internals.coordState.positionUpdateMode = { kind: 'skip', spreadIndex: committedSpread };
  } else if (preserved && positionPlan) {
    internals.coordState.positionUpdateMode = {
      kind: 'preserve',
      position: preserved,
      intent: positionPlan.intent,
    };
  } else {
    internals.coordState.positionUpdateMode = { kind: 'capture' };
  }
  internals.reader.notifyActiveSpread(committedSpread);
  internals.engines.selection.invalidate();
  internals.engines.search.setPages(asLegacyPages(internals.reader.pages));
  runtime.frameDriver.compositeNow();

  if (clearedNativeAnnotationHover) {
    emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
  }
  emitLayoutChange(internals, emitter);
  emitCommittedSpreadChangeIfCurrent(internals, emitter, previousSpread, committedSpread);
}

/** Publishes a larger known extent without resetting stable layout or transition state. */
export function publishPaginationChange(
  internals: Internals,
  emitter: Emitter,
  frameDriver: Pick<FrameDriver, 'markAllOverlaysDirty'>,
): void {
  internals.engines.selection.invalidate();
  internals.engines.search.setPages(asLegacyPages(internals.reader.pages));
  syncChapterIndices(internals.coordState, internals.reader);
  const clearedNativeAnnotationHover = refreshPaginationAnnotations(internals);
  frameDriver.markAllOverlaysDirty();
  if (clearedNativeAnnotationHover) {
    emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
  }
  emitLayoutChange(internals, emitter);
}

function refreshPaginationAnnotations(internals: Internals): boolean {
  const store = internals.coordState.annotationStore;
  if (!store) return false;
  if (usesNativeAnnotationGeometry(internals.reader)) {
    invalidateNativeAnnotationGeometry(internals.coordState);
    refreshNativeAnnotations(internals.reader, internals.coordState);
    return true;
  }
  internals.coordState.resolvedAnnotations = resolveVisibleAnnotations(
    store,
    internals.coordState,
    internals.reader,
  );
  return false;
}

export function requireRenderScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('Reader controller renderScale must be a positive finite number');
  }
}

function resolveCommittedSpread(internals: Internals, anchor: ReadingPosition | null): number {
  const resolved = anchor ? internals.engines.position?.resolve(anchor) : undefined;
  return clampSpreadIndex(internals, resolved ?? internals.currentSpread);
}

function clampSpreadIndex(internals: Internals, spreadIndex: number): number {
  return Math.max(0, Math.min(spreadIndex, internals.reader.totalSpreads - 1));
}

function currentPosition(internals: Internals): ReadingPosition | null {
  return internals.engines.position?.getPreservableCurrent() ?? null;
}

function emitLayoutChange(internals: Internals, emitter: Emitter): void {
  emitter.emit('layoutChange', {
    spreads: internals.reader.spreads,
    totalSpreads: internals.reader.totalSpreads,
  });
}

function emitCommittedSpreadChangeIfCurrent(
  internals: Internals,
  emitter: Emitter,
  previousSpread: number,
  committedSpread: number,
): void {
  if (internals.currentSpread !== committedSpread || committedSpread === previousSpread) return;
  const spread = internals.reader.spreads[committedSpread];
  if (spread) emitter.emit('spreadChange', { spreadIndex: committedSpread, spread });
}
