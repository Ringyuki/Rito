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
  // Rounded fills snap like plain ones: the browser rasters the rounded
  // border box on whole device pixels, each edge rounding independently
  // (measured on b2's message frame and b12's chat bubbles — raw
  // fractional fills smeared every box edge one AA row).
  const snappedRight = Math.round(rect.x + rect.width);
  const snappedBottom = Math.round(rect.y + rect.height);
  const snappedLeft = Math.round(rect.x);
  const snappedTop = Math.round(rect.y);
  const snappedWidth = snappedRight - snappedLeft;
  const snappedHeight = snappedBottom - snappedTop;
  if (corners) {
    traceCornerRoundedRect(ctx, snappedLeft, snappedTop, snappedWidth, snappedHeight, corners);
    ctx.fill();
    return;
  }
  if (rx > 0 || ry > 0) {
    traceRoundedRect(ctx, snappedLeft, snappedTop, snappedWidth, snappedHeight, rx, ry);
    ctx.fill();
    return;
  }
  // A plain background rasters on whole device pixels, each edge
  // rounding independently — the same binary band the border law uses.
  // A float fill at x 57.65625 bled 34% white over the frame's already
  // binary 1px border column and greyed it to 88/255 (measured on b39's
  // interview frame; Blink keeps the border column untouched).
  const right = Math.round(rect.x + rect.width);
  const bottom = Math.round(rect.y + rect.height);
  const left = Math.round(rect.x);
  const top = Math.round(rect.y);
  ctx.fillRect(left, top, right - left, bottom - top);
}
