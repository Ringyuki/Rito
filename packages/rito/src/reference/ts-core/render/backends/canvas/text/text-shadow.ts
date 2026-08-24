import type { TextShadow } from '../../../../style/core/types';
import { canvasSpacingValue } from './spacing';
import type { CanvasTextFragment } from './text-renderer';

/**
 * Render text-shadow layers onto the main canvas using a scratch canvas.
 * 1. Compute padded bounds covering all shadow extents
 * 2. On scratch canvas: draw each shadow layer (text + Canvas shadow)
 * 3. destination-out: erase the text glyph, leaving only shadow pixels
 * 4. drawImage the scratch result onto the main canvas
 */
export function drawTextShadows(
  ctx: CanvasRenderingContext2D,
  fragment: CanvasTextFragment,
  x: number,
  y: number,
  color: string,
): void {
  const shadows = fragment.paint.textShadow ?? [];
  if (shadows.length === 0) return;
  const { padLeft, padRight, padTop, padBottom } = computeShadowPadding(shadows);
  const logicalW = fragment.rect.width + padLeft + padRight;
  const logicalH = fragment.rect.height + padTop + padBottom;
  if (logicalW <= 0 || logicalH <= 0) return;

  const dpr = ctx.getTransform().a || 1;
  const physW = Math.ceil(logicalW * dpr);
  const physH = Math.ceil(logicalH * dpr);

  const scratch = createScratchCanvas(physW, physH);
  if (!scratch) return;
  const sctx = scratch.ctx;

  sctx.scale(dpr, dpr);
  syncTextState(sctx, ctx, fragment, color);

  renderShadowLayers(sctx, shadows, fragment.text, padLeft, padTop, dpr);
  eraseTextGlyph(sctx, fragment.text, padLeft, padTop);

  ctx.drawImage(scratch.canvas, 0, 0, physW, physH, x - padLeft, y - padTop, logicalW, logicalH);
}

function renderShadowLayers(
  sctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  shadows: readonly TextShadow[],
  text: string,
  lx: number,
  ly: number,
  dpr: number,
): void {
  for (let i = shadows.length - 1; i >= 0; i--) {
    const s = shadows[i];
    if (!s) continue;
    sctx.shadowColor = s.color;
    sctx.shadowBlur = s.blur * dpr;
    sctx.shadowOffsetX = s.offsetX * dpr;
    sctx.shadowOffsetY = s.offsetY * dpr;
    sctx.fillText(text, lx, ly);
  }
}

function eraseTextGlyph(
  sctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  lx: number,
  ly: number,
): void {
  sctx.shadowColor = 'transparent';
  sctx.shadowBlur = 0;
  sctx.shadowOffsetX = 0;
  sctx.shadowOffsetY = 0;
  sctx.globalCompositeOperation = 'destination-out';
  sctx.fillText(text, lx, ly);
  sctx.globalCompositeOperation = 'source-over';
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

interface ScratchCanvas {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function createScratchCanvas(w: number, h: number): ScratchCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }
  return null;
}

function syncTextState(
  dst: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  src: CanvasRenderingContext2D,
  fragment: CanvasTextFragment,
  color: string,
): void {
  dst.font = src.font;
  dst.textBaseline = 'top';
  dst.fillStyle = color;
  dst.wordSpacing = canvasSpacingValue(fragment.paint.wordSpacingPx);
  dst.letterSpacing = canvasSpacingValue(fragment.paint.letterSpacingPx);
}
