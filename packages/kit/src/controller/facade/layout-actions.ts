import type { Reader } from '@ritojs/core';
import type { ReadingPosition } from '../../interaction/index';
import type { LayoutPositionPlan } from '../../interaction/position/tracker';
import { commitCurrentSpread } from '../core/current-spread';
import { publishSpreadChange, publishedSpread, showsChapterAlone } from '../core/spread-change';
import { syncCanvasSize } from './lifecycle';
import type { Emitter, Internals, LayoutActionsSlice, RuntimeComponents } from './types';
import { invalidateNativeAnnotationGeometry } from '../annotation-resolution';
import { invalidateNativeSearchLayout } from '../search-resolution';
import { reportUnresolvedFontFamilies } from './font-actions';
import { abortTransition } from '../core/transition-lifecycle';
import { createResizeSettle, endResizeSettle, holdBookWhileResizing } from './resize-settle';
import type { Disposables } from './types';

type ReaderThemeOptions = Parameters<Reader['setTheme']>[0];

export function buildLayoutActions(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
  disposables: Disposables,
): LayoutActionsSlice {
  const settle = createResizeSettle();
  disposables.add(() => {
    endResizeSettle(settle);
  });
  return {
    resize(width, height, margin): void {
      holdBookWhileResizing(settle, internals.reader);
      const anchor = currentPosition(internals);
      const changed = internals.reader.updateLayout(width, height, undefined, margin);
      refreshLayoutWhenChanged(changed, internals, emitter, runtime, anchor);
    },
    setSpreadMode(mode): void {
      const anchor = currentPosition(internals);
      const result = internals.reader.setSpreadMode(mode);
      refreshLayoutWhenChanged(didCommitSynchronously(result), internals, emitter, runtime, anchor);
    },
    setTheme(options: ReaderThemeOptions): void {
      internals.reader.setTheme(options);
      runtime.pool.invalidateAllContent();
      runtime.frameDriver.scheduleComposite();
    },
    setTypography(options): boolean {
      const anchor = currentPosition(internals);
      const changed = internals.reader.setTypography(options);
      if (typeof options.fontFamily === 'string') {
        reportUnresolvedFontFamilies(internals, emitter, options.fontFamily);
      }
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
  invalidateSelectionForLayout(internals);
  internals.renderScale = scale;
  syncCanvasSize(internals, runtime);
  runtime.pool.invalidateAllContent();
  runtime.pool.assignSlot('curr', internals.currentSpread);
  internals.coordState.positionUpdateMode = {
    kind: 'skip',
    spreadIndex: internals.currentSpread,
  };
  runtime.frameDriver.scheduleComposite();
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
  const previousSpread = internals.currentSpread;
  const committedSpread = applyLayoutCommitMutation(
    internals,
    emitter,
    runtime,
    anchor,
    committedSpreadIndex,
  );

  emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
  emitLayoutChange(internals, emitter);
  emitCommittedSpreadChangeIfCurrent(internals, emitter, previousSpread, committedSpread);
  refreshSearchResults(internals);
}

/**
 * Search results name pages of the layout that was just replaced. They are
 * searched again in the new one — once it covers the whole book, the only
 * layout a search runs in.
 */
function refreshSearchResults(internals: Internals): void {
  const results = internals.coordState.searchResults;
  results.stale = true;
  if (!showsChapterAlone(internals.reader)) results.refresh?.();
}

function applyLayoutCommitMutation(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
  anchor: ReadingPosition | null | undefined,
  committedSpreadIndex: number | undefined,
): number {
  const tracker = internals.engines.position;
  const positionPlan = tracker?.prepareLayoutCommit(
    anchor,
    committedSpreadIndex ?? internals.currentSpread,
  );
  const preserved = positionPlan?.kind === 'synchronous' ? positionPlan.position : null;
  invalidateNativeAnnotationGeometry(internals.coordState);
  invalidateNativeSearchLayout(internals.coordState);
  commitCurrentSpread(
    internals,
    committedSpreadIndex === undefined
      ? resolveCommittedSpread(internals, preserved)
      : clampSpreadIndex(internals, committedSpreadIndex),
    'layout-commit',
  );
  syncCanvasSize(internals, runtime);
  runtime.pool.invalidateAllContent();
  runtime.pool.assignSlot('curr', internals.currentSpread);
  // A turn in flight cannot land on the old layout: it ends interrupted.
  abortTransition(runtime.td, emitter);
  const committedSpread = internals.currentSpread;
  installLayoutPositionMode(internals, positionPlan, preserved, committedSpread);
  invalidateSelectionForLayout(internals);
  if (internals.currentSpread === committedSpread) {
    internals.reader.notifyActiveSpread(committedSpread);
  }
  runtime.frameDriver.compositeNow();
  return committedSpread;
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

function invalidateSelectionForLayout(internals: Internals): void {
  internals.coordState.contentInteractionGeneration += 1;
  internals.coordState.selectionProjectionTransfer = null;
  internals.engines.selection.invalidate();
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
  // A chapter laid out alone is not a layout a host can count pages in.
  if (showsChapterAlone(internals.reader)) return;
  const layout = {
    spreads: internals.reader.spreads,
    totalSpreads: internals.reader.totalSpreads,
  };
  internals.coordState.publishedLayout = layout;
  emitter.emit('layoutChange', layout);
}

function emitCommittedSpreadChangeIfCurrent(
  internals: Internals,
  emitter: Emitter,
  previousSpread: number,
  committedSpread: number,
): void {
  // Compared with the spread hosts were last told of: turns made while a
  // chapter was laid out alone moved the reader without an event.
  const known = publishedSpread(emitter) ?? previousSpread;
  if (internals.currentSpread !== committedSpread || committedSpread === known) return;
  publishSpreadChange(emitter, internals.reader, committedSpread);
}
