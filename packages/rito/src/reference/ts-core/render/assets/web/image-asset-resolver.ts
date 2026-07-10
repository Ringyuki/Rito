import { buildHrefResolver } from '../../../utils/resolve-href';
import { createImageAssetResolver } from '../image-asset-resolver';
import { toExactArrayBuffer } from '../bytes';
import type { ImageAssetResolver, ImageDimensions, ImageObjectUrlProvider } from '../types';

export function createWebImageAssetResolver<TImage extends ImageDimensions>(
  images: ReadonlyMap<string, TImage>,
  imageData: ReadonlyMap<string, Uint8Array>,
): ImageAssetResolver<TImage> & ImageObjectUrlProvider {
  const imageResolver = createImageAssetResolver(images);
  const resolveBytes = buildHrefResolver(imageData);
  return {
    resolveImage: (src: string) => imageResolver.resolveImage(src),
    createImageObjectUrl(src: string): string | undefined {
      const bytes = resolveBytes(src);
      if (!bytes) return undefined;
      return URL.createObjectURL(new Blob([toExactArrayBuffer(bytes)]));
    },
  };
}
