import type { RitoReaderPathOp, RitoReaderPrimitive } from '@ritojs/core-wasm/decoder';

import type { CanvasImageResolver } from './primitive-renderer';
import { toCanvasColor } from './reader-session-canvas-converter';
import { mixThemeColors } from './theme/text-color';

type TransformPrimitive = Extract<RitoReaderPrimitive, { readonly kind: 'transform' }>;
type StrokePrimitive = Extract<RitoReaderPrimitive, { readonly kind: 'stroke-path' }>;
type ShadowPrimitive = Extract<RitoReaderPrimitive, { readonly kind: 'shadow' }>;
type ImagePrimitive = Extract<RitoReaderPrimitive, { readonly kind: 'draw-image' }>;
type ImageFallbackPrimitive = Extract<RitoReaderPrimitive, { readonly kind: 'image-fallback' }>;

// A shadow's exclusion clip is the whole plane less the excluded shape;
// this reach stands in for the plane on any page a reader can lay out.
const CLIP_REACH = 1 << 20;

/** The stateless blits of the primitive renderer: each one puts a
 * device-resolved primitive on the canvas exactly as the engine
 * resolved it. */

export function tracePath(ctx: CanvasRenderingContext2D, ops: readonly RitoReaderPathOp[]): void {
  for (const op of ops) {
    switch (op.op) {
      case 'move-to':
        ctx.moveTo(op.x, op.y);
        break;
      case 'line-to':
        ctx.lineTo(op.x, op.y);
        break;
      case 'arc':
        ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, op.start, op.start + op.sweep, op.sweep < 0);
        break;
      case 'ellipse':
        ctx.moveTo(op.cx + op.rx, op.cy);
        ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, 2 * Math.PI);
        ctx.closePath();
        break;
      case 'rect':
        ctx.rect(op.x, op.y, op.width, op.height);
        break;
      case 'close':
        ctx.closePath();
        break;
      default:
        assertNever(op);
    }
  }
}

export function applyTransform(ctx: CanvasRenderingContext2D, primitive: TransformPrimitive): void {
  const { origin } = primitive;
  ctx.translate(origin.x, origin.y);
  for (const transform of primitive.transforms) {
    if (transform.kind === 'rotate') ctx.rotate(transform.radians);
    else if (transform.kind === 'scale') ctx.scale(transform.sx, transform.sy);
    else ctx.translate(transform.dx, transform.dy);
  }
  ctx.translate(-origin.x, -origin.y);
}

export function strokePath(ctx: CanvasRenderingContext2D, primitive: StrokePrimitive): void {
  ctx.strokeStyle = toCanvasColor(primitive.color);
  ctx.lineWidth = primitive.width;
  ctx.lineCap = primitive.cap;
  ctx.setLineDash(primitive.dash ? [primitive.dash.on, primitive.dash.off] : []);
  ctx.beginPath();
  tracePath(ctx, primitive.path);
  ctx.stroke();
}

/** Canvas blurs with `shadowBlur` = twice the Gaussian sigma; the offset
 * is in device pixels like everything else, so it is not scaled. */
export function drawShadow(ctx: CanvasRenderingContext2D, primitive: ShadowPrimitive): void {
  ctx.save();
  try {
    if (primitive.clipOut) {
      ctx.beginPath();
      ctx.rect(-CLIP_REACH, -CLIP_REACH, 2 * CLIP_REACH, 2 * CLIP_REACH);
      tracePath(ctx, primitive.clipOut);
      ctx.clip('evenodd');
    }
    const color = toCanvasColor(primitive.color);
    ctx.shadowColor = color;
    ctx.shadowBlur = primitive.sigma * 2;
    ctx.shadowOffsetX = primitive.offset.x;
    ctx.shadowOffsetY = primitive.offset.y;
    ctx.fillStyle = color;
    ctx.beginPath();
    tracePath(ctx, primitive.shape);
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

export function drawImage(
  ctx: CanvasRenderingContext2D,
  primitive: ImagePrimitive,
  resolveImage: CanvasImageResolver,
  opacity = 1,
): void {
  const bitmap = resolveImage(primitive.src);
  if (!bitmap || opacity <= 0) return;
  if (opacity < 1) {
    ctx.save();
    try {
      ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1) * opacity;
      drawImage(ctx, primitive, resolveImage);
    } finally {
      ctx.restore();
    }
    return;
  }
  const { dest, sourceRect, tiles } = primitive;
  const draw = (x: number, y: number): void => {
    if (sourceRect) {
      ctx.drawImage(
        bitmap,
        sourceRect.x,
        sourceRect.y,
        sourceRect.width,
        sourceRect.height,
        x,
        y,
        dest.width,
        dest.height,
      );
    } else {
      ctx.drawImage(bitmap, x, y, dest.width, dest.height);
    }
  };
  if (!tiles) {
    draw(dest.x, dest.y);
    return;
  }
  for (let row = 0; row < tiles.rows; row += 1) {
    for (let column = 0; column < tiles.columns; column += 1) {
      draw(tiles.origin.x + column * tiles.stepX, tiles.origin.y + row * tiles.stepY);
    }
  }
}

/** An image's stand-in: the tinted block, then each icon piece filled
 * even-odd, moved by its offset and cut to its clip. */
export function drawImageFallback(
  ctx: CanvasRenderingContext2D,
  primitive: ImageFallbackPrimitive,
  colors: { readonly background: string; readonly foreground: string },
): void {
  const block = mixThemeColors(colors.background, colors.foreground, primitive.blockInk);
  const { x, y, width, height } = primitive.block;
  ctx.fillStyle = block;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = mixThemeColors(block, colors.foreground, primitive.iconInk);
  for (const piece of primitive.pieces) {
    ctx.save();
    try {
      ctx.translate(piece.offset.x, piece.offset.y);
      if (piece.clip) {
        ctx.beginPath();
        tracePath(ctx, piece.clip);
        ctx.clip();
      }
      ctx.beginPath();
      tracePath(ctx, piece.path);
      ctx.fill('evenodd');
    } finally {
      ctx.restore();
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported reader path op: ${JSON.stringify(value)}`);
}
