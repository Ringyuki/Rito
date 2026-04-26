import type { FontRegistry, FontResource } from '../types';
import { toExactArrayBuffer } from '../bytes';

export function createWebFontRegistry(fonts: FontFaceSet = document.fonts): FontRegistry {
  return {
    async loadFont(resource: FontResource): Promise<void> {
      const descriptors: FontFaceDescriptors = {};
      if (resource.weight) descriptors.weight = resource.weight;
      if (resource.style) descriptors.style = resource.style;

      const face = new FontFace(resource.family, toExactArrayBuffer(resource.bytes), descriptors);
      await face.load();
      fonts.add(face);
    },
  };
}
