import type { TextRun } from '../layout/types';
import { buildFontString } from './font-string';

/**
 * Draw a single text run onto a canvas context.
 * The caller is responsible for coordinate offsets (margins, block position).
 */
export function drawTextRun(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  offsetX: number,
  offsetY: number,
): void {
  ctx.font = buildFontString(run.style);
  ctx.fillStyle = run.style.color;
  ctx.textBaseline = 'top';

  const x = offsetX + run.bounds.x;
  const y = offsetY + run.bounds.y;
  ctx.fillText(run.text, x, y);

  // Draw text decoration
  if (run.style.textDecoration === 'underline') {
    drawLine(ctx, x, y + run.style.fontSize, run.bounds.width, run.style.color);
  } else if (run.style.textDecoration === 'line-through') {
    drawLine(ctx, x, y + run.style.fontSize * 0.5, run.bounds.width, run.style.color);
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
}
