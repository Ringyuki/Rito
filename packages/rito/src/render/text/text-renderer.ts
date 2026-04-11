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
    const pl = run.style.paddingLeft;
    const pr = run.style.paddingRight;
    const pt = run.style.paddingTop;
    const pb = run.style.paddingBottom;
    const bgX = x - pl;
    const bgY = y - pt;
    const bgW = run.bounds.width + pl + pr;
    const bgH = run.bounds.height + pt + pb;
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
