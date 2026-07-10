/** Trace a clockwise rounded rectangle, including elliptical CSS radii. */
export function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number = radiusX,
): void {
  const rx = Math.min(radiusX, width / 2);
  const ry = Math.min(radiusY, height / 2);
  ctx.beginPath();
  if (rx === ry) traceCircularRoundedRect(ctx, x, y, width, height, rx);
  else traceEllipticalRoundedRect(ctx, x, y, width, height, rx, ry);
  ctx.closePath();
}

/** Trace a box path counter-clockwise for even-odd subtraction. */
export function traceBoxPathCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number = radiusX,
): void {
  const rx = Math.min(radiusX, width / 2);
  const ry = Math.min(radiusY, height / 2);
  if (rx <= 0 && ry <= 0) {
    traceRectCCW(ctx, x, y, width, height);
    return;
  }
  if (rx === ry) {
    traceCircularRoundedRectCCW(ctx, x, y, width, height, rx);
    return;
  }
  traceEllipticalRoundedRectCCW(ctx, x, y, width, height, rx, ry);
}

function traceCircularRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
}

function traceEllipticalRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): void {
  const pi = Math.PI;
  ctx.moveTo(x + radiusX, y);
  ctx.lineTo(x + width - radiusX, y);
  ctx.ellipse(x + width - radiusX, y + radiusY, radiusX, radiusY, 0, -pi / 2, 0);
  ctx.lineTo(x + width, y + height - radiusY);
  ctx.ellipse(x + width - radiusX, y + height - radiusY, radiusX, radiusY, 0, 0, pi / 2);
  ctx.lineTo(x + radiusX, y + height);
  ctx.ellipse(x + radiusX, y + height - radiusY, radiusX, radiusY, 0, pi / 2, pi);
  ctx.lineTo(x, y + radiusY);
  ctx.ellipse(x + radiusX, y + radiusY, radiusX, radiusY, 0, pi, pi * 1.5);
}

function traceRectCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width, y);
  ctx.closePath();
}

function traceCircularRoundedRectCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x, y, x, y + height, radius);
  ctx.arcTo(x, y + height, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x + width, y, radius);
  ctx.arcTo(x + width, y, x, y, radius);
  ctx.closePath();
}

function traceEllipticalRoundedRectCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): void {
  const pi = Math.PI;
  ctx.moveTo(x + radiusX, y);
  ctx.ellipse(x + radiusX, y + radiusY, radiusX, radiusY, 0, -pi / 2, pi, true);
  ctx.lineTo(x, y + height - radiusY);
  ctx.ellipse(x + radiusX, y + height - radiusY, radiusX, radiusY, 0, pi, pi / 2, true);
  ctx.lineTo(x + width - radiusX, y + height);
  ctx.ellipse(x + width - radiusX, y + height - radiusY, radiusX, radiusY, 0, pi / 2, 0, true);
  ctx.lineTo(x + width, y + radiusY);
  ctx.ellipse(x + width - radiusX, y + radiusY, radiusX, radiusY, 0, 0, -pi / 2, true);
  ctx.closePath();
}
