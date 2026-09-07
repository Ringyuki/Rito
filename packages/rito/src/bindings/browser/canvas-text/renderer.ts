import { buildFontString } from './font-string';
import { canvasSpacingValue } from './spacing';
import { drawTextShadows } from './text-shadow';
import type { CanvasRubyFragment, CanvasTextColorOverride, CanvasTextFragment } from './types';
import { resolveTextColor } from '../theme/text-color';

// Vertical presentation classes: characters the vert feature ROTATES a
// quarter turn (brackets, dashes, leaders, the long-vowel mark) and the
// corner marks it SHIFTS into the em's top-right (comma, period).
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
    ctx.wordSpacing = '0px';
    ctx.letterSpacing = '0px';
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
  // Zero-width characters (U+FEFF and friends) paint no ink but the
  // canvas letterSpacing pen would still spend one spacing share on
  // them, pushing everything after one share right of the browser's
  // cells (which step 0 across a zero-width cluster). Stripping them
  // changes no pixels of their own.
  const drawnText = fragment.text.replace(/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, '');
  if (textRidesTheLayoutGrid(paint.font.sizePx, paint.wordSpacingPx, drawnText)) {
    drawTextOnLayoutGrid(ctx, drawnText, x, baseline, paint.letterSpacingPx ?? 0);
  } else {
    ctx.fillText(drawnText, x, baseline);
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
    // The engine distributed the annotation over its base by the
    // computed `ruby-align` — across a horizontal base or down a
    // vertical one — and sent every cluster's origin: the canvas draws
    // each at its origin from the em-box top, spacing off. A run that
    // arrives without origins draws packed and centered, its start
    // floored onto the 1/64 grid like every centered line.
    const pieces = clusterPieces(ruby.text, ruby.clusters ?? []);
    if (pieces.length === 0) {
      const measured = ctx.measureText(ruby.text);
      const x = Math.floor((ruby.rect.x + (ruby.rect.width - measured.width) / 2) * 64) / 64;
      ctx.fillText(ruby.text, x, ruby.rect.y);
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

/**
 * Whether the run's glyph positions must be snapped onto Blink's
 * LayoutUnit grid glyph by glyph. At an INTEGER font size a CJK run's
 * float advances stay on the grid and one fillText is already
 * bit-identical to the DOM raster; a FRACTIONAL size (em cascades like
 * 0.95em of 16 → 15.2, 0.8em of 15.2 → 12.16) drifts off it, and Blink
 * paints each glyph at floor64 of the float cumulative advance — the
 * drift flips subpixel AA variants a whole-run fillText cannot
 * reproduce (measured: identical rasters at integer positions, a
 * 98px one-glyph divergence at x=20.4256). Word-spacing runs keep the
 * whole-run path: canvas applies wordSpacing internally and manual
 * placement would double it. Only fully-CJK runs qualify: each CJK
 * glyph is its own cluster with no kerning, so per-glyph measurement
 * equals the shaped advance; a latin word measured glyph-by-glyph
 * loses kerning and lands off the shaped positions (measured: a mixed
 * title line with `Trial and Error` grew a 674px page band under the
 * unconditional pen while pure-CJK dialog pages healed).
 */
function textRidesTheLayoutGrid(
  sizePx: number,
  wordSpacingPx: number | undefined,
  text: string,
): boolean {
  return (sizePx * 64) % 1 !== 0 && !wordSpacingPx && runIsAllCjk(text);
}

/**
 * Every glyph sits in the CJK blocks whose clusters shape 1:1 with no
 * inter-glyph kerning (ideographs, kana, fullwidth forms, CJK
 * punctuation). Anything else — latin words, spaces, dashes — keeps
 * the whole-run canvas path.
 */
function runIsAllCjk(text: string): boolean {
  for (const glyph of text) {
    const code = glyph.codePointAt(0) ?? 0;
    const cjk =
      // U+00B7 rides along: the middle dot between ideographs shapes
      // 1:1 with no kern against its CJK neighbours, and rejecting it
      // kept a fractional-size chapter list on the whole-run pen
      // (16.8px 第一·五章 drifted every glyph after the dot off the
      // browser's per-glyph floor64 cells).
      code === 0xb7 ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x20000 && code <= 0x3ffff);
    if (!cjk) return false;
  }
  return text.length > 0;
}

/**
 * Paints each glyph at floor64 of the float cumulative advance —
 * Blink's exact per-glyph placement rule (21/21 positions matched on
 * the 12.16px oracle line; per-glyph-rounded sums diverge). Justify
 * shares ride letterSpacingPx (fragment_paint folds them together) and
 * join the cumulative before the floor, which reproduces the measured
 * truth expansion map (26/64 base with +1/64 remainders diffused).
 * Kerning between glyphs is dropped by per-glyph measurement — exact
 * for CJK, approximate for latin runs at fractional sizes.
 */
function drawTextOnLayoutGrid(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  spacingPx: number,
): void {
  const previousSpacing = ctx.letterSpacing;
  ctx.letterSpacing = '0px';
  let cumulative = 0;
  let index = 0;
  for (const glyph of text) {
    // The browser floors the ABSOLUTE position of every cluster onto
    // the 1/64 grid (probed on unkerned 15.2px runs: continuous text
    // lands at floor64(anchor + f32 cumulative), and a same-style run
    // split keeps the raw fractional start, so relative flooring left
    // the whole run one grid phase off the browser's cells).
    const snapped = Math.floor((x + cumulative + spacingPx * index) * 64) / 64;
    ctx.fillText(glyph, snapped, baseline);
    cumulative += ctx.measureText(glyph).width;
    index += 1;
  }
  ctx.letterSpacing = previousSpacing;
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
