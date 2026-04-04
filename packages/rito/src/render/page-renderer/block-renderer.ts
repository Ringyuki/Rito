import type { HorizontalRule, LayoutBlock, LineBox } from '../../layout/core/types';
import { drawTextRun } from '../text-renderer';
import { renderBlockBackground } from './background-renderer';
import { renderImage } from './image-renderer';
import type { ColorOverride } from './types';

export function renderBlock(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
  colorOverride?: ColorOverride,
): void {
  const relativeOffset = block.relativeOffset;
  if (relativeOffset) {
    ctx.save();
    ctx.translate(relativeOffset.dx, relativeOffset.dy);
  }

  const hasOpacity = block.opacity !== undefined && block.opacity < 1;
  if (hasOpacity) {
    ctx.save();
    ctx.globalAlpha = block.opacity;
  }

  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;
  renderBlockBackground(ctx, block, blockX, blockY, block.borderRadius ?? 0);

  const clipping = block.overflow === 'hidden';
  if (clipping) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(blockX, blockY, block.bounds.width, block.bounds.height);
    ctx.clip();
  }

  for (const child of block.children) {
    renderChild(ctx, child, blockX, blockY, images, colorOverride);
  }

  if (clipping) ctx.restore();
  if (hasOpacity) ctx.restore();
  if (relativeOffset) ctx.restore();
}

function renderChild(
  ctx: CanvasRenderingContext2D,
  child: LayoutBlock['children'][number],
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
  colorOverride?: ColorOverride,
): void {
  if (child.type === 'line-box') {
    renderLineBox(ctx, child, offsetX, offsetY, colorOverride);
    return;
  }
  if (child.type === 'image') {
    renderImage(ctx, child, offsetX, offsetY, images);
    return;
  }
  if (child.type === 'hr') {
    renderHorizontalRule(ctx, child, offsetX, offsetY);
    return;
  }
  renderBlock(ctx, child, offsetX, offsetY, images, colorOverride);
}

function renderLineBox(
  ctx: CanvasRenderingContext2D,
  lineBox: LineBox,
  offsetX: number,
  offsetY: number,
  colorOverride?: ColorOverride,
): void {
  const lineX = offsetX + lineBox.bounds.x;
  const lineY = offsetY + lineBox.bounds.y;

  for (const run of lineBox.runs) {
    drawTextRun(ctx, run, lineX, lineY, colorOverride);
  }
}

function renderHorizontalRule(
  ctx: CanvasRenderingContext2D,
  hr: HorizontalRule,
  offsetX: number,
  offsetY: number,
): void {
  const x = offsetX + hr.bounds.x;
  const rawY = offsetY + hr.bounds.y + hr.bounds.height / 2;
  const snap = hr.bounds.height % 2 === 1 ? 0.5 : 0;
  const y = Math.round(rawY) + snap;
  ctx.save();
  ctx.strokeStyle = hr.color;
  ctx.lineWidth = hr.bounds.height;
  ctx.beginPath();
  ctx.moveTo(Math.round(x), y);
  ctx.lineTo(Math.round(x + hr.bounds.width), y);
  ctx.stroke();
  ctx.restore();
}
