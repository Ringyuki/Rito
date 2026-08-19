import type { RenderBorderEdge } from './border-model';

export function strokeBorder(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (edge.style === 'dotted' && Math.round(edge.width) >= 1 && (x1 === x2 || y1 === y2)) {
    if (Math.round(edge.width) <= 3) {
      strokeBinaryDotted(ctx, edge, x1, y1, x2, y2);
    } else {
      strokeMeasuredDotCircles(ctx, edge, x1, y1, x2, y2);
    }
    return;
  }
  if (edge.style === 'dashed' && (x1 === x2 || y1 === y2)) {
    strokeMeasuredDashed(ctx, edge, x1, y1, x2, y2);
    return;
  }
  // Blink's double border: two lines of a third each with a third of
  // gap. The caller hands the CENTERLINE of the whole border band; the
  // two sub-lines run at ±width/3 around it (centerlines at width/6 and
  // 5·width/6 from the outer edge), each stroked as its own solid band.
  if (edge.style === 'double' && (x1 === x2 || y1 === y2)) {
    const third = edge.width / 3;
    const line: RenderBorderEdge = { ...edge, width: third, style: 'solid' };
    if (y1 === y2) {
      strokeBorder(ctx, line, x1, y1 - third, x2, y2 - third);
      strokeBorder(ctx, line, x1, y1 + third, x2, y2 + third);
    } else {
      strokeBorder(ctx, line, x1 - third, y1, x2 - third, y2);
      strokeBorder(ctx, line, x1 + third, y1, x2 + third, y2);
    }
    return;
  }
  // Measured Blink solid-border raster (offset x width matrix,
  // 2026-08-05): the band is BINARY device rows — it starts at
  // round(border-box edge) and spans max(1, floor(width)) rows, no
  // antialiasing at any sub-pixel phase (a 1.5px border is exactly one
  // full-tone row). Stroking the centerline smeared two AA rows and sat
  // one row off at fractional tops.
  if (edge.style === 'solid' && (x1 === x2 || y1 === y2)) {
    ctx.fillStyle = edge.color;
    const bandWidth = Math.max(1, Math.floor(edge.width));
    if (y1 === y2) {
      const start = Math.round(Math.min(x1, x2));
      const end = Math.round(Math.max(x1, x2));
      // The caller hands the CENTERLINE; the band anchors at the
      // rounded outer edge and spans toward the box interior.
      const row = Math.round(y1 - edge.width / 2);
      ctx.fillRect(start, row, end - start, bandWidth);
    } else {
      const start = Math.round(Math.min(y1, y2));
      const end = Math.round(Math.max(y1, y2));
      const column = Math.round(x1 - edge.width / 2);
      ctx.fillRect(column, start, bandWidth, end - start);
    }
    return;
  }
  applyStrokeStyle(ctx, edge);
  const snap = edge.width % 2 === 1 ? 0.5 : 0;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + snap, Math.round(y1) + snap);
  ctx.lineTo(Math.round(x2) + snap, Math.round(y2) + snap);
  ctx.stroke();
}

// Chromium's thick-dotted stroke (width rounding above 3): round dots of
// diameter = width, spaced by the gap that best approximates one width
// between dots. With L the snapped span and w the rounded width, the dot
// count is n = floor((L + w) / 2w) or n + 1 — whichever count's implied
// gap (L - n*w)/(n - 1) lies closer to w — and the pitch is w + gap
// minus a 0.01 epsilon that guarantees the final dot survives float
// accumulation. Dots start at the span start + w/2 (verified on the b126
// 6px rule: pitch 11.9515 across 52 gaps, a half-pixel staircase every
// ~10 dots against any exact-pitch grid).
function strokeMeasuredDotCircles(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.fillStyle = edge.color;
  const horizontal = y1 === y2;
  const start = Math.round(horizontal ? Math.min(x1, x2) : Math.min(y1, y2));
  const end = Math.round(horizontal ? Math.max(x1, x2) : Math.max(y1, y2));
  // The caller hands the CENTERLINE; the dot row centers on it.
  const center = horizontal ? y1 : x1;
  const span = end - start;
  // Spacing follows the rounded width; the dot itself keeps the true
  // stroke diameter.
  const dashWidth = Math.round(edge.width);
  const radius = edge.width / 2;
  const drawDot = (at: number) => {
    ctx.moveTo((horizontal ? at : center) + radius, horizontal ? center : at);
    ctx.arc(horizontal ? at : center, horizontal ? center : at, radius, 0, 2 * Math.PI);
  };
  ctx.beginPath();
  const minDashes = Math.floor((span + dashWidth) / (2 * dashWidth));
  const maxDashes = minDashes + 1;
  const minGap = (span - minDashes * dashWidth) / (minDashes - 1);
  const maxGap = (span - maxDashes * dashWidth) / (maxDashes - 1);
  const useMin = maxGap <= 0 || Math.abs(minGap - dashWidth) < Math.abs(maxGap - dashWidth);
  const count = useMin ? minDashes : maxDashes;
  const gap = useMin ? minGap : maxGap;
  if (span < 2 * dashWidth || count <= 1 || !Number.isFinite(gap)) {
    drawDot(start + dashWidth / 2);
    ctx.fill();
    return;
  }
  const pitch = dashWidth + gap - 0.01;
  for (let index = 0; index < count; index += 1) {
    drawDot(start + dashWidth / 2 + index * pitch);
  }
  ctx.fill();
}

