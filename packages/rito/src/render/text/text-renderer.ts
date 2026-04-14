import type { TextRun } from '../../layout/core/types';
import { buildFontString } from './font-string';
import { resolveTextColor } from '../../utils/color';
import { drawTextShadows } from './text-shadow';

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

  // Inline background color (e.g. <span> with background-color)
  if (run.style.backgroundColor) {
    const { x: bgX, y: bgY, width: bgW, height: bgH } = computeInlineBoxRect(run, x, y);
    ctx.fillStyle = run.style.backgroundColor;
    if (run.style.borderRadius > 0) {
      const r = Math.min(run.style.borderRadius, bgW / 2, bgH / 2);
      ctx.beginPath();
      ctx.moveTo(bgX + r, bgY);
      ctx.arcTo(bgX + bgW, bgY, bgX + bgW, bgY + bgH, r);
      ctx.arcTo(bgX + bgW, bgY + bgH, bgX, bgY + bgH, r);
      ctx.arcTo(bgX, bgY + bgH, bgX, bgY, r);
      ctx.arcTo(bgX, bgY, bgX + bgW, bgY, r);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(bgX, bgY, bgW, bgH);
    }
    ctx.fillStyle = color;
  }

  // Inline borders (e.g. <i class="ibox1"> with border-left/border-bottom)
  drawInlineBorders(ctx, run, x, y);

  if (run.style.textShadow.length > 0) {
    drawTextShadows(ctx, run, x, y, color);
  }

  ctx.fillText(run.text, x, y);

  if (run.style.textDecoration === 'underline') {
    drawLine(ctx, x, y + run.style.fontSize, run.bounds.width, color);
  } else if (run.style.textDecoration === 'line-through') {
    drawLine(ctx, x, y + run.style.fontSize * 0.5, run.bounds.width, color);
  }
}

export const RUBY_FONT_SCALE = 0.5;
export const RUBY_GAP = 1;

/**
 * Draw ruby annotation text inside the reserved space at the top of the run bounds.
 * The line breaker already extended the run's bounds.y upward and bounds.height
 * to include annotation space, so painting here stays within the line box.
 */
/**
 * Compute the inline-box rect (background/border area) for a text run.
 * The rect covers the content area (font-size), plus padding, plus border
 * on sides where the run is the first/last fragment of its inline box.
 * Line-height is not included — inline backgrounds/borders are CSS content-area,
 * not line-box, per Chrome/Firefox inline semantics.
 */
function computeInlineBoxRect(
  run: TextRun,
  textX: number,
  textY: number,
): { x: number; y: number; width: number; height: number } {
  const pl = run.style.paddingLeft;
  const pr = run.style.paddingRight;
  const pt = run.style.paddingTop;
  const pb = run.style.paddingBottom;
  const bl = run.borderStart ? run.style.borderLeft.width : 0;
  const br = run.borderEnd ? run.style.borderRight.width : 0;
  const bt = run.style.borderTop.width;
  const bb = run.style.borderBottom.width;
  return {
    x: textX - pl - bl,
    y: textY - pt - bt,
    width: run.bounds.width + pl + pr + bl + br,
    height: run.style.fontSize + pt + pb + bt + bb,
  };
}

export function drawRubyAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: string,
  x: number,
  annotationY: number,
  baseWidth: number,
  style: TextRun['style'],
  color: string,
): void {
  const rubyFontSize = style.fontSize * RUBY_FONT_SCALE;
  ctx.save();
  ctx.font = buildFontString({ ...style, fontSize: rubyFontSize });
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  const measured = ctx.measureText(annotation);
  const rubyX = x + (baseWidth - measured.width) / 2;
  ctx.fillText(annotation, rubyX, annotationY);
  ctx.restore();
}

/**
 * Draw borders for inline elements (spans, i, em, etc.).
 * Left border is only drawn on the first fragment (borderStart),
 * right border only on the last fragment (borderEnd).
 * Top/bottom borders are drawn on every fragment.
 */
function drawInlineBorders(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  x: number,
  y: number,
): void {
  const { borderTop, borderRight, borderBottom, borderLeft } = run.style;
  const hasAny =
    borderTop.width > 0 || borderRight.width > 0 || borderBottom.width > 0 || borderLeft.width > 0;
  if (!hasAny) return;

  // Only draw left/right borders on the correct fragment edge
  const drawLeft = borderLeft.width > 0 && borderLeft.style !== 'none' && run.borderStart === true;
  const drawRight = borderRight.width > 0 && borderRight.style !== 'none' && run.borderEnd === true;
  const drawTop = borderTop.width > 0 && borderTop.style !== 'none';
  const drawBottom = borderBottom.width > 0 && borderBottom.style !== 'none';
  if (!drawLeft && !drawRight && !drawTop && !drawBottom) return;

  const { x: bx, y: by, width: bw, height: bh } = computeInlineBoxRect(run, x, y);

  // When all four sides are drawn and border-radius is set, use a rounded
  // rect stroke to match the rounded inline background fill geometry.
  const r = run.style.borderRadius;
  const allFour = drawTop && drawRight && drawBottom && drawLeft;
  ctx.save();
  if (allFour && r > 0) {
    const cr = Math.min(r, bw / 2, bh / 2);
    // Draw per-side with quadrant clipping to preserve individual colors/widths
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const sides: readonly [typeof borderTop, number, number, number, number][] = [
      [borderTop, bx, by, bx + bw, by],
      [borderRight, bx + bw, by, bx + bw, by + bh],
      [borderBottom, bx + bw, by + bh, bx, by + bh],
      [borderLeft, bx, by + bh, bx, by],
    ];
    for (const [edge, x1, y1, x2, y2] of sides) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.clip();
      ctx.strokeStyle = edge.color;
      ctx.lineWidth = edge.width;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(bx + cr, by);
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, cr);
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, cr);
      ctx.arcTo(bx, by + bh, bx, by, cr);
      ctx.arcTo(bx, by, bx + bw, by, cr);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  } else {
    if (drawTop)
      drawBorderEdge(
        ctx,
        borderTop,
        bx,
        by + borderTop.width / 2,
        bx + bw,
        by + borderTop.width / 2,
      );
    if (drawBottom)
      drawBorderEdge(
        ctx,
        borderBottom,
        bx,
        by + bh - borderBottom.width / 2,
        bx + bw,
        by + bh - borderBottom.width / 2,
      );
    if (drawLeft)
      drawBorderEdge(
        ctx,
        borderLeft,
        bx + borderLeft.width / 2,
        by,
        bx + borderLeft.width / 2,
        by + bh,
      );
    if (drawRight)
      drawBorderEdge(
        ctx,
        borderRight,
        bx + bw - borderRight.width / 2,
        by,
        bx + bw - borderRight.width / 2,
        by + bh,
      );
  }
  ctx.restore();
}

function drawBorderEdge(
  ctx: CanvasRenderingContext2D,
  edge: { width: number; color: string; style: string },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.strokeStyle = edge.color;
  ctx.lineWidth = edge.width;
  if (edge.style === 'dotted') {
    ctx.setLineDash([0.001, edge.width * 1.5]);
    ctx.lineCap = 'round';
  } else if (edge.style === 'dashed') {
    ctx.setLineDash([edge.width * 3, edge.width * 2]);
    ctx.lineCap = 'butt';
  } else {
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
  }
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

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
