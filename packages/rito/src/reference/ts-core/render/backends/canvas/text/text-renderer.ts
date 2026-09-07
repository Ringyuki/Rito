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
  /** The origin of every cluster (UTF-8 byte offset, CSS x) the engine
   * distributed over the base; absent draws the string packed. */
  readonly clusters?: readonly { readonly byte: number; readonly x: number; readonly y: number }[];
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
  // of a fully-CJK run then paints at floor64 of the float cumulative
  // advance (mirrors the production pen — both pens change together).
  // Non-CJK glyphs kern, so per-glyph measurement would misplace them;
  // those runs keep the whole-run path.
  const allCjk =
    fragment.text.length > 0 &&
    Array.from(fragment.text).every((glyph) => {
      const code = glyph.codePointAt(0) ?? 0;
      return (
        (code >= 0x2e80 && code <= 0x9fff) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xff00 && code <= 0xffef) ||
        (code >= 0x20000 && code <= 0x3ffff)
      );
    });
  if ((paint.font.sizePx * 64) % 1 !== 0 && !paint.wordSpacingPx && allCjk) {
    const previousSpacing = ctx.letterSpacing;
    ctx.letterSpacing = '0px';
    const spacingPx = paint.letterSpacingPx ?? 0;
    let cumulative = 0;
    let index = 0;
    for (const glyph of fragment.text) {
      // Mirrors the production pen: the cluster position floors on the
      // ABSOLUTE 1/64 grid (both pens change together).
      const snapped = Math.floor((x + cumulative + spacingPx * index) * 64) / 64;
      ctx.fillText(glyph, snapped, mainBaseline);
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
  // Mirrors the production pen (both pens change together): the engine
  // distributed the annotation over its base by the computed
  // `ruby-align` and sent every cluster's origin; each draws at its
  // origin from the box top, spacing off.
  const pieces = rubyClusterPieces(ruby.text, ruby.clusters ?? []);
  if (pieces.length > 0) {
    for (const piece of pieces) {
      ctx.fillText(piece.text, piece.x, piece.y);
    }
    ctx.restore();
    return;
  }
  // This reference engine's own annotations carry no origins: the
  // initial `ruby-align: space-around` distributes the free width one
  // share per glyph, half a share at each edge, and a Latin word
  // centers whole; a wide annotation (free ≈ 0) packs centered.
  const measured = ctx.measureText(ruby.text);
  const glyphs = Array.from(ruby.text).length;
  const free = ruby.rect.width - measured.width;
  const expands = Array.from(ruby.text).some((glyph) => {
    const code = glyph.codePointAt(0) ?? 0;
    return (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x20000 && code <= 0x3ffff)
    );
  });
  if (glyphs > 1 && free > 0.01 && expands) {
    ctx.letterSpacing = `${String(free / glyphs)}px`;
    ctx.fillText(ruby.text, ruby.rect.x + free / (2 * glyphs), ruby.rect.y);
  } else {
    const rubyX = Math.floor((ruby.rect.x + (ruby.rect.width - measured.width) / 2) * 64) / 64;
    ctx.fillText(ruby.text, rubyX, ruby.rect.y);
  }
  ctx.restore();
}

/** The annotation cut at its cluster origins: UTF-8 byte offsets into
 * the text, walked by code point for the canvas's UTF-16 strings. */
function rubyClusterPieces(
  text: string,
  clusters: readonly { readonly byte: number; readonly x: number; readonly y: number }[],
): { text: string; x: number; y: number }[] {
  const indexAtByte = new Map<number, number>();
  let byte = 0;
  let index = 0;
  for (const glyph of text) {
    indexAtByte.set(byte, index);
    byte += new TextEncoder().encode(glyph).length;
    index += glyph.length;
  }
  indexAtByte.set(byte, text.length);
  const pieces: { text: string; x: number; y: number }[] = [];
  for (let position = 0; position < clusters.length; position += 1) {
    const cluster = clusters[position];
    const next = clusters[position + 1];
    if (cluster === undefined) continue;
    const start = indexAtByte.get(cluster.byte);
    const end = next === undefined ? text.length : indexAtByte.get(next.byte);
    if (start === undefined || end === undefined) continue;
    pieces.push({ text: text.slice(start, end), x: cluster.x, y: cluster.y });
  }
  return pieces;
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
