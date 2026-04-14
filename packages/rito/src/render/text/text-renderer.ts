import type { RubyAnnotation, TextRun } from '../../layout/core/types';
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
  const paint = run.paint;
  ctx.font = buildFontString(paint.font);

  const color = colorOverride
    ? resolveTextColor(paint.color, colorOverride.backgroundColor, colorOverride.foregroundColor)
    : paint.color;

  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.wordSpacing = paint.wordSpacingPx !== undefined ? `${String(paint.wordSpacingPx)}px` : '';
  ctx.letterSpacing =
    paint.letterSpacingPx !== undefined ? `${String(paint.letterSpacingPx)}px` : '';

  const x = offsetX + run.bounds.x;
  const y = offsetY + run.bounds.y;

  // Inline background color (e.g. <span> with background-color).
  if (paint.backgroundColor) {
    const { x: bgX, y: bgY, width: bgW, height: bgH } = computeInlineBoxRect(run, x, y);
    ctx.fillStyle = paint.backgroundColor;
    const radius = paint.backgroundRadius ?? 0;
    if (radius > 0) {
      const r = Math.min(radius, bgW / 2, bgH / 2);
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

  // Inline borders (e.g. <i class="ibox1"> with border-left/border-bottom).
  drawInlineBorders(ctx, run, x, y);

  if (paint.textShadow && paint.textShadow.length > 0) {
    drawTextShadows(ctx, run, x, y, color);
  }

  ctx.fillText(run.text, x, y);

  // Pre-computed decoration geometry — render just strokes the line.
  const decoration = paint.decoration;
  if (decoration) {
    drawLine(ctx, x, y + decoration.y, run.bounds.width, decoration.color, decoration.thickness);
  }
}

/**
 * Compute the inline-box rect (background/border area) for a text run.
 * The rect covers the content area (font-size) plus any padding and side
 * border contributions present in the run's paint. Line-height is deliberately
 * excluded — inline backgrounds/borders follow the CSS content-area box, not
 * the line-box, per Chrome/Firefox semantics.
 */
function computeInlineBoxRect(
  run: TextRun,
  textX: number,
  textY: number,
): { x: number; y: number; width: number; height: number } {
  const paint = run.paint;
  const padding = paint.padding;
  const border = paint.border;
  const pl = padding?.left ?? 0;
  const pr = padding?.right ?? 0;
  const pt = padding?.top ?? 0;
  const pb = padding?.bottom ?? 0;
  const bl = border?.start?.widthPx ?? 0;
  const br = border?.end?.widthPx ?? 0;
  const bt = border?.top?.widthPx ?? 0;
  const bb = border?.bottom?.widthPx ?? 0;
  return {
    x: textX - pl - bl,
    y: textY - pt - bt,
    width: run.bounds.width + pl + pr + bl + br,
    height: paint.font.sizePx + pt + pb + bt + bb,
  };
}

export function drawRubyAnnotation(
  ctx: CanvasRenderingContext2D,
  ruby: RubyAnnotation,
  offsetX: number,
  offsetY: number,
  colorOverride?: { foregroundColor: string; backgroundColor: string },
): void {
  const paint = ruby.paint;
  const color = colorOverride
    ? resolveTextColor(paint.color, colorOverride.backgroundColor, colorOverride.foregroundColor)
    : paint.color;
  ctx.save();
  ctx.font = buildFontString(paint.font);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  // Center the annotation horizontally over its pre-computed bounds.
  const measured = ctx.measureText(ruby.text);
  const rubyX = offsetX + ruby.bounds.x + (ruby.bounds.width - measured.width) / 2;
  const rubyY = offsetY + ruby.bounds.y;
  ctx.fillText(ruby.text, rubyX, rubyY);
  ctx.restore();
}

/**
 * Draw borders for inline elements (spans, i, em, etc.).
 * Start / end (left / right) borders only appear on the first / last
 * fragment of a multi-line inline span (layout decides); top / bottom
 * appear on every fragment.
 */
function drawInlineBorders(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  x: number,
  y: number,
): void {
  const border = run.paint.border;
  if (!border) return;
  const { top, bottom, start, end } = border;
  if (!top && !bottom && !start && !end) return;

  const { x: bx, y: by, width: bw, height: bh } = computeInlineBoxRect(run, x, y);

  // When all four sides are drawn and background-radius is set, use a rounded
  // rect stroke to match the rounded inline background fill geometry.
  const r = run.paint.backgroundRadius ?? 0;
  const allFour = top && bottom && start && end;
  ctx.save();
  if (allFour && r > 0) {
    const cr = Math.min(r, bw / 2, bh / 2);
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    // Inside the `allFour` branch TS has already narrowed top/right/bottom/left
    // to non-undefined, so every sides entry is a drawable edge.
    const sides: readonly [NonNullable<typeof top>, number, number, number, number][] = [
      [top, bx, by, bx + bw, by],
      [end, bx + bw, by, bx + bw, by + bh],
      [bottom, bx + bw, by + bh, bx, by + bh],
      [start, bx, by + bh, bx, by],
    ];
    for (const [edge, x1, y1, x2, y2] of sides) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.clip();
      ctx.strokeStyle = edge.paint.color;
      ctx.lineWidth = edge.widthPx;
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
    if (top) {
      drawBorderEdge(
        ctx,
        top.widthPx,
        top.paint.style,
        top.paint.color,
        bx,
        by + top.widthPx / 2,
        bx + bw,
        by + top.widthPx / 2,
      );
    }
    if (bottom) {
      drawBorderEdge(
        ctx,
        bottom.widthPx,
        bottom.paint.style,
        bottom.paint.color,
        bx,
        by + bh - bottom.widthPx / 2,
        bx + bw,
        by + bh - bottom.widthPx / 2,
      );
    }
    if (start) {
      drawBorderEdge(
        ctx,
        start.widthPx,
        start.paint.style,
        start.paint.color,
        bx + start.widthPx / 2,
        by,
        bx + start.widthPx / 2,
        by + bh,
      );
    }
    if (end) {
      drawBorderEdge(
        ctx,
        end.widthPx,
        end.paint.style,
        end.paint.color,
        bx + bw - end.widthPx / 2,
        by,
        bx + bw - end.widthPx / 2,
        by + bh,
      );
    }
  }
  ctx.restore();
}

function drawBorderEdge(
  ctx: CanvasRenderingContext2D,
  width: number,
  style: 'solid' | 'dotted' | 'dashed',
  color: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (style === 'dotted') {
    ctx.setLineDash([0.001, width * 1.5]);
    ctx.lineCap = 'round';
  } else if (style === 'dashed') {
    ctx.setLineDash([width * 3, width * 2]);
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
  thickness: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
}
