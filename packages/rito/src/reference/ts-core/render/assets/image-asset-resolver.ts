import { buildHrefResolver } from '../../utils/resolve-href';
import type { ImageAssetResolver, ImageDimensions } from './types';

export function createImageAssetResolver<TImage extends ImageDimensions>(
  images: ReadonlyMap<string, TImage>,
): ImageAssetResolver<TImage> {
  const resolve = buildHrefResolver(images);
  return {
    resolveImage: (src: string) => resolve(src),
  };
}
