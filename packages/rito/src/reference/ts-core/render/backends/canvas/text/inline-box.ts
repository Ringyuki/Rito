import type { Rect, RunPaint } from '../../../../layout/core/types';

export interface InlineBoxRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface InlineBoxInput {
  readonly rect: Rect;
  readonly paint: RunPaint;
}

/**
 * Compute the inline-box rect (background/border area) for a text run.
 * Line-height is excluded: inline decorations follow the CSS content
 * area, which the browser sizes as the run font's grid-fit envelope
 * (canvas `fontBoundingBox` around the baseline); the em box stands in
 * when the context or its metrics are unavailable.
 */
export function computeInlineBoxRect(
  { rect, paint }: InlineBoxInput,
  ctx?: CanvasRenderingContext2D,
): InlineBoxRect {
  const padding = paint.padding;
  const border = paint.border;
  const pl = padding?.left ?? 0;
  const pr = padding?.right ?? 0;
  const pt = padding?.top ?? 0;
  const pb = padding?.bottom ?? 0;
  const bl = border?.start?.widthPx ?? 0;
  const br = border?.end?.widthPx ?? 0;
  const bt = border?.top?.widthPx ?? 0;
  const bb = border?.bottom?.widthPx ?? 0;
  const size = paint.font.sizePx;
  let contentTop = rect.y;
  let contentHeight = size;
  const metrics = ctx?.measureText('x');
  if (
    metrics &&
    Number.isFinite(metrics.fontBoundingBoxAscent) &&
    Number.isFinite(metrics.fontBoundingBoxDescent)
  ) {
    contentTop = rect.y + 0.8 * size - metrics.fontBoundingBoxAscent;
    contentHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
  }
  return {
    x: rect.x - pl - bl,
    y: contentTop - pt - bt,
    width: rect.width + pl + pr + bl + br,
    height: contentHeight + pt + pb + bt + bb,
  };
}

export function traceInlineRoundedRect(
  ctx: CanvasRenderingContext2D,
  { x, y, width, height }: InlineBoxRect,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
