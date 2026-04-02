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
  ctx.fillText(run.text, offsetX + run.bounds.x, offsetY + run.bounds.y);
}
