import { traceCornerRoundedRect, traceRoundedRect } from '../canvas-path';
import { renderBackgroundImage } from './background-image';
import { renderBlockBorders } from './borders';
import { renderBoxShadows } from './box-shadow';
import type {
  CanvasBlockCommand,
  CanvasBlockImageResolver,
  CanvasBlockRect,
  CanvasBlockResolvedRadius,
} from './types';

export function renderCanvasBlockDecoration(
  ctx: CanvasRenderingContext2D,
  command: CanvasBlockCommand,
  imageResolver?: CanvasBlockImageResolver,
): void {
  const { rect, paint, borderBox } = command;
  const resolved = resolveCanvasBlockRadius(command);
  const { rx, ry } = resolved;
  const { background } = paint;

  if (paint.boxShadow && paint.boxShadow.length > 0) {
    renderBoxShadows(ctx, paint.boxShadow, rect.x, rect.y, rect.width, rect.height, rx, ry);
  }
  if (background?.color) fillBackgroundColor(ctx, background.color, rect, resolved);
  if (background?.image && imageResolver) {
    renderBackgroundImage(ctx, rect, background, rx, ry, imageResolver, resolved.corners);
  }
  renderBlockBorders(ctx, borderBox, paint.border, rect.x, rect.y, rect.width, rect.height, rx, ry);
}

export function resolveCanvasBlockRadius(command: CanvasBlockCommand): CanvasBlockResolvedRadius {
  const { radius } = command.paint;
  if (radius?.corners !== undefined) {
    return { rx: 0, ry: 0, corners: radius.corners };
  }
  if (radius?.pct !== undefined) {
    const ratio = radius.pct / 100;
    return { rx: ratio * command.rect.width, ry: ratio * command.rect.height };
  }
  const pixels = radius?.px ?? 0;
  return { rx: pixels, ry: pixels };
}

function fillBackgroundColor(
  ctx: CanvasRenderingContext2D,
  color: string,
  rect: CanvasBlockRect,
  { rx, ry, corners }: CanvasBlockResolvedRadius,
): void {
  ctx.fillStyle = color;
  if (corners) {
    traceCornerRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, corners);
    ctx.fill();
    return;
  }
  if (rx > 0 || ry > 0) {
    traceRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, rx, ry);
    ctx.fill();
    return;
  }
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}
