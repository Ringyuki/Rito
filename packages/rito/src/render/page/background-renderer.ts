import type { BoxShadow } from '../../style/core/types';
import type { BackgroundPosition, BorderPaintEdge, LengthPct } from '../../style/core/paint-types';
import type { BlockBorderPaint, BorderBox, LayoutBlock } from '../../layout/core/types';
import { buildHrefResolver } from '../../utils/resolve-href';

/** Resolved border-radius with separate horizontal and vertical radii. */
export interface ResolvedRadius {
  readonly rx: number;
  readonly ry: number;
}

/** Local "combined" border edge used by the internal border drawing helpers:
 *  merges width (from BorderBox) with color/style (from BlockBorderPaint). */
interface RenderBorderEdge {
  readonly width: number;
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed';
}
interface RenderBorders {
  readonly top: RenderBorderEdge;
  readonly right: RenderBorderEdge;
  readonly bottom: RenderBorderEdge;
  readonly left: RenderBorderEdge;
}

const ZERO_EDGE: RenderBorderEdge = { width: 0, color: '#000', style: 'solid' };

function toRenderBorders(
  borderBox: BorderBox | undefined,
  paint: BlockBorderPaint | undefined,
): RenderBorders | undefined {
  if (!borderBox && !paint) return undefined;
  return {
    top: toEdge(borderBox?.topWidth, paint?.top),
    right: toEdge(borderBox?.rightWidth, paint?.right),
    bottom: toEdge(borderBox?.bottomWidth, paint?.bottom),
    left: toEdge(borderBox?.leftWidth, paint?.left),
  };
}

function toEdge(width: number | undefined, paint: BorderPaintEdge | undefined): RenderBorderEdge {
  if (width === undefined || width <= 0 || !paint) return ZERO_EDGE;
  return { width, color: paint.color, style: paint.style };
}

const DEFAULT_POS_AUTO: BackgroundPosition = {
  x: { unit: 'percent', value: 0 },
  y: { unit: 'percent', value: 0 },
};
const DEFAULT_POS_CENTER: BackgroundPosition = {
  x: { unit: 'percent', value: 50 },
  y: { unit: 'percent', value: 50 },
};

/** Resolve a CSS background-position axis value into an offset from the box
 *  origin. Percentages anchor `pct` of the image to `pct` of the container. */
function resolvePosAxis(v: LengthPct, containerSize: number, imageSize: number): number {
  if (v.unit === 'percent') return ((containerSize - imageSize) * v.value) / 100;
  return v.value;
}

/** Resolve a block's effective border-radius (px or percentage → per-axis px). */
export function resolveBlockRadius(block: LayoutBlock): ResolvedRadius {
  const radius = block.paint?.radius;
  if (!radius) return { rx: 0, ry: 0 };
  if (radius.pct !== undefined) {
    const pct = radius.pct / 100;
    return { rx: pct * block.bounds.width, ry: pct * block.bounds.height };
  }
  const r = radius.px ?? 0;
  return { rx: r, ry: r };
}

export function renderBlockBackground(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  blockX: number,
  blockY: number,
  { rx, ry }: ResolvedRadius,
  images?: ReadonlyMap<string, ImageBitmap>,
): void {
  const paint = block.paint;
  const background = paint?.background;
  const hasRadius = rx > 0 || ry > 0;

  if (paint?.boxShadow && paint.boxShadow.length > 0) {
    renderBoxShadows(
      ctx,
      paint.boxShadow,
      blockX,
      blockY,
      block.bounds.width,
      block.bounds.height,
      rx,
      ry,
    );
  }

  if (background?.color) {
    ctx.fillStyle = background.color;
    if (hasRadius) {
      traceRoundedRect(ctx, blockX, blockY, block.bounds.width, block.bounds.height, rx, ry);
      ctx.fill();
    } else {
      ctx.fillRect(blockX, blockY, block.bounds.width, block.bounds.height);
    }
  }

  if (background?.image && images) {
    renderBackgroundImage(ctx, block, background, blockX, blockY, rx, ry, images);
  }

  const borders = toRenderBorders(block.borderBox, paint?.border);
  if (!borders) return;
  if (hasRadius) {
    renderRoundedBorders(
      ctx,
      borders,
      blockX,
      blockY,
      block.bounds.width,
      block.bounds.height,
      rx,
      ry,
    );
    return;
  }
  renderBorders(ctx, borders, blockX, blockY, block.bounds.width, block.bounds.height);
}

