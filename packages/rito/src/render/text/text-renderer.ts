import type { TextShadow } from '../../style/core/types';
import type { TextRun } from '../../layout/core/types';
import { buildFontString } from './font-string';
import { resolveTextColor } from '../../utils/color';

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

  if (run.style.textShadow.length > 0) {
    drawTextShadows(ctx, run, x, y, color);
  }

  ctx.fillText(run.text, x, y);

  // Draw text decoration
  if (run.style.textDecoration === 'underline') {
    drawLine(ctx, x, y + run.style.fontSize, run.bounds.width, color);
  } else if (run.style.textDecoration === 'line-through') {
    drawLine(ctx, x, y + run.style.fontSize * 0.5, run.bounds.width, color);
  }
}

// ---------------------------------------------------------------------------
// Text shadow via scratch canvas + destination-out
// ---------------------------------------------------------------------------

/**
 * Render text-shadow layers onto the main canvas using a scratch canvas.
 * 1. Compute padded bounds covering all shadow extents
 * 2. On scratch canvas: draw each shadow layer (text + Canvas shadow)
 * 3. destination-out: erase the text glyph, leaving only shadow pixels
 * 4. drawImage the scratch result onto the main canvas
 */
function drawTextShadows(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  x: number,
  y: number,
  color: string,
): void {
  const shadows = run.style.textShadow;
  const { padLeft, padRight, padTop, padBottom } = computeShadowPadding(shadows);
  const logicalW = run.bounds.width + padLeft + padRight;
  const logicalH = run.bounds.height + padTop + padBottom;
  if (logicalW <= 0 || logicalH <= 0) return;

  // Match the main canvas pixel density so shadow rasterizes at full resolution
  const dpr = ctx.getTransform().a || 1;
  const physW = Math.ceil(logicalW * dpr);
  const physH = Math.ceil(logicalH * dpr);

  const scratch = createScratchCanvas(physW, physH);
  if (!scratch) return;

  const sctx = scratch.getContext('2d');
  if (!sctx) return;

  // Scale scratch to match main canvas DPR; all coordinates stay in logical pixels
  sctx.scale(dpr, dpr);
  syncTextState(sctx, ctx, run, color);

  const lx = padLeft;
  const ly = padTop;

  // Draw shadow layers (back to front).
  // Canvas shadow params are NOT affected by the CTM, so scale them manually.
  for (let i = shadows.length - 1; i >= 0; i--) {
    const s = shadows[i];
    if (!s) continue;
    sctx.shadowColor = s.color;
    sctx.shadowBlur = s.blur * dpr;
    sctx.shadowOffsetX = s.offsetX * dpr;
    sctx.shadowOffsetY = s.offsetY * dpr;
    sctx.fillText(run.text, lx, ly);
  }

  // Erase the text glyph with shadow fully reset
  resetShadow(sctx);
  sctx.globalCompositeOperation = 'destination-out';
  sctx.fillText(run.text, lx, ly);
  sctx.globalCompositeOperation = 'source-over';

  // Composite scratch onto main canvas using logical dimensions
  // (main ctx already has dpr scale applied, so draw at logical size)
  ctx.drawImage(scratch, 0, 0, physW, physH, x - padLeft, y - padTop, logicalW, logicalH);
}

function computeShadowPadding(shadows: readonly TextShadow[]): {
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
} {
  let padLeft = 0;
  let padRight = 0;
  let padTop = 0;
  let padBottom = 0;
  for (const s of shadows) {
    const blur2 = s.blur * 2;
    padLeft = Math.max(padLeft, blur2 + Math.max(0, -s.offsetX));
    padRight = Math.max(padRight, blur2 + Math.max(0, s.offsetX));
    padTop = Math.max(padTop, blur2 + Math.max(0, -s.offsetY));
    padBottom = Math.max(padBottom, blur2 + Math.max(0, s.offsetY));
  }
  return { padLeft, padRight, padTop, padBottom };
}

function createScratchCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

function syncTextState(
  dst: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  src: CanvasRenderingContext2D,
  run: TextRun,
  color: string,
): void {
  dst.font = src.font;
  dst.textBaseline = 'top';
  dst.fillStyle = color;
  dst.wordSpacing = run.style.wordSpacing !== 0 ? `${String(run.style.wordSpacing)}px` : '';
  dst.letterSpacing = run.style.letterSpacing !== 0 ? `${String(run.style.letterSpacing)}px` : '';
}

function resetShadow(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

// ---------------------------------------------------------------------------

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
