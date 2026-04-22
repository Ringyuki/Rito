import type { LayoutBlock } from '../../layout/core/types';
import { renderBackgroundImage } from './background-image-renderer';
import { renderBlockBorders } from './background-borders';
import { traceRoundedRect } from './background-paths';
import { renderBoxShadows } from './box-shadow-renderer';

/** Resolved border-radius with separate horizontal and vertical radii. */
export interface ResolvedRadius {
  readonly rx: number;
  readonly ry: number;
}

export { traceRoundedRect } from './background-paths';

/** Resolve a block's effective border-radius (px or percentage -> per-axis px). */
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
    fillBackgroundColor(ctx, background.color, block, blockX, blockY, rx, ry);
  }

  if (background?.image && images) {
    renderBackgroundImage(ctx, block, background, blockX, blockY, rx, ry, images);
  }

  renderBlockBorders(
    ctx,
    block.borderBox,
    paint?.border,
    blockX,
    blockY,
    block.bounds.width,
    block.bounds.height,
    rx,
    ry,
  );
}

function fillBackgroundColor(
  ctx: CanvasRenderingContext2D,
  color: string,
  block: LayoutBlock,
  blockX: number,
  blockY: number,
  rx: number,
  ry: number,
): void {
  ctx.fillStyle = color;
  if (rx > 0 || ry > 0) {
    traceRoundedRect(ctx, blockX, blockY, block.bounds.width, block.bounds.height, rx, ry);
    ctx.fill();
    return;
  }
  ctx.fillRect(blockX, blockY, block.bounds.width, block.bounds.height);
}
