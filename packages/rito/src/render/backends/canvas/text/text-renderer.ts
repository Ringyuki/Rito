import type { Rect, RunPaint } from '../../../../layout/core/types';
import { buildFontString } from './font-string';
import { resolveTextColor } from '../../../../utils/color';
import { drawInlineBackground } from './inline-background-renderer';
import { drawInlineBorders } from './inline-border-renderer';
import { drawTextShadows } from './text-shadow';
import { canvasSpacingValue } from './spacing';

export interface CanvasTextFragment {
  readonly text: string;
  readonly rect: Rect;
  readonly paint: RunPaint;
}

export interface CanvasRubyFragment {
  readonly text: string;
  readonly rect: Rect;
  readonly paint: RunPaint;
}

export function drawTextFragment(
  ctx: CanvasRenderingContext2D,
  fragment: CanvasTextFragment,
  colorOverride?: { foregroundColor: string; backgroundColor: string },
): void {
  const paint = fragment.paint;
  ctx.font = buildFontString(paint.font);

  const color = colorOverride
    ? resolveTextColor(paint.color, colorOverride.backgroundColor, colorOverride.foregroundColor)
    : paint.color;

  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.wordSpacing = canvasSpacingValue(paint.wordSpacingPx);
  ctx.letterSpacing = canvasSpacingValue(paint.letterSpacingPx);

  const x = fragment.rect.x;
  const y = fragment.rect.y;

  drawInlineBackground(ctx, fragment);
  drawInlineBorders(ctx, fragment);

  if (paint.textShadow && paint.textShadow.length > 0) {
    drawTextShadows(ctx, fragment, x, y, color);
  }

  ctx.fillText(fragment.text, x, y);

  // Pre-computed decoration geometry — render just strokes the line.
  const decoration = paint.decoration;
  if (decoration) {
    drawLine(ctx, x, y + decoration.y, fragment.rect.width, decoration.color, decoration.thickness);
  }
}

export function drawRubyFragment(
  ctx: CanvasRenderingContext2D,
  ruby: CanvasRubyFragment,
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
  ctx.wordSpacing = '0px';
  ctx.letterSpacing = '0px';
  // Center the annotation horizontally over its pre-computed bounds.
  const measured = ctx.measureText(ruby.text);
  const rubyX = ruby.rect.x + (ruby.rect.width - measured.width) / 2;
  const rubyY = ruby.rect.y;
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
