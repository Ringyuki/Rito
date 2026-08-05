import { canvasSpacingValue } from './spacing';
import type { CanvasTextFragment, CanvasTextShadow } from './types';

/** Render text-shadow layers through a scratch canvas, leaving the glyph itself transparent. */
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
  const logicalWidth = fragment.rect.width + padLeft + padRight;
  const logicalHeight = fragment.rect.height + padTop + padBottom;
  // Negated comparisons so NaN dimensions also bail out.
  if (!(logicalWidth > 0) || !(logicalHeight > 0)) return;

  // The device scale is the transform's x-axis VECTOR length, not the
  // bare `a` component: under a 90° rotation `a` is cos(90°) — a signed
  // near-zero — and scaling by it ceil'd the scratch canvas to zero
  // size, which made drawImage throw and wedged the spread's paint (a
  // title page with rotated shadowed text could never finish rendering,
  // so paging into it hung forever).
  const transform = ctx.getTransform();
  const pixelRatio = Math.hypot(transform.a || 0, transform.b || 0) || 1;
  const physicalWidth = Math.max(1, Math.ceil(logicalWidth * pixelRatio));
  const physicalHeight = Math.max(1, Math.ceil(logicalHeight * pixelRatio));
  const scratch = createScratchCanvas(physicalWidth, physicalHeight);
  if (!scratch) return;

  scratch.ctx.scale(pixelRatio, pixelRatio);
  syncTextState(scratch.ctx, ctx, fragment, color);
  // The caster must sit EXACTLY where the glyph paint will: alphabetic
  // baseline at em-top + 0.8·size, the same convention as the renderer.
  // A 'top'-baseline caster hung the shadow fontAscent − 0.8·size lower
  // than the glyph (4.27px for SourceHan's 1.151em ascent at 12.16px) —
  // every shadowed note glyph smeared dark below its own strokes.
  renderShadowLayers(
    scratch.ctx,
    shadows,
    fragment.text,
    padLeft,
    padTop + 0.8 * fragment.paint.font.sizePx,
    pixelRatio,
  );
  ctx.drawImage(
    scratch.canvas,
    0,
    0,
    physicalWidth,
    physicalHeight,
    x - padLeft,
    y - padTop,
    logicalWidth,
    logicalHeight,
  );
}

/**
 * The scratch must hold ONLY the shadow ink: the canvas shadow API
 * always paints the casting glyph too, and erasing it afterwards by its
 * own alpha left `color x a x (1-a)` residue on every antialiased edge —
 * the glyph then painted on top brought the edge's color weight to
 * a + a(1-a) and every shadowed glyph rimmed darker than the browser's.
 * Painting the caster far off-canvas and walking the shadow offset back
 * (offsets live in device space, untouched by the transform) leaves the
 * pure shadow, which the glyph later covers exactly as Blink composites:
 * shadow underneath, body on top, edges blending through.
 */
const SHADOW_CAST_OFFSET = 20000;

function renderShadowLayers(
  ctx: ScratchCanvasContext,
  shadows: readonly CanvasTextShadow[],
  text: string,
  x: number,
  baselineY: number,
  pixelRatio: number,
): void {
  for (let index = shadows.length - 1; index >= 0; index -= 1) {
    const shadow = shadows[index];
    if (!shadow) continue;
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur * pixelRatio;
    ctx.shadowOffsetX = shadow.offsetX * pixelRatio;
    ctx.shadowOffsetY = (shadow.offsetY + SHADOW_CAST_OFFSET) * pixelRatio;
    ctx.fillText(text, x, baselineY - SHADOW_CAST_OFFSET);
  }
}

function computeShadowPadding(shadows: readonly CanvasTextShadow[]): ShadowPadding {
  let padLeft = 0;
  let padRight = 0;
  let padTop = 0;
  let padBottom = 0;
  for (const shadow of shadows) {
    const doubleBlur = shadow.blur * 2;
    padLeft = Math.max(padLeft, doubleBlur + Math.max(0, -shadow.offsetX));
    padRight = Math.max(padRight, doubleBlur + Math.max(0, shadow.offsetX));
    padTop = Math.max(padTop, doubleBlur + Math.max(0, -shadow.offsetY));
    padBottom = Math.max(padBottom, doubleBlur + Math.max(0, shadow.offsetY));
  }
  return { padLeft, padRight, padTop, padBottom };
}

interface ShadowPadding {
  readonly padLeft: number;
  readonly padRight: number;
  readonly padTop: number;
  readonly padBottom: number;
}

type ScratchCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface ScratchCanvas {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: ScratchCanvasContext;
}

function createScratchCanvas(width: number, height: number): ScratchCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }
  return null;
}

function syncTextState(
  destination: ScratchCanvasContext,
  source: CanvasRenderingContext2D,
  fragment: CanvasTextFragment,
  color: string,
): void {
  destination.font = source.font;
  destination.textBaseline = 'alphabetic';
  destination.fillStyle = color;
  destination.wordSpacing = canvasSpacingValue(fragment.paint.wordSpacingPx);
  destination.letterSpacing = canvasSpacingValue(fragment.paint.letterSpacingPx);
}
