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
  declaredGround?: string,
): void {
  const paint = fragment.paint;
  ctx.font = buildFontString(paint.font);

  // R2: ink is only re-resolved when its ground is theme-supplied; a
  // declared ground means the color pair was the typesetter's choice.
  const color =
    colorOverride && declaredGround === undefined
      ? resolveTextColor(paint.color, colorOverride.backgroundColor, colorOverride.foregroundColor)
      : paint.color;

  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.wordSpacing = canvasSpacingValue(paint.wordSpacingPx);
  ctx.letterSpacing = canvasSpacingValue(paint.letterSpacingPx);

  const x = fragment.rect.x;
  const y = fragment.rect.y;
  const mainBaseline = y + 0.8 * paint.font.sizePx;

  drawInlineBackground(ctx, fragment);
  drawInlineBorders(ctx, fragment);

  if (paint.textShadow && paint.textShadow.length > 0) {
    drawTextShadows(ctx, fragment, x, y, color);
  }

  // Fractional font sizes drift off Blink's LayoutUnit grid; each glyph
  // then paints at floor64 of the float cumulative advance (mirrors the
  // production pen — both pens change together).
  if ((paint.font.sizePx * 64) % 1 !== 0 && !paint.wordSpacingPx) {
    const previousSpacing = ctx.letterSpacing;
    ctx.letterSpacing = '0px';
    const spacingPx = paint.letterSpacingPx ?? 0;
    let cumulative = 0;
    let index = 0;
    for (const glyph of fragment.text) {
      const snapped = Math.floor((cumulative + spacingPx * index) * 64) / 64;
      ctx.fillText(glyph, x + snapped, mainBaseline);
      cumulative += ctx.measureText(glyph).width;
      index += 1;
    }
    ctx.letterSpacing = previousSpacing;
  } else {
    ctx.fillText(fragment.text, x, mainBaseline);
  }

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
  declaredGround?: string,
): void {
  const paint = ruby.paint;
  const color =
    colorOverride && declaredGround === undefined
      ? resolveTextColor(paint.color, colorOverride.backgroundColor, colorOverride.foregroundColor)
      : paint.color;
  ctx.save();
  ctx.font = buildFontString(paint.font);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.wordSpacing = '0px';
  ctx.letterSpacing = '0px';
  const measured = ctx.measureText(ruby.text);
  const glyphs = [...ruby.text].length;
  const free = ruby.rect.width - measured.width;
  // `ruby-align: space-around` on the annotation, mirroring the browser
  // frame-command renderer: the free width splits into one share per
  // glyph, half a share at each edge; a wide annotation (free ≈ 0)
  // reduces to the packed centering it always had.
  if (glyphs > 1 && free > 0.01) {
    ctx.letterSpacing = `${free / glyphs}px`;
    ctx.fillText(ruby.text, ruby.rect.x + free / (2 * glyphs), ruby.rect.y);
  } else {
    const rubyX = ruby.rect.x + (ruby.rect.width - measured.width) / 2;
    ctx.fillText(ruby.text, rubyX, ruby.rect.y);
  }
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
