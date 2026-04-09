import type { RenderOptions } from '../../render/core/types';
import { getSpreadDimensions, render } from '../../render/spread';
import type { ReaderState } from './types';

/** Rendering context type accepted by the spread renderer. */
type RenderingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Render a spread into an arbitrary 2D context.
 *
 * The caller is responsible for sizing `ctx.canvas` correctly.
 * The effective pixel ratio is derived from `ctx.canvas.width / config.viewportWidth`.
 *
 * Does NOT resize the canvas or fire onSpreadRendered listeners.
 */
export function renderSpreadToContext(
  state: ReaderState,
  ctx: RenderingContext,
  index: number,
): void {
  if (index < 0 || index >= state.spreads.length) {
    state.logger.warn(
      `renderSpreadTo: index ${String(index)} out of range [0, ${String(state.spreads.length)})`,
    );
    return;
  }

  const spread = state.spreads[index];
  if (!spread) return;

  const pixelRatio = ctx.canvas.width / state.config.viewportWidth;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const options: RenderOptions = {
    backgroundColor: state.bgColor,
    pixelRatio,
    images: state.resources.images,
    ...(state.fgColor ? { foregroundColor: state.fgColor } : {}),
  };
  render(spread, ctx, state.config, options);
}

/**
 * Render a spread onto the bound canvas (legacy path).
 *
 * Resizes the canvas, renders the spread, and fires onSpreadRendered listeners.
 */
export function renderSpreadToCanvas(
  state: ReaderState,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D,
  index: number,
  scale: number,
): void {
  if (index < 0 || index >= state.spreads.length) {
    state.logger.warn(
      `renderSpread: index ${String(index)} out of range [0, ${String(state.spreads.length)})`,
    );
    return;
  }

  const spread = state.spreads[index];
  if (!spread) return;

  // 1. Resize bound canvas
  const effectiveRatio = scale * state.dpr;
  const dims = getSpreadDimensions(state.config, effectiveRatio);
  canvas.width = dims.width;
  canvas.height = dims.height;

  // 2. Render (reuse the context-only function)
  renderSpreadToContext(state, ctx, index);

  // 3. Notify listeners
  for (const cb of state.spreadRenderedListeners) cb(index, spread);
}
