import type { CanvasTextFragment } from './types';

type InlineFragment = Pick<CanvasTextFragment, 'rect' | 'paint'>;
type InlineBoxRect = CanvasTextFragment['rect'];

/** Compute the content-height box used by inline backgrounds and borders. */
export function computeInlineBoxRect({ rect, paint }: InlineFragment): InlineBoxRect {
  const padding = paint.padding;
  const border = paint.border;
  const paddingLeft = padding?.left ?? 0;
  const paddingRight = padding?.right ?? 0;
  const paddingTop = padding?.top ?? 0;
  const paddingBottom = padding?.bottom ?? 0;
  const borderLeft = border?.start?.widthPx ?? 0;
  const borderRight = border?.end?.widthPx ?? 0;
  const borderTop = border?.top?.widthPx ?? 0;
  const borderBottom = border?.bottom?.widthPx ?? 0;

  return {
    x: rect.x - paddingLeft - borderLeft,
    y: rect.y - paddingTop - borderTop,
    width: rect.width + paddingLeft + paddingRight + borderLeft + borderRight,
    height: paint.font.sizePx + paddingTop + paddingBottom + borderTop + borderBottom,
  };
}

export function traceInlineRoundedRect(
  ctx: CanvasRenderingContext2D,
  { x, y, width, height }: InlineBoxRect,
  radius: number,
): void {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + resolvedRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, resolvedRadius);
  ctx.arcTo(x + width, y + height, x, y + height, resolvedRadius);
  ctx.arcTo(x, y + height, x, y, resolvedRadius);
  ctx.arcTo(x, y, x + width, y, resolvedRadius);
  ctx.closePath();
}
