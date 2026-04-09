import { syncCanvasSize } from './lifecycle';
import type { Internals, Emitter, RuntimeComponents, LayoutActionsSlice } from './types';

export function buildLayoutActions(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
): LayoutActionsSlice {
  const emitLayoutChange = (): void => {
    internals.currentSpread = Math.min(internals.currentSpread, internals.reader.totalSpreads - 1);
    syncCanvasSize(internals, runtime);
    runtime.pool.invalidateAllContent();
    runtime.pool.assignSlot('curr', internals.currentSpread);
    runtime.td.reset();
    runtime.frameDriver.scheduleComposite();
    emitter.emit('layoutChange', {
      spreads: internals.reader.spreads,
      totalSpreads: internals.reader.totalSpreads,
    });
    internals.reader.notifyActiveSpread(internals.currentSpread);
  };

  return {
    resize(w: number, h: number, margin?: number): void {
      const changed = internals.reader.updateLayout(w, h, undefined, margin);
      if (!changed) return;
      emitLayoutChange();
    },
    setSpreadMode(mode: 'single' | 'double'): void {
      internals.reader.setSpreadMode(mode);
      emitLayoutChange();
    },
    setTheme(opts: { backgroundColor?: string; foregroundColor?: string }): void {
      internals.reader.setTheme(opts);
      runtime.pool.invalidateAllContent();
      runtime.frameDriver.scheduleComposite();
    },
    setTypography(opts: { fontSize?: number; lineHeight?: number; fontFamily?: string }): boolean {
      return internals.reader.setTypography(opts);
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
