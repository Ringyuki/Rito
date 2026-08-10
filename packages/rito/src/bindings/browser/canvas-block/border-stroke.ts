import type { RenderBorderEdge } from './border-model';

export function strokeBorder(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (edge.style === 'dotted' && (edge.width === 1 || edge.width === 2) && (x1 === x2 || y1 === y2)) {
    strokeBinaryDotted(ctx, edge, x1, y1, x2, y2);
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

// Measured against pinned Chromium (dotted-border probes, 2026-07-28 and
// 2026-08-10): a thin dotted edge rasters as BINARY square dots of side
// = the border width — the span's endpoints round to the device grid,
// one dot anchors at the START, the rest anchor at the END every
// 2×width, and the FIRST interval absorbs the parity remainder. At
// width 1 this reproduces the measured hairline offsets exactly (even
// span {0,1,3,5,…,L−1} — the "double dot"; odd span {0,2,…,L−1}); at
// width 2 it reproduces b52's writing-pad rules (2px dots, 2px gaps,
// first gap compressed: ##.##..##..).
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
  const start = Math.round(horizontal ? x1 : y1);
  const end = Math.round(horizontal ? x2 : y2);
  // The caller hands the CENTERLINE; the painted band anchors at the
  // rounded border-box edge.
  const row = Math.round((horizontal ? y1 : x1) - edge.width / 2);
  const span = end - start;
  const dot = (offset: number) => {
    if (horizontal) {
      ctx.fillRect(start + offset, row, size, size);
    } else {
      ctx.fillRect(row, start + offset, size, size);
    }
  };
  dot(0);
  if (size === 1) {
    // Hairline (2026-07-28 probe): dots every 2px anchored at BOTH
    // ends, an even span resolving the parity clash with a double dot
    // at the start — offsets {0,1,3,5,…,L−1}; odd {0,2,…,L−1}.
    let from = 2;
    if (span > 1 && span % 2 === 0) {
      dot(1);
      from = 3;
    }
    for (let offset = from; offset < span; offset += 2) {
      dot(offset);
    }
    return;
  }
  // 2px (b52 writing-pad probe, 2026-08-10): a dot flush at EACH end,
  // and a regular period-4 interior series at 3+4k leaving a 1px gap
  // against both end dots (measured offsets 0,3,7,…,635,638 on a
  // 640px rule — 161 binary 2×2 dots).
  dot(span - size);
  for (let offset = size + 1; offset <= span - 2 * size - 1; offset += 2 * size) {
    dot(offset);
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
