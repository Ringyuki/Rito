/**
 * Overlap scale for one uniform radius pair (CSS Backgrounds §5.5): when
 * either axis would make adjacent corners cross on a short edge, BOTH
 * axes shrink by the same factor (mirrors the production pen — per-axis
 * clamps turned wide badges into ellipses where Blink draws stadiums).
 */
function roundedOverlapScale(w: number, h: number, rx: number, ry: number): number {
  return Math.min(1, rx > 0 ? w / (2 * rx) : 1, ry > 0 ? h / (2 * ry) : 1);
}

/**
 * Trace a rounded rectangle path (clockwise). When `ry` differs from `rx`,
 * corners are elliptical arcs, matching CSS percentage border-radius.
 */
export function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number = rx,
): void {
  const scale = roundedOverlapScale(w, h, rx, ry);
  const crx = rx * scale;
  const cry = ry * scale;
  ctx.beginPath();
  if (crx === cry) {
    traceCircularRoundedRect(ctx, x, y, w, h, crx);
  } else {
    traceEllipticalRoundedRect(ctx, x, y, w, h, crx, cry);
  }
  ctx.closePath();
}

/** Trace a box path counter-clockwise (for evenodd clip subtraction). */
export function traceBoxPathCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  radiusY: number = radius,
): void {
  const scale = roundedOverlapScale(w, h, radius, radiusY);
  const rx = radius * scale;
  const ry = radiusY * scale;
  if (rx <= 0 && ry <= 0) {
    traceRectCCW(ctx, x, y, w, h);
    return;
  }
  if (rx === ry) {
    traceCircularRoundedRectCCW(ctx, x, y, w, h, rx);
    return;
  }
  traceEllipticalRoundedRectCCW(ctx, x, y, w, h, rx, ry);
}

function traceCircularRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function traceEllipticalRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  const pi = Math.PI;
  ctx.moveTo(x + rx, y);
  ctx.lineTo(x + w - rx, y);
  ctx.ellipse(x + w - rx, y + ry, rx, ry, 0, -pi / 2, 0);
  ctx.lineTo(x + w, y + h - ry);
  ctx.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, pi / 2);
  ctx.lineTo(x + rx, y + h);
  ctx.ellipse(x + rx, y + h - ry, rx, ry, 0, pi / 2, pi);
  ctx.lineTo(x, y + ry);
  ctx.ellipse(x + rx, y + ry, rx, ry, 0, pi, pi * 1.5);
}

function traceRectCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y);
  ctx.closePath();
}

function traceCircularRoundedRectCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x, y, x, y + h, r);
  ctx.arcTo(x, y + h, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x + w, y, r);
  ctx.arcTo(x + w, y, x, y, r);
  ctx.closePath();
}

function traceEllipticalRoundedRectCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  const pi = Math.PI;
  ctx.moveTo(x + rx, y);
  ctx.ellipse(x + rx, y + ry, rx, ry, 0, -pi / 2, pi, true);
  ctx.lineTo(x, y + h - ry);
  ctx.ellipse(x + rx, y + h - ry, rx, ry, 0, pi, pi / 2, true);
  ctx.lineTo(x + w - rx, y + h);
  ctx.ellipse(x + w - rx, y + h - ry, rx, ry, 0, pi / 2, 0, true);
  ctx.lineTo(x + w, y + ry);
  ctx.ellipse(x + w - rx, y + ry, rx, ry, 0, 0, -pi / 2, true);
  ctx.closePath();
}
