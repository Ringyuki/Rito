import type { TextRun } from '../../layout/core/types';
import { buildFontString } from './font-string';
import { resolveTextColor } from '../../utils/color';
import { drawTextShadows } from './text-shadow';

/**
 * Draw a single text run onto a canvas context.
 * The caller is responsible for coordinate offsets (margins, block position).
 *
 * @param colorOverride - If provided, `{ foregroundColor, backgroundColor }` triggers
 *   contrast-based color replacement for theme support (e.g. dark mode).
 */
export function drawTextRun(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  offsetX: number,
  offsetY: number,
  colorOverride?: { foregroundColor: string; backgroundColor: string },
): void {
  ctx.font = buildFontString(run.style);

  const color = colorOverride
    ? resolveTextColor(
        run.style.color,
        colorOverride.backgroundColor,
        colorOverride.foregroundColor,
      )
    : run.style.color;

  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.wordSpacing = run.style.wordSpacing !== 0 ? `${String(run.style.wordSpacing)}px` : '';
  ctx.letterSpacing = run.style.letterSpacing !== 0 ? `${String(run.style.letterSpacing)}px` : '';

  const x = offsetX + run.bounds.x;
  const y = offsetY + run.bounds.y;

  // Inline background color (e.g. <span> with background-color)
  if (run.style.backgroundColor) {
    ctx.fillStyle = run.style.backgroundColor;
    ctx.fillRect(x, y, run.bounds.width, run.bounds.height);
    ctx.fillStyle = color;
  }

  if (run.style.textShadow.length > 0) {
    drawTextShadows(ctx, run, x, y, color);
  }

  ctx.fillText(run.text, x, y);

  if (run.style.textDecoration === 'underline') {
    drawLine(ctx, x, y + run.style.fontSize, run.bounds.width, color);
  } else if (run.style.textDecoration === 'line-through') {
    drawLine(ctx, x, y + run.style.fontSize * 0.5, run.bounds.width, color);
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
