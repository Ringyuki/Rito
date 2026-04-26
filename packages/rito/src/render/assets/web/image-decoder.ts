import type { ImageDecoder, ImageResource } from '../types';
import { toExactArrayBuffer } from '../bytes';

export function createWebImageDecoder(): ImageDecoder<ImageBitmap> {
  return {
    async decode(resource: ImageResource): Promise<ImageBitmap> {
      const blob = new Blob([toExactArrayBuffer(resource.bytes)]);
      return createImageBitmap(blob);
    },
    dispose(image: ImageBitmap): void {
      image.close();
    },
  };
}
