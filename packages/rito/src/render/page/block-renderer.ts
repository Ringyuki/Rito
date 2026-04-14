import type {
  HorizontalRule,
  InlineAtom,
  LayoutBlock,
  LineBox,
  RubyAnnotation,
} from '../../layout/core/types';
import type { LengthPct, TransformFn } from '../../style/core/paint-types';
import { buildHrefResolver } from '../../utils/resolve-href';
import { drawRubyAnnotation, drawTextRun } from '../text/text-renderer';
import { renderBlockBackground, resolveBlockRadius, traceRoundedRect } from './background-renderer';
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
  const paint = block.paint;
  const visualOffset = paint?.visualOffset;
  if (visualOffset) {
    ctx.save();
    ctx.translate(visualOffset.dx, visualOffset.dy);
  }

  const transforms = paint?.transform;
  const hasTransform = transforms !== undefined && transforms.length > 0;
  if (hasTransform) {
    ctx.save();
    const cx = offsetX + block.bounds.x + block.bounds.width / 2;
    const cy = offsetY + block.bounds.y + block.bounds.height / 2;
    applyTransform(ctx, transforms, cx, cy, block.bounds.width, block.bounds.height);
  }

  const hasOpacity = paint?.opacity !== undefined && paint.opacity < 1;
  if (hasOpacity) {
    ctx.save();
    ctx.globalAlpha = paint.opacity ?? 1;
  }

  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;
  const radius = resolveBlockRadius(block);
  renderBlockBackground(ctx, block, blockX, blockY, radius, images);

  const clipping = paint?.clipToBounds === true;
  if (clipping) {
    ctx.save();
    if (radius.rx > 0 || radius.ry > 0) {
      traceRoundedRect(
        ctx,
        blockX,
        blockY,
        block.bounds.width,
        block.bounds.height,
        radius.rx,
        radius.ry,
      );
    } else {
      ctx.beginPath();
      ctx.rect(blockX, blockY, block.bounds.width, block.bounds.height);
    }
    ctx.clip();
  }

  for (const child of block.children) {
    renderChild(ctx, child, blockX, blockY, images, colorOverride);
  }

  if (clipping) ctx.restore();
  if (hasOpacity) ctx.restore();
  if (hasTransform) ctx.restore();
  if (visualOffset) ctx.restore();
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
    renderLineBox(ctx, child, offsetX, offsetY, images, colorOverride);
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
  images?: ReadonlyMap<string, ImageBitmap>,
  colorOverride?: ColorOverride,
): void {
  const lineX = offsetX + lineBox.bounds.x;
  const lineY = offsetY + lineBox.bounds.y;

  for (const run of lineBox.runs) {
    if (run.type === 'inline-atom') {
      renderInlineAtom(ctx, run, lineX, lineY, images);
    } else if (run.type === 'ruby-annotation') {
      renderRuby(ctx, run, lineX, lineY, colorOverride);
    } else {
      drawTextRun(ctx, run, lineX, lineY, colorOverride);
    }
  }
}

function renderRuby(
  ctx: CanvasRenderingContext2D,
  ruby: RubyAnnotation,
  offsetX: number,
  offsetY: number,
  colorOverride?: ColorOverride,
): void {
  // Geometry + paint are already laid out by the text-align pass; render
  // consumes them without re-deriving anything.
  drawRubyAnnotation(ctx, ruby, offsetX, offsetY, colorOverride);
}

let cachedAtomResolver:
  | { images: ReadonlyMap<string, ImageBitmap>; resolve: (href: string) => ImageBitmap | undefined }
  | undefined;

function getAtomResolver(
  images: ReadonlyMap<string, ImageBitmap>,
): (href: string) => ImageBitmap | undefined {
  if (cachedAtomResolver?.images === images) return cachedAtomResolver.resolve;
  const resolve = buildHrefResolver(images);
  cachedAtomResolver = { images, resolve };
  return resolve;
}

function renderInlineAtom(
  ctx: CanvasRenderingContext2D,
  atom: InlineAtom,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
): void {
  if (atom.imageSrc && images) {
    const bitmap = getAtomResolver(images)(atom.imageSrc);
    if (bitmap) {
      const x = offsetX + atom.bounds.x;
      const y = offsetY + atom.bounds.y;
      ctx.drawImage(bitmap, x, y, atom.bounds.width, atom.bounds.height);
    }
  }
  if (atom.block) {
    renderBlock(ctx, atom.block, offsetX + atom.bounds.x, offsetY + atom.bounds.y, images);
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
  const style = hr.paint.style;
  ctx.save();
  ctx.strokeStyle = hr.paint.color;
  if (style === 'dotted') {
    const dotWidth = hr.bounds.height * 0.75;
    ctx.lineWidth = dotWidth;
    ctx.setLineDash([0.001, hr.bounds.height * 1.5]);
    ctx.lineCap = 'round';
  } else if (style === 'dashed') {
    ctx.lineWidth = hr.bounds.height;
    ctx.setLineDash([hr.bounds.height * 3, hr.bounds.height * 2]);
  } else {
    ctx.lineWidth = hr.bounds.height;
  }
  ctx.beginPath();
  ctx.moveTo(Math.round(x), y);
  ctx.lineTo(Math.round(x + hr.bounds.width), y);
  ctx.stroke();
  ctx.restore();
}

/** Apply a pre-parsed list of transform functions around the given center
 *  point. Percentage lengths in `translate` resolve against the block's
 *  bounds width / height, matching CSS transform semantics. */
function applyTransform(
  ctx: CanvasRenderingContext2D,
  transforms: readonly TransformFn[],
  cx: number,
  cy: number,
  boxW: number,
  boxH: number,
): void {
  ctx.translate(cx, cy);
  for (const fn of transforms) {
    switch (fn.kind) {
      case 'rotate':
        ctx.rotate(fn.rad);
        break;
      case 'scale':
        ctx.scale(fn.sx, fn.sy);
        break;
      case 'translate':
        ctx.translate(resolveLengthPct(fn.x, boxW), resolveLengthPct(fn.y, boxH));
        break;
    }
  }
  ctx.translate(-cx, -cy);
}

function resolveLengthPct(v: LengthPct, basis: number): number {
  return v.unit === 'percent' ? (v.value / 100) * basis : v.value;
}
