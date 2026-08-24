import { computeInlineBoxRect, type InlineBoxInput, traceInlineRoundedRect } from './inline-box';

export function drawInlineBackground(
  ctx: CanvasRenderingContext2D,
  fragment: InlineBoxInput,
): void {
  const color = fragment.paint.backgroundColor;
  if (!color) return;

  const rect = computeInlineBoxRect(fragment, ctx);
  const radius = fragment.paint.backgroundRadius ?? 0;
  ctx.save();
  ctx.fillStyle = color;
  if (radius > 0) {
    traceInlineRoundedRect(ctx, rect, radius);
    ctx.fill();
  } else {
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.restore();
}
