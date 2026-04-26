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
 * Line-height is excluded: inline decorations follow the CSS content area.
 */
export function computeInlineBoxRect({ rect, paint }: InlineBoxInput): InlineBoxRect {
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
  return {
    x: rect.x - pl - bl,
    y: rect.y - pt - bt,
    width: rect.width + pl + pr + bl + br,
    height: paint.font.sizePx + pt + pb + bt + bb,
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
