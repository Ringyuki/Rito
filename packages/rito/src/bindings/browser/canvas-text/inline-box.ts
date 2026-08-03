import type { CanvasTextFragment } from './types';

type InlineFragment = Pick<CanvasTextFragment, 'rect' | 'paint'>;
type InlineBoxRect = CanvasTextFragment['rect'];

/**
 * Compute the content-height box used by inline backgrounds and borders.
 *
 * The browser covers an inline box's background from the run font's
 * grid-fit ascent to its descent around the baseline (canvas
 * `fontBoundingBox`), not the em box — a highlighted 20px chapter title
 * paints a 24px band. The context arrives with the run's font already
 * set, so the envelope is measured right off it; without a context (or
 * the metrics), the em box stands in. A paint carrying pre-snapped box
 * offsets supersedes the metric envelope: the layout side already
 * rounded the decorated box to device rows.
 *
 * The browser rasters a decorated box on whole device pixels — every
 * edge rounds independently (measured: a 4px border at x 80.65625
 * paints columns 81-84, not an anti-aliased fringe), so the final rect
 * snaps each edge here.
 */
export function computeInlineBoxRect(
  { rect, paint }: InlineFragment,
  ctx?: CanvasRenderingContext2D,
): InlineBoxRect {
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

  let top: number;
  let bottom: number;
  if (paint.box) {
    top = rect.y + paint.box.topPx;
    bottom = rect.y + paint.box.bottomPx;
  } else {
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
    top = contentTop - paddingTop - borderTop;
    bottom = contentTop + contentHeight + paddingBottom + borderBottom;
  }
  const left = Math.round(rect.x - paddingLeft - borderLeft);
  const right = Math.round(rect.x + rect.width + paddingRight + borderRight);
  top = Math.round(top);
  bottom = Math.round(bottom);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
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
