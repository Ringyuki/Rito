import type { Reader } from '@ritojs/core';
import type { ReadingPosition } from '../../interaction/index';
import { asLegacyPages } from '../compat/legacy-page';
import { syncCanvasSize } from './lifecycle';
import type { Emitter, Internals, LayoutActionsSlice, RuntimeComponents } from './types';
import {
  invalidateNativeAnnotationGeometry,
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
  internals.coordState.positionUpdateMode = { kind: 'skip' };
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
  anchor: ReadingPosition | null = currentPosition(internals),
): void {
  internals.engines.selection.invalidate();
  if (usesNativeAnnotationGeometry(internals.reader)) {
    invalidateNativeAnnotationGeometry(internals.coordState);
    emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
  }
  const previousSpread = internals.currentSpread;
  internals.engines.search.setPages(asLegacyPages(internals.reader.pages));
  internals.currentSpread = resolveCommittedSpread(internals, anchor);
  syncCanvasSize(internals, runtime);
  runtime.pool.invalidateAllContent();
  runtime.pool.assignSlot('curr', internals.currentSpread);
  runtime.td.reset();
  runtime.frameDriver.compositeNow();
  emitter.emit('layoutChange', {
    spreads: internals.reader.spreads,
    totalSpreads: internals.reader.totalSpreads,
  });
  emitSpreadChangeIfNeeded(internals, emitter, previousSpread);
  if (anchor) internals.coordState.positionUpdateMode = { kind: 'preserve', position: anchor };
  internals.reader.notifyActiveSpread(internals.currentSpread);
}

export function requireRenderScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('Reader controller renderScale must be a positive finite number');
  }
}

function resolveCommittedSpread(internals: Internals, anchor: ReadingPosition | null): number {
  const maxSpreadIndex = Math.max(0, internals.reader.totalSpreads - 1);
  const resolved = anchor ? internals.engines.position?.resolve(anchor) : undefined;
  return Math.max(0, Math.min(resolved ?? internals.currentSpread, maxSpreadIndex));
}

function currentPosition(internals: Internals): ReadingPosition | null {
  return internals.engines.position?.getCurrent() ?? null;
}

function emitSpreadChangeIfNeeded(
  internals: Internals,
  emitter: Emitter,
  previousSpread: number,
): void {
  if (internals.currentSpread === previousSpread) return;
  const spread = internals.reader.spreads[internals.currentSpread];
  if (spread) emitter.emit('spreadChange', { spreadIndex: internals.currentSpread, spread });
}
