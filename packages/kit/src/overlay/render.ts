import type { OverlayLayer } from './types';

export function renderLayers(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  layers: readonly OverlayLayer[],
): void {
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.save();
  ctx.scale(dpr, dpr);

  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  for (const layer of sorted) {
    ctx.fillStyle = layer.color;
    for (const rect of layer.rects) {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
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
