import type { ReadingPosition } from '@ritojs/core/position';
import type { ReaderThemeOptions } from '@ritojs/core/web';
import { syncCanvasSize } from './lifecycle';
import type { Internals, Emitter, RuntimeComponents, LayoutActionsSlice } from './types';

export function buildLayoutActions(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
): LayoutActionsSlice {
  return {
    resize(w: number, h: number, margin?: number): void {
      const anchor = currentPosition(internals);
      const changed = internals.reader.updateLayout(w, h, undefined, margin);
      refreshLayoutWhenChanged(changed, internals, emitter, runtime, anchor);
    },
    setSpreadMode(mode: 'single' | 'double'): void {
      const anchor = currentPosition(internals);
      internals.reader.setSpreadMode(mode);
      emitLayoutChange(internals, emitter, runtime, anchor);
    },
    setLineBreaking(lineBreaking: 'greedy' | 'optimal'): boolean {
      const anchor = currentPosition(internals);
      const changed = internals.reader.setLineBreaking(lineBreaking);
      return refreshLayoutWhenChanged(changed, internals, emitter, runtime, anchor);
    },
    setTheme(opts: ReaderThemeOptions): void {
      internals.reader.setTheme(opts);
      runtime.pool.invalidateAllContent();
      runtime.frameDriver.scheduleComposite();
    },
    setTypography(opts: {
      fontSize?: number | null;
      lineHeight?: number | null;
      lineHeightForce?: boolean;
      fontFamily?: string | null;
      fontFamilyForce?: boolean;
    }): boolean {
      const anchor = currentPosition(internals);
      const changed = internals.reader.setTypography(opts);
      return refreshLayoutWhenChanged(changed, internals, emitter, runtime, anchor);
    },
    setRenderScale(scale: number): void {
      applyRenderScale(scale, internals, runtime);
    },
    get renderScale() {
      return internals.renderScale;
    },
  };
}

function applyRenderScale(scale: number, internals: Internals, runtime: RuntimeComponents): void {
  if (scale === internals.renderScale) return;
  internals.renderScale = scale;
  syncCanvasSize(internals, runtime);
  runtime.pool.invalidateAllContent();
  runtime.pool.assignSlot('curr', internals.currentSpread);
  runtime.frameDriver.scheduleComposite();
  // Rebuild coordinator (mapper uses renderScale for coordinate projection)
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
  emitLayoutChange(internals, emitter, runtime, anchor);
  return true;
}

function emitLayoutChange(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
  anchor: ReadingPosition | null = null,
): void {
  const previousSpread = internals.currentSpread;
  const maxSpreadIndex = Math.max(0, internals.reader.totalSpreads - 1);
  const resolvedSpread = anchor ? internals.engines.position?.resolve(anchor) : undefined;
  internals.currentSpread = Math.max(
    0,
    Math.min(resolvedSpread ?? internals.currentSpread, maxSpreadIndex),
  );
  syncCanvasSize(internals, runtime);
  runtime.pool.invalidateAllContent();
  runtime.pool.assignSlot('curr', internals.currentSpread);
  runtime.td.reset();
  runtime.frameDriver.scheduleComposite();
  emitter.emit('layoutChange', {
    spreads: internals.reader.spreads,
    totalSpreads: internals.reader.totalSpreads,
  });
  emitSpreadChangeIfNeeded(internals, emitter, previousSpread);
  if (anchor) internals.coordState.positionUpdateMode = { kind: 'preserve', position: anchor };
  internals.reader.notifyActiveSpread(internals.currentSpread);
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
