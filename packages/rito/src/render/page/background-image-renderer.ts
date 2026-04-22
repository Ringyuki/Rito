import type { LayoutBlock } from '../../layout/core/types';
import type { BackgroundPosition, LengthPct } from '../../style/core/paint-types';
import { buildHrefResolver } from '../../utils/resolve-href';
import { traceRoundedRect } from './background-paths';

type BlockBackground = NonNullable<NonNullable<LayoutBlock['paint']>['background']>;
type BackgroundSize = NonNullable<BlockBackground['size']>;

interface BackgroundImageGeometry {
  readonly bitmap: ImageBitmap;
  readonly drawX: number;
  readonly drawY: number;
  readonly drawW: number;
  readonly drawH: number;
}

const DEFAULT_POS_AUTO: BackgroundPosition = {
  x: { unit: 'percent', value: 0 },
  y: { unit: 'percent', value: 0 },
};
const DEFAULT_POS_CENTER: BackgroundPosition = {
  x: { unit: 'percent', value: 50 },
  y: { unit: 'percent', value: 50 },
};

export function renderBackgroundImage(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  background: BlockBackground,
  blockX: number,
  blockY: number,
  rx: number,
  ry: number,
  images: ReadonlyMap<string, ImageBitmap>,
): void {
  if (!background.image) return;
  const bitmap = buildHrefResolver(images)(background.image);
  if (!bitmap) return;

  const boxW = block.bounds.width;
  const boxH = block.bounds.height;
  const image = resolveImageGeometry(bitmap, background, blockX, blockY, boxW, boxH);
  ctx.save();
  clipBackgroundBox(ctx, blockX, blockY, boxW, boxH, rx, ry);
  if (background.repeat !== 'no-repeat' && image.drawW > 0 && image.drawH > 0) {
    drawRepeatedImage(ctx, image, blockX, blockY, boxW, boxH);
  } else {
    ctx.drawImage(bitmap, image.drawX, image.drawY, image.drawW, image.drawH);
  }
  ctx.restore();
}

function resolveImageGeometry(
  bitmap: ImageBitmap,
  background: BlockBackground,
  blockX: number,
  blockY: number,
  boxW: number,
  boxH: number,
): BackgroundImageGeometry {
  const size = background.size ?? 'auto';
  const { drawW, drawH } = resolveImageSize(size, bitmap.width, bitmap.height, boxW, boxH);
  const pos = background.position ?? (size === 'auto' ? DEFAULT_POS_AUTO : DEFAULT_POS_CENTER);
  return {
    bitmap,
    drawX: blockX + resolvePosAxis(pos.x, boxW, drawW),
    drawY: blockY + resolvePosAxis(pos.y, boxH, drawH),
    drawW,
    drawH,
  };
}

function resolveImageSize(
  size: BackgroundSize,
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { readonly drawW: number; readonly drawH: number } {
  if (size === 'cover') {
    const scale = Math.max(boxW / imgW, boxH / imgH);
    return { drawW: imgW * scale, drawH: imgH * scale };
  }
  if (size === 'contain') {
    const scale = Math.min(boxW / imgW, boxH / imgH);
    return { drawW: imgW * scale, drawH: imgH * scale };
  }
  return { drawW: imgW, drawH: imgH };
}

function clipBackgroundBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  if (rx > 0 || ry > 0) {
    traceRoundedRect(ctx, x, y, w, h, rx, ry);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
  ctx.clip();
}

function drawRepeatedImage(
  ctx: CanvasRenderingContext2D,
  image: BackgroundImageGeometry,
  blockX: number,
  blockY: number,
  boxW: number,
  boxH: number,
): void {
  const startX = image.drawX - Math.ceil((image.drawX - blockX) / image.drawW) * image.drawW;
  const startY = image.drawY - Math.ceil((image.drawY - blockY) / image.drawH) * image.drawH;
  for (let ty = startY; ty < blockY + boxH; ty += image.drawH) {
    for (let tx = startX; tx < blockX + boxW; tx += image.drawW) {
      ctx.drawImage(image.bitmap, tx, ty, image.drawW, image.drawH);
    }
  }
}

function resolvePosAxis(v: LengthPct, containerSize: number, imageSize: number): number {
  if (v.unit === 'percent') return ((containerSize - imageSize) * v.value) / 100;
  return v.value;
}