// Measured against pinned Chromium (b9 TOC dashed rules, 2026-08-19): a
// dashed edge rasters on the SAME binary device band as a solid one
// (round(outer edge), max(1, floor(width)) rows — the stroked
// centerline sat one row low and smeared), and the cadence is the
// browser's STRETCHED pattern: base dash 3w with base gap 2w picks the
// dash count n = floor((L + 2w) / 5w), then the gap stretches to
// (L − 3wn)/(n − 1) so a full dash lands flush at BOTH ends (measured:
// 56 dashes across a 280px rule — gap 2.036, mostly 2 device columns
// with two 3s where the fraction accumulates). Dash extents stay
// fractional along the run axis; their AA ends match the browser's.
function strokeMeasuredDashed(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.fillStyle = edge.color;
  const bandWidth = Math.max(1, Math.floor(edge.width));
  const horizontal = y1 === y2;
  const start = Math.round(horizontal ? Math.min(x1, x2) : Math.min(y1, y2));
  const end = Math.round(horizontal ? Math.max(x1, x2) : Math.max(y1, y2));
  // The caller hands the CENTERLINE; the band anchors at the rounded
  // border-box edge, exactly like the solid arm.
  const row = Math.round((horizontal ? y1 : x1) - edge.width / 2);
  const span = end - start;
  const dash = 3 * edge.width;
  const count = Math.floor((span + 2 * edge.width) / (5 * edge.width));
  const put = (at: number, length: number) => {
    if (horizontal) {
      ctx.fillRect(at, row, length, bandWidth);
    } else {
      ctx.fillRect(row, at, bandWidth, length);
    }
  };
  if (count <= 1 || span <= dash) {
    put(start, Math.min(span, dash));
    return;
  }
  const gap = (span - dash * count) / (count - 1);
  for (let index = 0; index < count; index += 1) {
    put(start + index * (dash + gap), dash);
  }
}

// Chromium's thin-dotted stroke (width rounding to 1-3): BINARY square
// dashes of side = the rounded width on an exact 2-width period, phase
// anchored at the span start, plus an endpoint-enforcement table that
// redraws the first/last dot and shifts the dash run by one pixel so
// full dots land on both ends whenever the span's remainder modulo the
// period allows it. The table keys on span % 4 (width 2) and span % 6
// (width 3); width 1 enforces only on even spans (the measured "double
// dot" at the start: offsets {0,1,3,5,…}). The width-2 branch reproduces
// b52's measured writing-pad rules (##.##..##.. on a 640px span) and the
// width-1 hairline probes exactly.
function strokeBinaryDotted(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.fillStyle = edge.color;
  const size = Math.round(edge.width);
  const horizontal = y1 === y2;
  const start = Math.round(horizontal ? Math.min(x1, x2) : Math.min(y1, y2));
  const end = Math.round(horizontal ? Math.max(x1, x2) : Math.max(y1, y2));
  // The caller hands the CENTERLINE; the painted band anchors at the
  // rounded border-box edge.
  const row = Math.round((horizontal ? y1 : x1) - edge.width / 2);
  const band = Math.max(1, Math.floor(edge.width));
  const span = end - start;
  const put = (offset: number, length: number) => {
    if (length <= 0) return;
    if (horizontal) {
      ctx.fillRect(start + offset, row, length, band);
    } else {
      ctx.fillRect(row, start + offset, band, length);
    }
  };
  const mod4 = span % 4;
  const mod6 = span % 6;
  let useStartDot = false;
  let startDotGrowth = 0;
  let startLineOffset = 0;
  let useEndDot = false;
  let endDotGrowth = 0;
  if ((size === 1 && span % 2 === 0) || (size === 3 && mod6 === 0)) {
    useStartDot = true;
    startDotGrowth = 1;
    startLineOffset = 1;
  }
  if ((size === 2 && (mod4 === 0 || mod4 === 1)) || (size === 3 && (mod6 === 1 || mod6 === 2))) {
    useStartDot = true;
    startLineOffset = -1;
  }
  if ((size === 2 && mod4 === 0) || (size === 3 && mod6 === 1)) {
    useEndDot = true;
  }
  if ((size === 2 && mod4 === 3) || (size === 3 && (mod6 === 4 || mod6 === 5))) {
    useStartDot = true;
    startLineOffset = 1;
  }
  if (size === 3 && mod6 === 5) {
    useEndDot = true;
  } else if (size === 3 && mod6 === 0) {
    useEndDot = true;
    endDotGrowth = 1;
  }
  let lineStart = 0;
  let lineEnd = span;
  if (useStartDot) {
    put(0, size + startDotGrowth);
    lineStart = 2 * size + startLineOffset;
  }
  if (useEndDot) {
    put(span - size - endDotGrowth, size + endDotGrowth);
    lineEnd = span - (size + endDotGrowth + 1);
  }
  for (let offset = lineStart; offset < lineEnd; offset += 2 * size) {
    put(offset, Math.min(size, lineEnd - offset));
  }
}

export function applyStrokeStyle(ctx: CanvasRenderingContext2D, edge: RenderBorderEdge): void {
  ctx.strokeStyle = edge.color;
  if (edge.style === 'dotted') {
    const dotWidth = edge.width * 0.75;
    ctx.lineWidth = dotWidth;
    ctx.setLineDash([0.001, edge.width * 1.5]);
    ctx.lineCap = 'round';
    return;
  }
  ctx.lineWidth = edge.width;
  ctx.setLineDash(dashPattern(edge.style, edge.width));
  ctx.lineCap = 'butt';
}

function dashPattern(style: RenderBorderEdge['style'], width: number): number[] {
  if (style === 'dotted') return [0.001, width * 1.5];
  if (style === 'dashed') return [width * 3, width * 2];
  return [];
}
