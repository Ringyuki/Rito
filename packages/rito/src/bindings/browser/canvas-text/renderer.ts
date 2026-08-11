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
  const baseline = y + 0.8 * paint.font.sizePx;
  if (textRidesTheLayoutGrid(paint.font.sizePx, paint.wordSpacingPx, paint.letterSpacingPx)) {
    drawTextOnLayoutGrid(ctx, fragment.text, x, baseline);
  } else {
    ctx.fillText(fragment.text, x, baseline);
  }

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
    // packed centering it always had.
    if (glyphs > 1 && free > 0.01) {
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
 * Whether the run's glyph positions must be snapped onto Blink's
 * LayoutUnit grid glyph by glyph. At an INTEGER font size a CJK run's
 * float advances stay on the grid and one fillText is already
 * bit-identical to the DOM raster; a FRACTIONAL size (em cascades like
 * 0.95em of 16 → 15.2) drifts off it, and Blink paints each glyph at
 * floor64 of the float cumulative advance (measured: identical rasters
 * at integer positions, a 98px one-glyph divergence at x=20.4256).
 * SCOPE — NATURAL runs only: any letter spacing (author spacing or a
 * folded justify share) keeps the whole-run path, because the justify
 * phase basis is not yet aligned with the DOM's (the unrestricted
 * version net-regressed b20 by +0.7% through justified-line AA flips);
 * word-spacing runs also keep it (canvas applies wordSpacing
 * internally and manual placement would double it).
 */
function textRidesTheLayoutGrid(
  sizePx: number,
  wordSpacingPx: number | undefined,
  letterSpacingPx: number | undefined,
): boolean {
  return (sizePx * 64) % 1 !== 0 && !wordSpacingPx && !letterSpacingPx;
}

/**
 * Paints each glyph at floor64 of the float cumulative advance —
 * Blink's exact per-glyph placement rule (21/21 positions matched on
 * the 12.16px oracle line; per-glyph-rounded sums diverge). Kerning
 * between glyphs is dropped by per-glyph measurement — exact for CJK,
 * approximate for latin runs at fractional sizes.
 */
function drawTextOnLayoutGrid(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
): void {
  let cumulative = 0;
  for (const glyph of text) {
    const snapped = Math.floor(cumulative * 64) / 64;
    ctx.fillText(glyph, x + snapped, baseline);
    cumulative += ctx.measureText(glyph).width;
  }
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
