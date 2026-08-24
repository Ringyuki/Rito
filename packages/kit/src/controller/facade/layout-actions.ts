import type { Reader } from '@ritojs/core';
import type { FrameDriver } from '../../driver/frame-driver';
import type { ReadingPosition } from '../../interaction/index';
import type { LayoutPositionPlan } from '../../interaction/position/tracker';
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
import { invalidateNativeSearchLayout, usesNativeSearchGeometry } from '../search-resolution';

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
      runtime.refreshChapterLocalTheme?.();
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
  const finishChapterLocalTransition = runtime.terminateChapterLocalForLayout?.();
  try {
    invalidateSelectionForLayout(internals);
    internals.renderScale = scale;
    syncCanvasSize(internals, runtime);
    runtime.pool.invalidateAllContent();
    runtime.pool.assignSlot('curr', internals.currentSpread);
    internals.coordState.positionUpdateMode = {
      kind: 'skip',
      spreadIndex: internals.currentSpread,
    };
    if (finishChapterLocalTransition) {
      runtime.frameDriver.compositeNow();
      internals.reader.notifyActiveSpread(internals.currentSpread);
    } else {
      runtime.frameDriver.scheduleComposite();
      internals.reader.notifyActiveSpread(internals.currentSpread);
    }
  } finally {
    finishChapterLocalTransition?.();
  }
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
  const finishChapterLocalTransition = runtime.terminateChapterLocalForLayout?.();
  const previousSpread = internals.currentSpread;
  let mutation: LayoutCommitMutation;
  try {
    mutation = applyLayoutCommitMutation(internals, runtime, anchor, committedSpreadIndex);
  } finally {
    finishChapterLocalTransition?.();
  }

  if (mutation.clearedNativeAnnotationHover) {
    emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
  }
  emitLayoutChange(internals, emitter);
  emitCommittedSpreadChangeIfCurrent(internals, emitter, previousSpread, mutation.committedSpread);
}

interface LayoutCommitMutation {
  readonly committedSpread: number;
  readonly clearedNativeAnnotationHover: boolean;
}

function applyLayoutCommitMutation(
  internals: Internals,
  runtime: RuntimeComponents,
  anchor: ReadingPosition | null | undefined,
  committedSpreadIndex: number | undefined,
): LayoutCommitMutation {
  const tracker = internals.engines.position;
  const positionPlan = tracker?.prepareLayoutCommit(
    anchor,
    committedSpreadIndex ?? internals.currentSpread,
  );
  const preserved = positionPlan?.kind === 'legacy' ? positionPlan.position : null;
  const clearedNativeAnnotationHover = invalidateNativeLayoutGeometry(internals);
  internals.currentSpread =
    committedSpreadIndex === undefined
      ? resolveCommittedSpread(internals, preserved)
      : clampSpreadIndex(internals, committedSpreadIndex);
  syncCanvasSize(internals, runtime);
  runtime.pool.invalidateAllContent();
  runtime.pool.assignSlot('curr', internals.currentSpread);
  runtime.td.reset();
  const committedSpread = internals.currentSpread;
  installLayoutPositionMode(internals, positionPlan, preserved, committedSpread);
  invalidateSelectionForLayout(internals);
  if (internals.currentSpread === committedSpread) {
    internals.reader.notifyActiveSpread(committedSpread);
  }
  internals.engines.search.setPages(asLegacyPages(internals.reader.pages));
  runtime.frameDriver.compositeNow();
  return { committedSpread, clearedNativeAnnotationHover };
}

function installLayoutPositionMode(
  internals: Internals,
  positionPlan: LayoutPositionPlan | undefined,
  preserved: ReadingPosition | null,
  committedSpread: number,
): void {
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
}

/** Publishes a larger known extent without resetting stable layout or transition state. */
export function publishPaginationChange(
  internals: Internals,
  emitter: Emitter,
  frameDriver: Pick<FrameDriver, 'markAllOverlaysDirty'>,
): void {
  internals.engines.selection.acceptRevisionAppend();
  if (usesNativeSearchGeometry(internals.reader)) {
    invalidateNativeSearchLayout(internals.coordState);
  }
  internals.engines.search.setPages(asLegacyPages(internals.reader.pages));
  syncChapterIndices(internals.coordState, internals.reader);
  const clearedNativeAnnotationHover = refreshPaginationAnnotations(internals);
  frameDriver.markAllOverlaysDirty();
  if (clearedNativeAnnotationHover) {
    emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
  }
  emitLayoutChange(internals, emitter);
}

function invalidateSelectionForLayout(internals: Internals): void {
  internals.coordState.contentInteractionGeneration += 1;
  internals.coordState.selectionProjectionTransfer = null;
  internals.engines.selection.invalidate();
}

function invalidateNativeLayoutGeometry(internals: Internals): boolean {
  const clearedAnnotationHover = usesNativeAnnotationGeometry(internals.reader);
  if (clearedAnnotationHover) invalidateNativeAnnotationGeometry(internals.coordState);
  if (usesNativeSearchGeometry(internals.reader)) {
    invalidateNativeSearchLayout(internals.coordState);
  }
  return clearedAnnotationHover;
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
