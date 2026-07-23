import { traceRoundedRect } from '../canvas-path';
import type {
  CanvasBlockBackgroundPaint,
  CanvasBlockImageResolver,
  CanvasBlockRect,
} from './types';

type BackgroundSize = NonNullable<CanvasBlockBackgroundPaint['size']>;
type BackgroundPosition = NonNullable<CanvasBlockBackgroundPaint['position']>;
type LengthPercentage = BackgroundPosition['x'];

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
  rect: CanvasBlockRect,
  background: CanvasBlockBackgroundPaint,
  rx: number,
  ry: number,
  imageResolver: CanvasBlockImageResolver,
): void {
  if (!background.image) return;
  const bitmap = resolveCanvasImage(imageResolver, background.image);
  if (!bitmap) return;

  const boxW = rect.width;
  const boxH = rect.height;
  const image = resolveImageGeometry(bitmap, background, rect.x, rect.y, boxW, boxH);
  ctx.save();
  try {
    clipBackgroundBox(ctx, rect.x, rect.y, boxW, boxH, rx, ry);
    if (background.repeat !== 'no-repeat' && image.drawW > 0 && image.drawH > 0) {
      drawRepeatedImage(ctx, image, rect.x, rect.y, boxW, boxH);
    } else {
      ctx.drawImage(bitmap, image.drawX, image.drawY, image.drawW, image.drawH);
    }
  } finally {
    ctx.restore();
  }
}

export function resolveCanvasImage(
  imageResolver: CanvasBlockImageResolver,
  src: NonNullable<CanvasBlockBackgroundPaint['image']>,
): ImageBitmap | undefined {
  return imageResolver(src);
}

function resolveImageGeometry(
  bitmap: ImageBitmap,
  background: CanvasBlockBackgroundPaint,
  blockX: number,
  blockY: number,
  boxW: number,
  boxH: number,
): BackgroundImageGeometry {
  const size = background.size ?? 'auto';
  const { drawW, drawH } = resolveImageSize(size, bitmap.width, bitmap.height, boxW, boxH);
  const position = background.position ?? (size === 'auto' ? DEFAULT_POS_AUTO : DEFAULT_POS_CENTER);
  return {
    bitmap,
    drawX: blockX + resolvePositionAxis(position.x, boxW, drawW),
    drawY: blockY + resolvePositionAxis(position.y, boxH, drawH),
    drawW,
    drawH,
  };
}

function resolveImageSize(
  size: BackgroundSize,
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): { readonly drawW: number; readonly drawH: number } {
  if (size === 'cover') {
    const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
    return { drawW: imageWidth * scale, drawH: imageHeight * scale };
  }
  if (size === 'contain') {
    const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
    return { drawW: imageWidth * scale, drawH: imageHeight * scale };
  }
  if (typeof size === 'object') {
    // Explicit per-axis size: an auto axis derives from the other by the
    // intrinsic aspect ratio, exactly as CSS resolves `background-size`.
    const axis = (value: typeof size.x, containerSize: number): number | undefined => {
      if (value === 'auto') return undefined;
      return value.unit === 'percent' ? (containerSize * value.value) / 100 : value.value;
    };
    const explicitW = axis(size.x, boxWidth);
    const explicitH = axis(size.y, boxHeight);
    const drawW =
      explicitW ?? (explicitH !== undefined ? (explicitH * imageWidth) / imageHeight : imageWidth);
    const drawH =
      explicitH ?? (explicitW !== undefined ? (explicitW * imageHeight) / imageWidth : imageHeight);
    return { drawW, drawH };
  }
  return { drawW: imageWidth, drawH: imageHeight };
}

function clipBackgroundBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): void {
  if (radiusX > 0 || radiusY > 0) {
    traceRoundedRect(ctx, x, y, width, height, radiusX, radiusY);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, width, height);
  }
  ctx.clip();
}

function drawRepeatedImage(
  ctx: CanvasRenderingContext2D,
  image: BackgroundImageGeometry,
  blockX: number,
  blockY: number,
  boxWidth: number,
  boxHeight: number,
): void {
  const startX = image.drawX - Math.ceil((image.drawX - blockX) / image.drawW) * image.drawW;
  const startY = image.drawY - Math.ceil((image.drawY - blockY) / image.drawH) * image.drawH;
  for (let y = startY; y < blockY + boxHeight; y += image.drawH) {
    for (let x = startX; x < blockX + boxWidth; x += image.drawW) {
      ctx.drawImage(image.bitmap, x, y, image.drawW, image.drawH);
    }
  }
}

function resolvePositionAxis(
  value: LengthPercentage,
  containerSize: number,
  imageSize: number,
): number {
  if (value.unit === 'percent') return ((containerSize - imageSize) * value.value) / 100;
  return value.value;
}
