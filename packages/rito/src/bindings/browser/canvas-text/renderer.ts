import { buildFontString } from './font-string';
import { drawInlineBackground } from './inline-background';
import { drawInlineBorders } from './inline-borders';
import { canvasSpacingValue } from './spacing';
import { drawTextShadows } from './text-shadow';
import type { CanvasRubyFragment, CanvasTextColorOverride, CanvasTextFragment } from './types';
import { resolveTextColor } from '../theme/text-color';

// Vertical presentation classes: characters the vert feature ROTATES a
// quarter turn (brackets, dashes, leaders, the long-vowel mark) and the
// corner marks it SHIFTS into the em's top-right (comma, period).
const VERTICAL_ROTATED = /[「」『』()()〔〕［］[\]{}｛｝〈〉《》【】〖〗…‥ー―—–~〜～＝=]/u;
const VERTICAL_SHIFTED = /[、。，．,.]/u;

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
  if (fragment.vertical) {
    // Vertical-rl column: the rect's x is the glyph column's left edge,
    // y the first glyph's top, width the font size. Each cluster paints
    // upright and the pen steps one font size (plus justification
    // spacing) down the column. Punctuation takes its vertical
    // presentation: brackets, dashes and leaders are the horizontal
    // glyph rotated a quarter turn about its em center (how the vert
    // feature draws them), and comma/period marks sit in the em's
    // top-right corner instead of bottom-left.
    const size = paint.font.sizePx;
    const step = size + (paint.letterSpacingPx ?? 0);
    ctx.letterSpacing = '0px';
    let penY = y + 0.8 * size;
    for (const cluster of fragment.text) {
      if (VERTICAL_ROTATED.test(cluster)) {
        const cx = x + size / 2;
        const cy = penY - 0.3 * size;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(cluster, -size / 2, 0.3 * size);
        ctx.restore();
      } else if (VERTICAL_SHIFTED.test(cluster)) {
        ctx.fillText(cluster, x + 0.5 * size, penY - 0.6 * size);
      } else {
        ctx.fillText(cluster, x, penY);
      }
      penY += step;
    }
    return;
  }
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
  // An outside list marker rides right-aligned: the wire x is the
  // text's right edge and only the canvas can measure the string.
  // Zero-width characters (U+FEFF and friends) paint no ink but the
  // canvas letterSpacing pen would still spend one spacing share on
  // them, pushing everything after one share right of the browser's
  // cells (which step 0 across a zero-width cluster). Stripping them
  // changes no pixels of their own.
  const drawnText = fragment.text.replace(/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, '');
  const penX = fragment.alignRight ? x - ctx.measureText(drawnText).width : x;
  if (textRidesTheLayoutGrid(paint.font.sizePx, paint.wordSpacingPx, drawnText)) {
    drawTextOnLayoutGrid(ctx, drawnText, penX, baseline, paint.letterSpacingPx ?? 0);
  } else {
    ctx.fillText(drawnText, penX, baseline);
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
    if (ruby.vertical) {
      // Vertical column annotation: rect.height is the base span; the
      // free length splits one share per glyph, half a share at each
      // edge (the space-around initial), each glyph stepping one
      // annotation size down the column.
      const size = paint.font.sizePx;
      const glyphs = Array.from(ruby.text);
      const share = (ruby.rect.height - glyphs.length * size) / glyphs.length;
      let penY = ruby.rect.y + share / 2;
      for (const glyph of glyphs) {
        ctx.fillText(glyph, ruby.rect.x, penY);
        penY += size + share;
      }
      return;
    }
    const measured = ctx.measureText(ruby.text);
    const glyphs = Array.from(ruby.text).length;
    const free = ruby.rect.width - measured.width;
    // Distribution follows the annotation's computed `ruby-align`.
    // `space-around` (the initial, absent on the wire; measured on the
    // b96 long-base ruby: free 66.77px over 9 glyphs → 3.709px at each
    // edge, 7.418px between neighbours): the free width splits into one
    // share per glyph, half a share at each edge. A wide annotation's
    // rect already equals its own advance (free ≈ 0), so this reduces
    // to packed centering. A LATIN word annotation is ONE justification
    // unit — no intra-word expansion — so it centers whole (measured on
    // b20's ショウコ/Shouko rubies: natural-width word, free/2 = 13.7px
    // at each edge, interior steps natural 5.33px; the per-glyph spread
    // scattered the letters across the base). `center` packs the glyphs
    // at their natural advance, centered (measured on b9's
    // `ruby{ruby-align:center}`: 破坏神 at 8.8px packs to a 26.4px block
    // centered over the 64px base the space-around law had scattered it
    // across). `start` packs at the left edge; `space-between` spreads
    // interior-only shares, and a single item centers like the initial.
    const align = ruby.rubyAlign ?? 'space-around';
    const expands = glyphs > 1 && free > 0.01 && rubyAnnotationExpands(ruby.text);
    const words: string[] = [];
    {
      let start = -1;
      for (let index = 0; index <= ruby.text.length; index += 1) {
        const blank = index === ruby.text.length || ruby.text[index] === ' ';
        if (!blank && start < 0) start = index;
        if (blank && start >= 0) {
          words.push(ruby.text.slice(start, index));
          start = -1;
        }
      }
    }
    if (
      (align === 'space-around' || align === 'space-between') &&
      words.length > 1 &&
      free > 0.01 &&
      !rubyAnnotationExpands(ruby.text)
    ) {
      // A spaced word annotation distributes like standard word-unit
      // space-around: each WORD is one justification unit taking one
      // share of the free width, half on each side — so the edges carry
      // share/2 and each inter-word gap carries a full share on top of
      // the natural space (pixel-measured on BOTH the b42 Locus/Solus
      // and the b43 Dagr/weapon rubies: base 64.8, words 21+19, edges
      // ~5.6, gap ~13.2 = share 11.2 + the 2px natural space; the
      // earlier hug-both-edges placement measured a Range box whose
      // widths already carried the expansion shares, not the ink).
      const wordWidths = words.map((word) => ctx.measureText(word).width);
      const naturalWords = wordWidths.reduce((sum, value) => sum + value, 0);
      const spaceWidth = ctx.measureText(' ').width;
      const naturalSpaces = spaceWidth * (words.length - 1);
      const share = (ruby.rect.width - naturalWords - naturalSpaces) / words.length;
      let x = ruby.rect.x + share / 2;
      for (let index = 0; index < words.length; index += 1) {
        ctx.fillText(words[index] ?? '', x, ruby.rect.y);
        x += (wordWidths[index] ?? 0) + spaceWidth + share;
      }
    } else if (align === 'start') {
      ctx.fillText(ruby.text, ruby.rect.x, ruby.rect.y);
    } else if (align === 'space-between' && expands) {
      ctx.letterSpacing = `${String(free / (glyphs - 1))}px`;
      ctx.fillText(ruby.text, ruby.rect.x, ruby.rect.y);
    } else if (align === 'space-around' && expands) {
      ctx.letterSpacing = `${String(free / glyphs)}px`;
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
