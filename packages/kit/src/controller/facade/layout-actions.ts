import { syncCanvasSize } from './lifecycle';
import type { Internals, Emitter, Transition, Overlay, LayoutActionsSlice } from './types';

export function buildLayoutActions(
  internals: Internals,
  emitter: Emitter,
  transition: Transition,
  overlay: Overlay,
): LayoutActionsSlice {
  const emitLayoutChange = (): void => {
    internals.currentSpread = Math.min(internals.currentSpread, internals.reader.totalSpreads - 1);
    syncCanvasSize(internals, transition, overlay);
    emitter.emit('layoutChange', {
      spreads: internals.reader.spreads,
      totalSpreads: internals.reader.totalSpreads,
    });
    internals.reader.renderSpread(internals.currentSpread, internals.renderScale);
  };

  return {
    resize(w: number, h: number): void {
      const changed = internals.reader.updateLayout(w, h);
      if (!changed) return;
      emitLayoutChange();
    },
    setSpreadMode(mode: 'single' | 'double'): void {
      internals.reader.setSpreadMode(mode);
      emitLayoutChange();
    },
    setTheme(opts: { backgroundColor?: string; foregroundColor?: string }): void {
      internals.reader.setTheme(opts);
    },
    setTypography(opts: { fontSize?: number; lineHeight?: number; fontFamily?: string }): boolean {
      return internals.reader.setTypography(opts);
    },
    setRenderScale(scale: number): void {
      if (scale === internals.renderScale) return;
      internals.renderScale = scale;
      syncCanvasSize(internals, transition, overlay);
      internals.reader.renderSpread(internals.currentSpread, scale);
    },
    get renderScale() {
      return internals.renderScale;
    },
  };
}
