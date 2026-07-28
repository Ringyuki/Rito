import type { RenderBorderEdge } from './border-model';

export function strokeBorder(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (edge.style === 'dotted' && edge.width === 1) {
    strokeHairlineDotted(ctx, edge, x1, y1, x2, y2);
    return;
  }
  applyStrokeStyle(ctx, edge);
  const snap = edge.width % 2 === 1 ? 0.5 : 0;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + snap, Math.round(y1) + snap);
  ctx.lineTo(Math.round(x2) + snap, Math.round(y2) + snap);
  ctx.stroke();
}

// Measured against pinned Chromium (dotted-border probe, 2026-07-28): a
// 1px dotted edge rasters as BINARY full pixels — the span's endpoints
// round to the device grid, dots repeat every 2px anchored at BOTH ends,
// and an even span resolves the parity clash with a double dot at the
// start: offsets {0,1,3,5,…,L−1}; an odd span is {0,2,…,L−1}. (Fractional
// starts shift the whole pattern rigidly with the rounded origin; a
// 574.36px note-box edge produced exactly 289 dark pixels, all 0/255.)
function strokeHairlineDotted(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.fillStyle = edge.color;
  const horizontal = y1 === y2;
  const start = Math.round(horizontal ? x1 : y1);
  const end = Math.round(horizontal ? x2 : y2);
  // The centerline rides half a pixel below the border-box edge; the
  // painted row is the edge rounded to the grid.
  const row = Math.round((horizontal ? y1 : x1) - 0.5);
  const span = end - start;
  const dot = (offset: number) => {
    if (horizontal) {
      ctx.fillRect(start + offset, row, 1, 1);
    } else {
      ctx.fillRect(row, start + offset, 1, 1);
    }
  };
  let from = 0;
  if (span > 1 && span % 2 === 0) {
    dot(0);
    dot(1);
    from = 3;
  }
  for (let offset = from; offset < span; offset += 2) {
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
