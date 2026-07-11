import { computeInlineBoxRect, traceInlineRoundedRect } from './inline-box';
import type { CanvasTextFragment } from './types';

type InlineFragment = Pick<CanvasTextFragment, 'rect' | 'paint'>;

export function drawInlineBackground(
  ctx: CanvasRenderingContext2D,
  fragment: InlineFragment,
): void {
  const color = fragment.paint.backgroundColor;
  if (!color) return;

  const rect = computeInlineBoxRect(fragment);
  const radius = fragment.paint.backgroundRadius ?? 0;
  ctx.save();
  try {
    ctx.fillStyle = color;
    if (radius > 0) {
      traceInlineRoundedRect(ctx, rect, radius);
      ctx.fill();
    } else {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  } finally {
    ctx.restore();
  }
}
