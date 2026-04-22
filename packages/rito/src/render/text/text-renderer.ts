import type { RubyAnnotation, TextRun } from '../../layout/core/types';
import { buildFontString } from './font-string';
import { resolveTextColor } from '../../utils/color';
import { drawInlineBackground } from './inline-background-renderer';
import { drawInlineBorders } from './inline-border-renderer';
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
  const paint = run.paint;
  ctx.font = buildFontString(paint.font);

  const color = colorOverride
    ? resolveTextColor(paint.color, colorOverride.backgroundColor, colorOverride.foregroundColor)
    : paint.color;

  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.wordSpacing = paint.wordSpacingPx !== undefined ? `${String(paint.wordSpacingPx)}px` : '';
  ctx.letterSpacing =
    paint.letterSpacingPx !== undefined ? `${String(paint.letterSpacingPx)}px` : '';

  const x = offsetX + run.bounds.x;
  const y = offsetY + run.bounds.y;

  drawInlineBackground(ctx, run, x, y);
  drawInlineBorders(ctx, run, x, y);

  if (paint.textShadow && paint.textShadow.length > 0) {
    drawTextShadows(ctx, run, x, y, color);
  }

  ctx.fillText(run.text, x, y);

  // Pre-computed decoration geometry — render just strokes the line.
  const decoration = paint.decoration;
  if (decoration) {
    drawLine(ctx, x, y + decoration.y, run.bounds.width, decoration.color, decoration.thickness);
  }
}

export function drawRubyAnnotation(
  ctx: CanvasRenderingContext2D,
  ruby: RubyAnnotation,
  offsetX: number,
  offsetY: number,
  colorOverride?: { foregroundColor: string; backgroundColor: string },
): void {
  const paint = ruby.paint;
  const color = colorOverride
    ? resolveTextColor(paint.color, colorOverride.backgroundColor, colorOverride.foregroundColor)
    : paint.color;
  ctx.save();
  ctx.font = buildFontString(paint.font);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  // Center the annotation horizontally over its pre-computed bounds.
  const measured = ctx.measureText(ruby.text);
  const rubyX = offsetX + ruby.bounds.x + (ruby.bounds.width - measured.width) / 2;
  const rubyY = offsetY + ruby.bounds.y;
  ctx.fillText(ruby.text, rubyX, rubyY);
  ctx.restore();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  color: string,
  thickness: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
}
