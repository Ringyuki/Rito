import { buildFontString } from './font-string';
import { drawInlineBackground } from './inline-background';
import { drawInlineBorders } from './inline-borders';
import { canvasSpacingValue } from './spacing';
import { drawTextShadows } from './text-shadow';
import type { CanvasRubyFragment, CanvasTextColorOverride, CanvasTextFragment } from './types';
import { resolveTextColor } from '../theme/text-color';

export function drawCanvasTextFragment(
  ctx: CanvasRenderingContext2D,
  fragment: CanvasTextFragment,
  colorOverride?: CanvasTextColorOverride,
  declaredGround?: string,
): void {
  const { paint } = fragment;
  ctx.font = buildFontString(paint.font);
  const color = effectiveTextColor(paint.color, colorOverride, declaredGround);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.wordSpacing = canvasSpacingValue(paint.wordSpacingPx);
  ctx.letterSpacing = canvasSpacingValue(paint.letterSpacingPx);

  const { x, y } = fragment.rect;
  drawInlineBackground(ctx, fragment);
  drawInlineBorders(ctx, fragment);
  if (paint.textShadow && paint.textShadow.length > 0) {
    drawTextShadows(ctx, fragment, x, y, color);
  }
  // Probed: canvas 'alphabetic' snaps the baseline to the nearest device
  // row and is then BIT-IDENTICAL to Blink's DOM text raster; 'top' never
  // matches at any sub-pixel phase. The rect's em-top encodes
  // baseline - 0.8*size (fragment_paint::CANVAS_TOP_ASCENT_RATIO).
  ctx.fillText(fragment.text, x, y + 0.8 * paint.font.sizePx);

  const { decoration } = paint;
  if (decoration) {
    drawLine(ctx, x, y + decoration.y, fragment.rect.width, decoration.color, decoration.thickness);
  }
}

export function drawCanvasRubyFragment(
  ctx: CanvasRenderingContext2D,
  ruby: CanvasRubyFragment,
  colorOverride?: CanvasTextColorOverride,
  declaredGround?: string,
): void {
  const { paint } = ruby;
  const color = effectiveTextColor(paint.color, colorOverride, declaredGround);
  ctx.save();
  try {
    ctx.font = buildFontString(paint.font);
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.wordSpacing = '0px';
    ctx.letterSpacing = '0px';
    const measured = ctx.measureText(ruby.text);
    const glyphs = [...ruby.text].length;
    const free = ruby.rect.width - measured.width;
    // `ruby-align: space-around` on the annotation (measured on the b96
    // long-base ruby: free 66.77px over 9 glyphs → 3.709px at each edge,
    // 7.418px between neighbours): the free width splits into one share
    // per glyph, half a share at each edge. A wide annotation's rect
    // already equals its own advance (free ≈ 0), so this reduces to the
    // packed centering it always had. A LATIN word annotation is ONE
    // justification unit — no intra-word expansion — so it centers whole
    // (measured on b20's ショウコ/Shouko rubies: natural-width word,
    // free/2 = 13.7px at each edge, interior steps natural 5.33px; the
    // per-glyph spread scattered the letters across the base).
    if (glyphs > 1 && free > 0.01 && rubyAnnotationExpands(ruby.text)) {
      ctx.letterSpacing = `${free / glyphs}px`;
      ctx.fillText(ruby.text, ruby.rect.x + free / (2 * glyphs), ruby.rect.y);
    } else {
      const x = ruby.rect.x + (ruby.rect.width - measured.width) / 2;
      ctx.fillText(ruby.text, x, ruby.rect.y);
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Whether the annotation text carries per-glyph justification
 * opportunities: CJK glyphs expand glyph-by-glyph; a pure non-CJK word
 * has none and centers as a unit (Blink's justify opportunity classes
 * applied inside the annotation box).
 */
function rubyAnnotationExpands(text: string): boolean {
  for (const glyph of text) {
    const code = glyph.codePointAt(0) ?? 0;
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x20000 && code <= 0x3ffff)
    ) {
      return true;
    }
  }
  return false;
}

function effectiveTextColor(
  originalColor: string,
  colorOverride: CanvasTextColorOverride | undefined,
  declaredGround: string | undefined,
): string {
  // R2: ink is only re-resolved when its ground is theme-supplied. A
  // declared ground (inline band, block fill, book-owned page) means
  // the foreground/background pair was the typesetter's choice — any
  // one-sided substitution would break it.
  if (!colorOverride || declaredGround !== undefined) return originalColor;
  return resolveTextColor(
    originalColor,
    colorOverride.backgroundColor,
    colorOverride.foregroundColor,
  );
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
