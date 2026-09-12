import { buildFontString } from './font-string';
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
  // Every spacing is already in the cluster origins the engine sent.
  ctx.wordSpacing = '0px';
  ctx.letterSpacing = '0px';

  const { x, y } = fragment.rect;
  // Probed: canvas 'alphabetic' snaps the baseline to the nearest device
  // row and is then BIT-IDENTICAL to Blink's DOM text raster; 'top' never
  // matches at any sub-pixel phase. The rect's em-top encodes
  // baseline - 0.8*size (fragment_paint::CANVAS_TOP_ASCENT_RATIO).
  const baseline = y + 0.8 * paint.font.sizePx;
  const clusters = fragment.clusters;
  if (clusters !== undefined && clusters.length > 0) {
    // The engine placed every cluster — along a line or down a column,
    // spacing, justification shares and the browser's fixed-point
    // advances already in each origin — so the canvas draws one cluster
    // at a time at its own origin with its own spacing off.
    const pieces = clusterPieces(fragment.text, clusters);
    if (paint.textShadow && paint.textShadow.length > 0) {
      drawTextShadows(ctx, fragment, x, y, color, pieces);
    }
    for (const piece of pieces) {
      ctx.fillText(piece.text, piece.x, piece.y);
    }
    return;
  }
  if (paint.textShadow && paint.textShadow.length > 0) {
    drawTextShadows(ctx, fragment, x, y, color);
  }
  // A run that arrives without origins (a fixture written by hand)
  // draws as one string at the rect's start; no placement law lives
  // here.
  ctx.fillText(fragment.text, x, baseline);
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
    ctx.textBaseline = 'alphabetic';
    ctx.wordSpacing = '0px';
    ctx.letterSpacing = '0px';
    // The engine distributed the annotation over its base by the
    // computed `ruby-align` — across a horizontal base or down a
    // vertical one — and placed its line over the base: every cluster's
    // origin is its alphabetic baseline, exactly like a text run's, so
    // the canvas draws each at its origin with spacing off. A run that
    // arrives without origins draws as one string at the box's start,
    // its baseline 0.8 em below the rect's top like a text run's.
    const pieces = clusterPieces(ruby.text, ruby.clusters ?? []);
    if (pieces.length === 0) {
      ctx.fillText(ruby.text, ruby.rect.x, ruby.rect.y + 0.8 * paint.font.sizePx);
      return;
    }
    for (const piece of pieces) {
      ctx.fillText(piece.text, piece.x, piece.y);
    }
  } finally {
    ctx.restore();
  }
}

/**
 * The run's text cut at its cluster origins. Cluster boundaries are UTF-8
 * byte offsets into the run text; the canvas takes UTF-16 strings, so the
 * cut walks code points and counts their UTF-8 lengths.
 */
function clusterPieces(
  text: string,
  clusters: readonly { readonly byte: number; readonly x: number; readonly y: number }[],
): { readonly text: string; readonly x: number; readonly y: number }[] {
  const starts = new Map<number, number>();
  let byte = 0;
  let index = 0;
  for (const character of text) {
    starts.set(byte, index);
    const code = character.codePointAt(0) ?? 0;
    byte += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    index += character.length;
  }
  starts.set(byte, index);
  const pieces: { text: string; x: number; y: number }[] = [];
  for (let at = 0; at < clusters.length; at += 1) {
    const cluster = clusters[at];
    if (cluster === undefined) continue;
    const start = starts.get(cluster.byte);
    const next = clusters[at + 1];
    const end = next === undefined ? text.length : starts.get(next.byte);
    if (start === undefined || end === undefined || end <= start) continue;
    pieces.push({ text: text.slice(start, end), x: cluster.x, y: cluster.y });
  }
  return pieces;
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
