import type { BlockPaint, BorderBox, Rect } from '../../../../layout/core/types';
import { renderBackgroundImage, type CanvasImageResolver } from './background-image-renderer';
import { renderBlockBorders } from './background-borders';
import { traceRoundedRect } from './background-paths';
import { renderBoxShadows } from './box-shadow-renderer';

/** Resolved border-radius with separate horizontal and vertical radii. */
export interface ResolvedRadius {
  readonly rx: number;
  readonly ry: number;
}

type BlockDecorationPaint = Pick<BlockPaint, 'background' | 'border' | 'radius' | 'boxShadow'>;

export interface BlockDecorationBox {
  readonly rect: Rect;
  readonly paint?: BlockDecorationPaint;
  readonly borderBox?: BorderBox;
}

export { traceRoundedRect } from './background-paths';

export function renderBlockDecoration(
  ctx: CanvasRenderingContext2D,
  box: BlockDecorationBox,
  { rx, ry }: ResolvedRadius,
  imageResolver?: CanvasImageResolver,
): void {
  const { rect, paint, borderBox } = box;
  const background = paint?.background;

  if (paint?.boxShadow && paint.boxShadow.length > 0) {
    renderBoxShadows(ctx, paint.boxShadow, rect.x, rect.y, rect.width, rect.height, rx, ry);
  }

  if (background?.color) {
    fillBackgroundColor(ctx, background.color, rect, rx, ry);
  }

  if (background?.image && imageResolver) {
    renderBackgroundImage(ctx, rect, background, rx, ry, imageResolver);
  }

  renderBlockBorders(
    ctx,
    borderBox,
    paint?.border,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    rx,
    ry,
  );
}

function fillBackgroundColor(
  ctx: CanvasRenderingContext2D,
  color: string,
  rect: Rect,
  rx: number,
  ry: number,
): void {
  ctx.fillStyle = color;
  if (rx > 0 || ry > 0) {
    traceRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, rx, ry);
    ctx.fill();
    return;
  }
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}
