import type { TextRun } from '../../layout/core/types';
import { computeInlineBoxRect, traceInlineRoundedRect } from './inline-box';

export function drawInlineBackground(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  textX: number,
  textY: number,
): void {
  const color = run.paint.backgroundColor;
  if (!color) return;

  const rect = computeInlineBoxRect(run, textX, textY);
  const radius = run.paint.backgroundRadius ?? 0;
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
