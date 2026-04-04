import type { ImageElement } from '../../layout/core/types';
import { buildHrefResolver } from '../../utils/resolve-href';

let cachedResolver: ((src: string) => ImageBitmap | undefined) | undefined;
let cachedImages: ReadonlyMap<string, ImageBitmap> | undefined;

export function renderImage(
  ctx: CanvasRenderingContext2D,
  image: ImageElement,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
): void {
  if (!images) return;

  const bitmap = resolveImageBitmap(image.src, images);
  if (!bitmap) return;

  const x = offsetX + image.bounds.x;
  const y = offsetY + image.bounds.y;
  ctx.drawImage(bitmap, x, y, image.bounds.width, image.bounds.height);
}

function resolveImageBitmap(
  src: string,
  images: ReadonlyMap<string, ImageBitmap>,
): ImageBitmap | undefined {
  if (images !== cachedImages) {
    cachedResolver = buildHrefResolver(images);
    cachedImages = images;
  }
  return cachedResolver?.(src);
}