function renderBackgroundImage(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  background: NonNullable<NonNullable<LayoutBlock['paint']>['background']>,
  blockX: number,
  blockY: number,
  rx: number,
  ry: number,
  images: ReadonlyMap<string, ImageBitmap>,
): void {
  if (!background.image) return;
  const resolve = buildHrefResolver(images);
  const bitmap = resolve(background.image);
  if (!bitmap) return;

  const w = block.bounds.width;
  const h = block.bounds.height;
  const hasRadius = rx > 0 || ry > 0;

  ctx.save();
  // Clip to block bounds (respecting border-radius) so image doesn't overflow
  if (hasRadius) {
    traceRoundedRect(ctx, blockX, blockY, w, h, rx, ry);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(blockX, blockY, w, h);
    ctx.clip();
  }

  const size = background.size ?? 'auto';
  const imgW = bitmap.width;
  const imgH = bitmap.height;
  let drawW = imgW;
  let drawH = imgH;

  if (size === 'cover') {
    const scale = Math.max(w / imgW, h / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
  } else if (size === 'contain') {
    const scale = Math.min(w / imgW, h / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
  }

  // Resolve background-position against the block box. Default when unset:
  // 0% 0% for size=auto, 50% 50% for cover/contain.
  const pos: BackgroundPosition =
    background.position ?? (size === 'auto' ? DEFAULT_POS_AUTO : DEFAULT_POS_CENTER);
  const drawX = blockX + resolvePosAxis(pos.x, w, drawW);
  const drawY = blockY + resolvePosAxis(pos.y, h, drawH);

  if (background.repeat !== 'no-repeat' && drawW > 0 && drawH > 0) {
    // Tile from the positioned origin in both directions to cover the block.
    // Start from the first tile edge at or before blockX/blockY.
    const startX = drawX - Math.ceil((drawX - blockX) / drawW) * drawW;
    const startY = drawY - Math.ceil((drawY - blockY) / drawH) * drawH;
    for (let ty = startY; ty < blockY + h; ty += drawH) {
      for (let tx = startX; tx < blockX + w; tx += drawW) {
        ctx.drawImage(bitmap, tx, ty, drawW, drawH);
      }
    }
  } else {
    ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
  }
  ctx.restore();
}

function renderBorders(
  ctx: CanvasRenderingContext2D,
  borders: RenderBorders,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { top, right, bottom, left } = borders;
  ctx.save();
  if (top.width > 0) strokeBorder(ctx, top, x, y + top.width / 2, x + w, y + top.width / 2);
  if (bottom.width > 0) {
    strokeBorder(ctx, bottom, x, y + h - bottom.width / 2, x + w, y + h - bottom.width / 2);
  }
  if (left.width > 0) strokeBorder(ctx, left, x + left.width / 2, y, x + left.width / 2, y + h);
  if (right.width > 0) {
    strokeBorder(ctx, right, x + w - right.width / 2, y, x + w - right.width / 2, y + h);
  }
  ctx.restore();
}

function renderRoundedBorders(
  ctx: CanvasRenderingContext2D,
  borders: RenderBorders,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number = rx,
): void {
  const { top, right, bottom, left } = borders;
  const hasAny = top.width > 0 || right.width > 0 || bottom.width > 0 || left.width > 0;
  if (!hasAny) return;

  const uniform =
    top.width === right.width &&
    right.width === bottom.width &&
    bottom.width === left.width &&
    top.color === right.color &&
    right.color === bottom.color &&
    bottom.color === left.color &&
    top.style === right.style &&
    right.style === bottom.style &&
    bottom.style === left.style;

  if (uniform) {
    // All sides fully identical — simple stroke
    ctx.save();
    ctx.strokeStyle = top.color;
    if (top.style === 'dotted') {
      const dotWidth = top.width * 0.75;
      ctx.lineWidth = dotWidth;
      ctx.setLineDash([0.001, top.width * 1.5]);
      ctx.lineCap = 'round';
    } else {
      ctx.lineWidth = top.width;
      ctx.setLineDash(getDashPattern(top.style, top.width));
      ctx.lineCap = 'butt';
    }
    traceRoundedRect(ctx, x, y, w, h, rx, ry);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Non-uniform borders: draw each side in its own clipped quadrant.
  // The quadrant clip (diagonal from center to adjacent corners) matches how
  // browsers transition between different-colored sides at corners.
  const crx = Math.min(rx, w / 2);
  const cry = Math.min(ry, h / 2);
  const maxBorder = Math.max(top.width, right.width, bottom.width, left.width);
  const ix = x + left.width;
  const iy = y + top.width;
  const iw = w - left.width - right.width;
  const ih = h - top.width - bottom.width;
  const irx = Math.max(0, crx - maxBorder);
  const iry = Math.max(0, cry - maxBorder);
  const cx = x + w / 2;
  const cy = y + h / 2;

  const sides: readonly [typeof top, number, number, number, number][] = [
    [top, x, y, x + w, y],
    [right, x + w, y, x + w, y + h],
    [bottom, x + w, y + h, x, y + h],
    [left, x, y + h, x, y],
  ];

  for (const [edge, x1, y1, x2, y2] of sides) {
    if (edge.width <= 0) continue;
    ctx.save();
    // Clip to this side's quadrant (triangle from center to two corners)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();

    if (edge.style !== 'solid') {
      // Stroke approach preserves dotted/dashed styling per-side
      ctx.strokeStyle = edge.color;
      if (edge.style === 'dotted') {
        const dotWidth = edge.width * 0.75;
        ctx.lineWidth = dotWidth;
        ctx.setLineDash([0.001, edge.width * 1.5]);
        ctx.lineCap = 'round';
      } else {
        ctx.lineWidth = edge.width;
        ctx.setLineDash(getDashPattern(edge.style, edge.width));
        ctx.lineCap = 'butt';
      }
      traceRoundedRect(ctx, x, y, w, h, crx, cry);
      ctx.stroke();
    } else {
      // Fill approach for solid borders — smooth width transition
      ctx.fillStyle = edge.color;
      ctx.beginPath();
      traceRoundedRect(ctx, x, y, w, h, crx, cry);
      if (iw > 0 && ih > 0) {
        traceBoxPathCCW(ctx, ix, iy, iw, ih, irx, iry);
      }
      ctx.fill('evenodd');
    }
    ctx.restore();
  }
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
  const crx = Math.min(rx, w / 2);
  const cry = Math.min(ry, h / 2);
  ctx.beginPath();
  if (crx === cry) {
    // Circular corners — use arcTo for simplicity
    ctx.moveTo(x + crx, y);
    ctx.arcTo(x + w, y, x + w, y + h, crx);
    ctx.arcTo(x + w, y + h, x, y + h, crx);
    ctx.arcTo(x, y + h, x, y, crx);
    ctx.arcTo(x, y, x + w, y, crx);
  } else {
    // Elliptical corners — use ctx.ellipse() for each quarter
    const PI = Math.PI;
    ctx.moveTo(x + crx, y);
    ctx.lineTo(x + w - crx, y);
    ctx.ellipse(x + w - crx, y + cry, crx, cry, 0, -PI / 2, 0);
    ctx.lineTo(x + w, y + h - cry);
    ctx.ellipse(x + w - crx, y + h - cry, crx, cry, 0, 0, PI / 2);
    ctx.lineTo(x + crx, y + h);
    ctx.ellipse(x + crx, y + h - cry, crx, cry, 0, PI / 2, PI);
    ctx.lineTo(x, y + cry);
    ctx.ellipse(x + crx, y + cry, crx, cry, 0, PI, PI * 1.5);
  }
  ctx.closePath();
}

function strokeBorder(
  ctx: CanvasRenderingContext2D,
  edge: { width: number; color: string; style: 'solid' | 'dotted' | 'dashed' },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.strokeStyle = edge.color;
  if (edge.style === 'dotted') {
    // Browsers render dotted border dots smaller than the full border-width.
    // Use ~75% of border-width as dot diameter; spacing based on original width.
    const dotWidth = edge.width * 0.75;
    ctx.lineWidth = dotWidth;
    ctx.setLineDash([0.001, edge.width * 1.5]);
    ctx.lineCap = 'round';
  } else {
    ctx.lineWidth = edge.width;
    ctx.setLineDash(getDashPattern(edge.style, edge.width));
    ctx.lineCap = 'butt';
  }
  const snap = edge.width % 2 === 1 ? 0.5 : 0;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + snap, Math.round(y1) + snap);
  ctx.lineTo(Math.round(x2) + snap, Math.round(y2) + snap);
  ctx.stroke();
}

function getDashPattern(style: 'solid' | 'dotted' | 'dashed', width: number): number[] {
  // For dotted: near-zero dash + gap. With lineCap='round', the zero-length
  // dash becomes a circle of diameter lineWidth. Round caps extend lineWidth/2
  // into the gap on each side, so visual gap = gap - lineWidth.
  // Using gap = 1.5 × width gives visual gap ≈ 0.5 × width, matching browsers.
  if (style === 'dotted') return [0.001, width * 1.5];
  if (style === 'dashed') return [width * 3, width * 2];
  return [];
}

/**
 * Render outer box-shadows using the inverse-clip technique:
 * 1. Create a clip that excludes the box interior (evenodd)
 * 2. Set Canvas shadow properties
 * 3. Fill the box path → shadow renders outside, fill is clipped away
 *
 * This works correctly for transparent blocks, border-only blocks, and rounded corners.
 */
function renderBoxShadows(
  ctx: CanvasRenderingContext2D,
  shadows: readonly BoxShadow[],
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number = rx,
): void {
  for (let i = shadows.length - 1; i >= 0; i--) {
    const s = shadows[i];
    if (!s || s.inset) continue;
    renderSingleBoxShadow(ctx, s, x, y, w, h, rx, ry);
  }
}

function renderSingleBoxShadow(
  ctx: CanvasRenderingContext2D,
  s: BoxShadow,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number = rx,
): void {
  ctx.save();

  // Canvas shadowBlur/shadowOffset are in output-bitmap (device-pixel) coordinates
  // and are NOT scaled by ctx.scale(). Scale them manually to match the current DPR,
  // consistent with how text-shadow handles this (see text-shadow.ts).
  const dpr = ctx.getTransform().a || 1;

  // Inverse clip: outer rect CW + inner box CCW → only outside the box is drawable
  const pad = s.blur * 2 + Math.abs(s.offsetX) + Math.abs(s.offsetY) + Math.max(s.spread, 0) + 50;
  ctx.beginPath();
  ctx.rect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  traceBoxPathCCW(ctx, x, y, w, h, rx, ry);
  ctx.clip('evenodd');

  // Set shadow and fill the (spread-expanded) box shape → shadow appears outside
  ctx.shadowColor = s.color;
  ctx.shadowBlur = s.blur * dpr;
  ctx.shadowOffsetX = s.offsetX * dpr;
  ctx.shadowOffsetY = s.offsetY * dpr;
  ctx.fillStyle = s.color;
  const sp = s.spread;
  const expandedW = w + sp * 2;
  const expandedH = h + sp * 2;
  if (expandedW <= 0 || expandedH <= 0) {
    ctx.restore();
    return;
  }
  const expandedRx = Math.max(0, rx + sp);
  const expandedRy = Math.max(0, ry + sp);
  if (expandedRx > 0 || expandedRy > 0) {
    traceRoundedRect(ctx, x - sp, y - sp, expandedW, expandedH, expandedRx, expandedRy);
  } else {
    ctx.beginPath();
    ctx.rect(x - sp, y - sp, expandedW, expandedH);
  }
  ctx.fill();

  ctx.restore();
}

/** Trace a box path counter-clockwise (for evenodd clip subtraction). */
function traceBoxPathCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  radiusY: number = radius,
): void {
  const rx = Math.min(radius, w / 2);
  const ry = Math.min(radiusY, h / 2);
  if (rx > 0 || ry > 0) {
    if (rx === ry) {
      ctx.moveTo(x + rx, y);
      ctx.arcTo(x, y, x, y + h, rx);
      ctx.arcTo(x, y + h, x + w, y + h, rx);
      ctx.arcTo(x + w, y + h, x + w, y, rx);
      ctx.arcTo(x + w, y, x, y, rx);
    } else {
      const PI = Math.PI;
      ctx.moveTo(x + rx, y);
      ctx.ellipse(x + rx, y + ry, rx, ry, 0, -PI / 2, PI, true);
      ctx.lineTo(x, y + h - ry);
      ctx.ellipse(x + rx, y + h - ry, rx, ry, 0, PI, PI / 2, true);
      ctx.lineTo(x + w - rx, y + h);
      ctx.ellipse(x + w - rx, y + h - ry, rx, ry, 0, PI / 2, 0, true);
      ctx.lineTo(x + w, y + ry);
      ctx.ellipse(x + w - rx, y + ry, rx, ry, 0, 0, -PI / 2, true);
    }
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y);
  }
  ctx.closePath();
}
