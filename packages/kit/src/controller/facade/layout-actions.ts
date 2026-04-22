import { syncCanvasSize } from './lifecycle';
import type { Internals, Emitter, RuntimeComponents, LayoutActionsSlice } from './types';

export function buildLayoutActions(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
): LayoutActionsSlice {
  return {
    resize(w: number, h: number, margin?: number): void {
      const changed = internals.reader.updateLayout(w, h, undefined, margin);
      if (!changed) return;
      emitLayoutChange(internals, emitter, runtime);
    },
    setSpreadMode(mode: 'single' | 'double'): void {
      internals.reader.setSpreadMode(mode);
      emitLayoutChange(internals, emitter, runtime);
    },
    setTheme(opts: { backgroundColor?: string; foregroundColor?: string }): void {
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
      const changed = internals.reader.setTypography(opts);
      if (!changed) return false;
      emitLayoutChange(internals, emitter, runtime);
      return true;
    },
    setRenderScale(scale: number): void {
      if (scale === internals.renderScale) return;
      internals.renderScale = scale;
      syncCanvasSize(internals, runtime);
      runtime.pool.invalidateAllContent();
      runtime.pool.assignSlot('curr', internals.currentSpread);
      runtime.frameDriver.scheduleComposite();
      // Rebuild coordinator (mapper uses renderScale for coordinate projection)
      internals.reader.notifyActiveSpread(internals.currentSpread);
    },
    get renderScale() {
      return internals.renderScale;
    },
  };
}

function emitLayoutChange(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
): void {
  const previousSpread = internals.currentSpread;
  const maxSpreadIndex = Math.max(0, internals.reader.totalSpreads - 1);
  internals.currentSpread = Math.min(internals.currentSpread, maxSpreadIndex);
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
  internals.reader.notifyActiveSpread(internals.currentSpread);
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
