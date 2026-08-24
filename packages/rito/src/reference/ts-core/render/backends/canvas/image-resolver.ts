import { buildHrefResolver } from '../../../utils/resolve-href';

export function createCanvasImageResolver(
  images: ReadonlyMap<string, ImageBitmap>,
): (src: string) => ImageBitmap | undefined {
  return buildHrefResolver(images);
}
