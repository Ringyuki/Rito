import type { AnyRenderingContext, OverlayLayer, Rect } from './types';

/** An underline's thickness, in CSS pixels. */
const UNDERLINE_WIDTH = 2;

/**
 * Paint overlay layers into a target canvas context.
 *
 * Pure function — does not create or own any canvas.
 * The caller provides the target context (typically an OffscreenCanvas sub-buffer).
 *
 * @param ctx - The rendering context to paint into.
 * @param layers - Overlay layers sorted by zIndex (selection, search, annotations).
 * @param backingRatio - Combined pixel ratio (renderScale × DPR) applied to coordinates.
 */
export function paintOverlayInto(
  ctx: AnyRenderingContext,
  layers: readonly OverlayLayer[],
  backingRatio: number,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  if (layers.length === 0) return;

  ctx.save();
  ctx.scale(backingRatio, backingRatio);

  const sorted = layers.length > 1 ? [...layers].sort((a, b) => a.zIndex - b.zIndex) : layers;

  for (const layer of sorted) {
    ctx.fillStyle = layer.color;
    for (const rect of layer.rects) {
      if (layer.mark === 'underline') fillUnderline(ctx, rect);
      else ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    if (layer.borderColor) {
      ctx.strokeStyle = layer.borderColor;
      ctx.lineWidth = 1;
      for (const rect of layer.rects) {
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      }
    }
  }

  ctx.restore();
}

function fillUnderline(ctx: AnyRenderingContext, rect: Rect): void {
  const width = Math.min(UNDERLINE_WIDTH, rect.height);
  ctx.fillRect(rect.x, rect.y + rect.height - width, rect.width, width);
}
